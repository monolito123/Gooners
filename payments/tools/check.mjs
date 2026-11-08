// Verifies the specification: every claim that can be computed is recomputed.
// Usage: npm run check            (all checks)
//        npm run check -- --fast  (skip Mermaid rendering, OpenAPI lint and PostgreSQL)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import {
  testKey, verifyEventStrict, unwrap, canonicalJson, verifyInclusion, statementLeafData,
  hexToBytes, bytesToHex, sha256, utf8ToBytes, nip19, fee,
} from './lib.mjs';
import { checkCategorical, contrast, fmt, resolveTokens, simulate, deltaE } from './color.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repoRoot = resolve(root, '..');
const fast = process.argv.includes('--fast');

let failures = 0;
let passes = 0;
const section = (t) => console.log('\n' + t);
const ok = (m) => {
  passes++;
  console.log('  ok   ' + m);
};
const bad = (m) => {
  failures++;
  console.log('  FAIL ' + m);
};
const check = (cond, m) => (cond ? ok(m) : bad(m));

const docsDir = join(root, 'docs');
const integrationDir = join(root, 'integration');
const docFiles = [
  join(root, 'README.md'),
  ...readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort().map((f) => join(docsDir, f)),
  ...(existsSync(integrationDir) ? readdirSync(integrationDir).filter((f) => f.endsWith('.md')).sort().map((f) => join(integrationDir, f)) : []),
  ...(existsSync(join(root, 'platform', 'README.md')) ? [join(root, 'platform', 'README.md')] : []),
];
const docs = docFiles.map((path) => ({ path, rel: relative(root, path), text: readFileSync(path, 'utf8') }));
const exDir = join(root, 'nostr', 'examples');
const examples = Object.fromEntries(readdirSync(exDir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(join(exDir, f), 'utf8'))]));

const codeBlocks = (text, lang) => [...text.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);
const isEvent = (o) => o && typeof o === 'object' && ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'].every((k) => k in o);
function* walk(o) {
  if (o && typeof o === 'object') {
    yield o;
    for (const v of Object.values(o)) yield* walk(v);
  }
}

// ---------------------------------------------------------------- 1. JSON blocks
section('1. JSON code blocks parse');
const docJson = [];
for (const d of docs) {
  codeBlocks(d.text, 'json').forEach((src, i) => {
    try {
      docJson.push({ doc: d.rel, i, value: JSON.parse(src) });
    } catch (e) {
      bad(`${d.rel} json block #${i + 1}: ${e.message}`);
    }
  });
}
ok(`${docJson.length} JSON blocks parsed`);

// ---------------------------------------------------------------- 2. Nostr events
section('2. Nostr events (examples and documents)');
const exampleById = new Map();
for (const [file, value] of Object.entries(examples)) {
  for (const o of walk(value)) {
    if (!isEvent(o)) continue;
    const p = verifyEventStrict(o);
    p.length ? bad(`${file} event ${o.id.slice(0, 12)}…: ${p.join('; ')}`) : exampleById.set(o.id, o);
  }
}
ok(`${exampleById.size} example events have valid ids and BIP-340 signatures`);

let embedded = 0;
for (const { doc, value } of docJson) {
  for (const o of walk(value)) {
    if (!isEvent(o)) continue;
    embedded++;
    const p = verifyEventStrict(o);
    if (p.length) bad(`${doc}: embedded event ${String(o.id).slice(0, 12)}…: ${p.join('; ')}`);
    else if (!exampleById.has(o.id)) bad(`${doc}: embedded event ${o.id.slice(0, 12)}… is not in nostr/examples`);
    else if (JSON.stringify(exampleById.get(o.id)) !== JSON.stringify(o)) bad(`${doc}: embedded event ${o.id.slice(0, 12)}… differs from the example file`);
  }
}
ok(`${embedded} events embedded in documents verified and identical to nostr/examples`);

// Every 64-hex value next to an event-id-like key in the docs must be a known example event.
const knownIds = new Set(exampleById.keys());
for (const d of docs) {
  for (const m of d.text.matchAll(/"(?:nostr_event_id|receipt_event_id|journal_event_id|root_event_id)":\s*"([0-9a-f]{64})"/g)) {
    if (!knownIds.has(m[1])) bad(`${d.rel}: ${m[0].slice(0, 40)}… references an unknown event`);
  }
}

// Gift wraps: unwrap with the deterministic test key of the named recipient.
const keyOf = (role) => testKey(role);
for (const [file, value] of Object.entries(examples)) {
  if (!value.wrap) continue;
  const recipient = keyOf(value.recipient);
  const { inner, problems } = unwrap(value.wrap, recipient.sk);
  problems.length ? bad(`${file}: ${problems.join('; ')}`) : ok(`${file}: wrap → seal → inner verified for ${value.recipient}`);
  if (value.inner && inner.id !== value.inner.id) bad(`${file}: unwrapped inner event differs from "inner"`);
}

// JSON Schemas per kind.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemaDir = join(root, 'nostr', 'schemas');
const schemaByKind = {};
for (const f of readdirSync(schemaDir)) {
  const s = JSON.parse(readFileSync(join(schemaDir, f), 'utf8'));
  ajv.addSchema(s);
  const m = f.match(/^kind-(\d+)\./);
  if (m) schemaByKind[m[1]] = s.$id;
}
let validated = 0;
for (const ev of exampleById.values()) {
  const id = schemaByKind[ev.kind];
  if (!id) continue;
  const validate = ajv.getSchema(id);
  if (!validate(ev)) bad(`kind ${ev.kind} ${ev.id.slice(0, 12)}…: ${ajv.errorsText(validate.errors)}`);
  const contentSchema = ajv.getSchema(id + '#/$defs/content');
  if (contentSchema) {
    const content = JSON.parse(ev.content);
    if (!contentSchema(content)) bad(`kind ${ev.kind} content: ${ajv.errorsText(contentSchema.errors)}`);
    if (canonicalJson(content) !== ev.content) bad(`kind ${ev.kind} ${ev.id.slice(0, 12)}…: content is not canonical JSON`);
  }
  validated++;
}
const kindsWithExamples = new Set([...exampleById.values()].map((e) => String(e.kind)));
for (const k of Object.keys(schemaByKind)) if (!kindsWithExamples.has(k)) bad(`schema for kind ${k} has no example`);
ok(`${validated} events validated against their kind schema; contents are canonical JSON`);

// The kind registry in 03 must list exactly the kinds that have schemas.
const reg = docs.find((d) => d.rel.endsWith('03-nostr-layer.md')).text;
const registryKinds = [...reg.matchAll(/^\| \*\*(\d+)\*\* \|/gm)].map((m) => m[1]).sort();
check(JSON.stringify(registryKinds) === JSON.stringify(Object.keys(schemaByKind).sort()), `kind registry in 03 §2.1 matches the ${registryKinds.length} schemas`);

// ---------------------------------------------------------------- 3. Settlement and transparency
section('3. Settlement statement, Merkle proofs, transparency chain');
const statement = examples['7713-settlement-statement.json'];
const sc = JSON.parse(statement.content);
const sum = (k) => sc.lines.reduce((a, l) => a + l[k], 0);
check(sc.totals.gross === sum('amount') && sc.totals.fees === sum('fee') && sc.totals.net === sc.totals.gross - sc.totals.fees - sc.totals.refunds - sc.totals.chargebacks, `statement totals match lines (gross ${sc.totals.gross}, fees ${sc.totals.fees}, net ${sc.totals.net})`);
const { statement_commitment, transparency, ...body } = sc;
check(bytesToHex(sha256(utf8ToBytes(canonicalJson(body)))) === statement_commitment, 'statement_commitment = SHA-256(canonical body)');
const rootEv = examples['7715-transparency-root.json'];
const rootContent = JSON.parse(rootEv.content);
check(transparency.root_event_id === rootEv.id, 'statement points at the 7715 root event');
check(
  verifyInclusion(statementLeafData(transparency.leaf_salt, statement_commitment), transparency.leaf_index, transparency.tree_size, transparency.audit_path.map(hexToBytes), rootContent.root),
  'statement leaf is included in the transparency root',
);
const proof = examples['proof-receipt-0.json'];
check(sc.lines[0].receipt_event_id === proof.receipt_event_id && proof.statement_inclusion.root === sc.receipts_root, 'proof refers to the statement');
check(verifyInclusion(hexToBytes(proof.receipt_event_id), proof.statement_inclusion.leaf_index, proof.statement_inclusion.tree_size, proof.statement_inclusion.audit_path.map(hexToBytes), sc.receipts_root), 'receipt is included in receipts_root');
check(!verifyInclusion(hexToBytes(sc.lines[1].receipt_event_id), 0, proof.statement_inclusion.tree_size, proof.statement_inclusion.audit_path.map(hexToBytes), sc.receipts_root), 'a different receipt does not verify with that proof');
const prevRoot = examples['7715-transparency-root-2026-10-28.json'];
check(rootContent.prev === prevRoot.id && rootEv.tags.some((t) => t[0] === 'e' && t[1] === prevRoot.id && t[3] === 'prev'), 'root chain: 2026-10-29 → 2026-10-28');
const K = Object.fromEntries(examples['keys.json'].keys.map((k) => [k.role, k.pubkey]));
check(statement.pubkey === K['platform-receipts'] && rootEv.pubkey === K['platform-transparency'], 'statement and root signed by the published platform keys');
const devAuth = examples['17710-device-authorization.json'];
const authorized = devAuth.tags.filter((t) => t[0] === 'device').map((t) => t[1]);
for (const f of ['7710-payment-request.json', '37710-payment-link.json']) {
  check(authorized.includes(examples[f].pubkey) && examples[f].tags.some((t) => t[0] === 'merchant' && t[1] === devAuth.pubkey), `${f} signed by a device the merchant root authorized`);
}
const journal = examples['7714-terminal-journal.json'].inner;
const receipt = examples['7711-receipt.json'];
check(receipt.tags.some((t) => t[0] === 'e' && t[1] === journal.id && t[3] === 'journal') && authorized.includes(journal.pubkey), 'receipt references the device-signed journal entry');
const nip98 = examples['27235-nip98-login.json'];
check(nip98.event.tags.find((t) => t[0] === 'payload')[1] === bytesToHex(sha256(utf8ToBytes(nip98.request_body))), 'NIP-98 payload tag = SHA-256(request body)');
check(JSON.parse(Buffer.from(nip98.authorization_header.slice(6), 'base64').toString()).id === nip98.event.id, 'NIP-98 Authorization header decodes to the event');
const loginDoc = docJson.find((j) => j.value.dpop_jwk && j.value.device_id);
check(loginDoc && JSON.stringify(loginDoc.value) === nip98.request_body, 'NIP-98 login body in 02 §3.2 is the signed body');
const header = docs.find((d) => d.rel.endsWith('02-api-reference.md')).text.match(/Authorization: Nostr ([A-Za-z0-9+/=]+)/)[1];
check(nip98.authorization_header.slice(6).startsWith(header), 'NIP-98 header in 02 §3.2 is a prefix of the real header');

// ---------------------------------------------------------------- 4. Payments arithmetic
section('4. Pix BR Codes, webhook vector, fees, routing');
const crc16 = (s) => {
  let c = 0xffff;
  for (const ch of Buffer.from(s, 'utf8')) {
    c ^= ch << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
};
const allText = docs.map((d) => d.text).join('\n') + JSON.stringify(examples);
const brCodes = new Set([...allText.matchAll(/000201[0-9A-Za-z.\/ *_-]*?6304([0-9A-F]{4})/g)].map((m) => m[0]));
for (const code of brCodes) check(crc16(code.slice(0, -4)) === code.slice(-4), `Pix BR Code CRC16 ${code.slice(-4)} valid (${code.length} chars)`);
check(brCodes.size > 0, 'found Pix BR Codes to check');

// The integration guide's verifiers (10 §4), run against the same vector: valid, tampered,
// stale and mid-rotation deliveries.
{
  const vector = docJson.map((j) => j.value.webhook_test_vector).find(Boolean);
  const guide = docs.find((d) => d.rel.endsWith('10-integration-guide.md'))?.text || '';
  const js = /```js\n([\s\S]*?export function verifyWebhook[\s\S]*?)```/.exec(guide)?.[1];
  const py = /```python\n([\s\S]*?def verify_webhook[\s\S]*?)```/.exec(guide)?.[1];
  if (js) {
    const { verifyWebhook } = await import('data:text/javascript,' + encodeURIComponent(js));
    const h = { 'webhook-id': vector.webhook_id, 'webhook-timestamp': vector.timestamp, 'webhook-signature': vector.signature };
    const now = Number(vector.timestamp);
    check(verifyWebhook(vector.secret, h, vector.body, now) && !verifyWebhook(vector.secret, h, vector.body + ' ', now)
      && !verifyWebhook(vector.secret, h, vector.body, now + 301) && verifyWebhook(vector.secret, { ...h, 'webhook-signature': 'v1,AAAA ' + vector.signature }, vector.body, now),
    '10 §4: the JavaScript verifier accepts the vector and refuses a tampered body and a stale timestamp; any signature passes during a rotation');
  } else bad('10 §4: no JavaScript verifier found');
  if (py) {
    const run = spawnSync('python3', ['-I', '-c', `${py}\nimport json, sys\nv = json.loads(sys.argv[1])\nh = {'webhook-id': v['webhook_id'], 'webhook-timestamp': v['timestamp'], 'webhook-signature': v['signature']}\nb = v['body'].encode()\nn = int(v['timestamp'])\nok = verify_webhook(v['secret'], h, b, n) and not verify_webhook(v['secret'], h, b + b' ', n) and not verify_webhook(v['secret'], h, b, n + 301) and verify_webhook(v['secret'], dict(h, **{'webhook-signature': 'v1,AAAA ' + v['signature']}), b, n)\nprint('ok' if ok else 'fail')`, JSON.stringify(vector)], { encoding: 'utf8' });
    if (run.error) console.log('  skip 10 §4 Python verifier: python3 not installed');
    else check(run.stdout.trim() === 'ok', '10 §4: the Python verifier behaves the same' + (run.stdout.trim() === 'ok' ? '' : ': ' + (run.stderr || run.stdout)));
  } else bad('10 §4: no Python verifier found');
}

for (const { doc, value } of docJson) {
  const v = value.webhook_test_vector;
  if (!v) continue;
  const mac = createHmac('sha256', Buffer.from(v.secret.slice(6), 'base64')).update(`${v.webhook_id}.${v.timestamp}.${v.body}`).digest();
  const given = Buffer.from(v.signature.split(',')[1], 'base64');
  check(given.length === mac.length && timingSafeEqual(given, mac), `${doc}: Standard Webhooks v1 signature verifies`);
  const httpBlock = docs.find((d) => d.rel === doc).text;
  check(httpBlock.includes(v.body) && httpBlock.includes(v.signature) && httpBlock.includes(`webhook-timestamp: ${v.timestamp}`), `${doc}: HTTP example uses the same body, timestamp and signature`);
}

// Instant settlement pricing (07 §1.3): fee = round_half_up(A × ((1 + r)^(d/252) − 1)).
const advance = (a, r, d) => Math.floor(a * (Math.pow(1 + r, d / 252) - 1) + 0.5);
const TIER = { A: 0.165, B: 0.18, C: 0.21 };
const quote = docJson.find((j) => j.value.object === 'payout_quote')?.value;
if (!quote) bad('payout quote example not found');
else {
  const r = TIER[quote.risk_tier];
  for (const line of quote.funding.advance_detail) check(line.fee === advance(line.amount, r, line.business_days), `quote: fee ${line.fee} for ${line.amount} over ${line.business_days} DU at tier ${quote.risk_tier}`);
  const feeTotal = quote.funding.advance_detail.reduce((a, l) => a + l.fee, 0);
  check(quote.fee_total === feeTotal && quote.net_to_destination === quote.amount - feeTotal, 'quote: fee_total and net_to_destination add up');
  check(quote.funding.from_available + quote.funding.advanced === quote.amount, 'quote: available + advanced = amount');
  check(quote.effective_monthly_rate_bps === Math.round((Math.pow(1 + r, 21 / 252) - 1) * 10000), 'quote: effective monthly rate');
  const payout = docJson.find((j) => j.value.object === 'payout')?.value;
  check(payout && payout.amount === quote.net_to_destination, 'payout amount = quote net_to_destination');
}
const d04 = docs.find((d) => d.rel.endsWith('04-serverless-backend.md')).text;
const releaseFee = advance(12576, TIER.A, 21);
check(d04.includes(`\`revenue.advance_fees\` ${releaseFee}`) && d04.includes(`\`merchant_wallet.m\` ${12576 - releaseFee}`), `ledger example uses the tier A advance fee (${releaseFee})`);
const d07 = docs.find((d) => d.rel.endsWith('07-enhancements.md')).text;
const brl = (c) => 'R$ ' + Math.floor(c / 100).toLocaleString('pt-BR') + ',' + String(c % 100).padStart(2, '0');
for (const [a, tier, d] of [[12576, 'A', 21], [61200, 'B', 1], [154580, 'B', 21], [100000, 'A', 1]]) {
  const f = advance(a, TIER[tier], d);
  check(d07.includes(`| ${brl(a)} | ${d} | ${tier} | ${brl(f)} |`), `07 §1.3 row: ${brl(a)} over ${d} DU, tier ${tier} → ${brl(f)}`);
}

// Routing example (01 §6.3): E = p × margin − (1 − p) × per-attempt fee.
const d01 = docs.find((d) => d.rel.endsWith('01-acquiring-engine.md')).text;
const mdr = 638, ic = 320;
for (const [p, fees, token, attempt] of [[0.93, 23, 2, 3], [0.9, 23, 0, 3], [0.91, 75, 0, 5]]) {
  const margin = mdr - ic - fees - token;
  const e = (p * margin - (1 - p) * attempt) / 100;
  check(d01.includes(`R$ ${(margin / 100).toFixed(2)} |`) && d01.includes(`R$ ${e.toFixed(4)}`), `01 §6.3: p=${p} → margin R$ ${(margin / 100).toFixed(2)}, E R$ ${e.toFixed(4)}`);
}
// Card capture journal (04 §3.4) balances with the stated fees.
check(12990 - Math.round(12990 * 0.016) - (Math.round(12990 * 0.001) + 3) === 12766 && 12990 - fee(12990, 319) === 12576, 'card_capture amounts follow from MDR 3.19%, interchange 1.60%, scheme 0.10% + R$ 0,03');

// ---------------------------------------------------------------- 4b. API payloads vs OpenAPI
section('4b. API payloads in 02 validate against openapi.yaml');
const openapi = YAML.parse(readFileSync(join(root, 'api', 'openapi.yaml'), 'utf8'));
const oas = new Ajv2020({ strict: false, allErrors: true });
addFormats(oas);
oas.addSchema({ $id: 'oas', components: openapi.components });
const schemaFor = (v) => {
  const byObject = {
    payment_intent: 'PaymentIntent', refund: 'Refund', payment_method: 'PaymentMethod', dispute: 'Dispute', account: 'Account',
    transfer: 'Transfer', payout_quote: 'PayoutQuote', payout: 'Payout', merchant: 'Merchant', device: 'Device', settlement: 'Settlement', risk_review: 'RiskReview',
    conversion: 'Conversion', crypto_withdrawal: 'CryptoWithdrawal', international_payout: 'InternationalPayout', investment_order: 'InvestmentOrder', portfolio: 'Portfolio',
    compliance_case: 'ComplianceCase', travel_rule_message: 'TravelRuleMessage', address_screening: 'AddressScreening', webhook_secret: 'RotatedSecret', day_summary: 'DaySummary', period_summary: 'PeriodSummary', webhook_endpoint: 'WebhookEndpoint',
  };
  if (v.object && byObject[v.object]) return byObject[v.object];
  if ('access_token' in v) return 'AccessToken';
  if ('session_token' in v) return 'Session';
  if ('type' in v && 'title' in v && 'status' in v && 'code' in v) return 'Problem';
  if ('ledger_version' in v) return 'Balance';
  if ('statement_inclusion' in v && !('root' in v.statement_inclusion)) return 'InclusionProof';
  if ('sred' in v) return 'TerminalAuthorizationRequest';
  if ('authorization_code' in v && 'status' in v) return 'TerminalAuthorizationResult';
  if ('legal' in v && 'root_npub' in v) return 'MerchantCreate';
  if (v.type === 'card' && v.card?.number) return 'PaymentMethodCreate';
  if ('payment_method_types' in v && !('id' in v)) return 'PaymentIntentCreate';
  if (('three_ds' in v || v.payment_method_type === 'crypto') && !('id' in v)) return 'PaymentIntentConfirm';
  if ('ivms101' in v && 'originator_vasp' in v) return 'TravelRuleInbound';
  if ('address' in v && 'network' in v && !('id' in v)) return 'CryptoWithdrawalCreate';
  if ('beneficiary' in v && !('id' in v)) return 'InternationalPayoutCreate';
  if ('side' in v && 'asset' in v && !('id' in v) && !('address' in v)) return 'ConversionCreate';
  if (('accepted' === v.status || 'rejected' === v.status) && 'reference' in v && !('object' in v)) return 'TravelRuleAnswer';
  if ('profile' in v && 'answers' in v) return 'InvestorProfile';
  if ('ticker' in v && 'lot' in v && 'market_open' in v) return 'InstrumentQuote';
  if ('receive' in v && 'currency' in v) return 'InternationalAccount';
  return null;
};
let apiChecked = 0;
for (const { doc, i, value } of docJson.filter((j) => j.doc.endsWith('02-api-reference.md'))) {
  const name = schemaFor(value);
  if (!name) continue;
  const validate = oas.getSchema('oas#/components/schemas/' + name);
  apiChecked++;
  if (!validate(value)) bad(`${doc} block #${i + 1} (${name}): ${oas.errorsText(validate.errors)}`);
}
check(apiChecked >= 20, `${apiChecked} request and response examples matched to an OpenAPI schema and validated`);
// The summaries' examples add up the way the platform computes them.
for (const { value } of docJson.filter((j) => j.doc.endsWith('02-api-reference.md'))) {
  if (value.object !== 'day_summary' && value.object !== 'period_summary') continue;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const buckets = value.object === 'day_summary' ? value.hourly : value.daily.map((d) => d.gross);
  const pct = (now, before) => Math.round(((now - before) * 1000) / before) / 10;
  const cmp = value.last_week ?? value.previous;
  check(sum(buckets) === value.gross && sum(value.by_method.map((m) => m.gross)) === value.gross && sum(value.by_method.map((m) => m.sales)) === value.sales
    && value.net === value.gross - value.refunded - value.fees && value.average_ticket === Math.floor(value.gross / value.sales)
    && cmp.change_pct === pct(value.gross, cmp.gross) && (value.object === 'day_summary' || sum(cmp.daily) === cmp.gross),
  `02 ${value.object} example: buckets, methods, net, average ticket and change add up`);
}

// Every route the platform serves is in the contract, and every operation the contract offers
// is served, unless the contract marks it planned (x-goonerspay-availability). Path parameter
// names may differ ({id} and {terminal_id} are the same route).
{
  const server = readFileSync(join(root, 'platform', 'internal', 'api', 'server.go'), 'utf8');
  const norm = (m, p) => `${m} ${p.replace(/\{[^}]+\}/g, '{}')}`;
  const served = new Set([...server.matchAll(/(?:route|open)\("([A-Z]+) (\/[^"]*)"/g)].map((m) => norm(m[1], m[2])));
  const offered = new Set();
  const planned = new Set();
  for (const [p, ops] of Object.entries(openapi.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
      (op['x-goonerspay-availability'] === 'planned' ? planned : offered).add(norm(m.toUpperCase(), p));
    }
  }
  const undocumented = [...served].filter((r) => !offered.has(r));
  const unserved = [...offered].filter((r) => !served.has(r));
  const plannedServed = [...planned].filter((r) => served.has(r));
  check(!undocumented.length, `${served.size} routes served by the platform are in openapi.yaml${undocumented.length ? '; not documented: ' + undocumented.join(', ') : ''}`);
  check(!unserved.length, `${offered.size} operations openapi.yaml offers are served${unserved.length ? '; not served: ' + unserved.join(', ') : ''} (${planned.size} marked planned)`);
  check(!plannedServed.length, `no operation marked planned is already served${plannedServed.length ? ': ' + plannedServed.join(', ') : ''}`);
}
{
  const r = spawnSync(process.execPath, [join(here, 'gen-postman.mjs'), '--check'], { encoding: 'utf8' });
  check(r.status === 0, 'the Postman collection is generated from the current openapi.yaml' + (r.status ? ': ' + r.stderr.trim() : ''));
}

// ---------------------------------------------------------------- 5. Design tokens
section('5. Design tokens: contrast and colour-vision tables');
const tokens = JSON.parse(readFileSync(join(root, 'design', 'tokens.json'), 'utf8'));
const tok = resolveTokens(tokens);
for (const p of tokens.$extensions['goonerspay.contrastPairs']) {
  const c = contrast(tok(p.theme, p.fg), tok(p.theme, p.bg));
  if (c < p.min) bad(`${p.theme} ${p.fg} on ${p.bg}: ${fmt(c)} < ${p.min}`);
}
ok(`${tokens.$extensions['goonerspay.contrastPairs'].length} token pairs meet their WCAG minimum`);
// Chart identity hues: a categorical palette per theme, held to the data-visualization method
// (docs/06 §8): lightness band, chroma, colour-vision and normal-vision distance, contrast.
for (const p of tokens.$extensions['goonerspay.chartPalettes']) {
  const hexes = p.roles.map((r) => tok(p.theme, r));
  const r = checkCategorical(hexes, { mode: p.mode, surface: tok(p.theme, p.surface), pairs: p.pairs, relief: p.relief });
  check(r.fails.length === 0, `${p.theme} chart palette (${p.roles.length} hues, ${p.pairs} pairs): colour-vision ΔE ${r.cvd.toFixed(1)}, normal ΔE ${r.normal.toFixed(1)}${r.fails.length ? ': ' + r.fails.join('; ') : ''}`);
}
{
  // The platforms' generated tokens (Kotlin, Swift, CSS) match tokens.json (docs/06 §8).
  const gen = spawnSync(process.execPath, [join(root, 'tools', 'gen-tokens.mjs'), '--check'], { encoding: 'utf8' });
  check(gen.status === 0, 'the Android, iOS and console tokens are generated from tokens.json' + (gen.status === 0 ? '' : ': ' + gen.stderr.trim()));
}
for (const p of tokens.$extensions['goonerspay.rejected']) if (contrast(p.fg, p.bg) >= p.min) bad(`rejected pair ${p.fg}/${p.bg} actually passes`);
let rows = 0;
for (const d of docs) {
  for (const m of d.text.matchAll(/\| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \| ([0-9.]+):1 \|/g)) {
    rows++;
    if (fmt(contrast(m[1], m[2])) !== m[3]) bad(`${d.rel}: ${m[1]} on ${m[2]} is ${fmt(contrast(m[1], m[2]))}:1, document says ${m[3]}:1`);
  }
  for (const m of d.text.matchAll(/\(([0-9]+\.[0-9]{2}):1, fails WCAG AA\)/g)) {
    if (fmt(contrast('#FFFFFF', '#10B981')) !== m[1]) bad(`${d.rel}: white on mint quoted as ${m[1]}:1`);
  }
}
check(rows >= 27, `${rows} contrast ratios in the documents match the computed values`);
const d06 = docs.find((d) => d.rel.endsWith('06-design-system.md')).text;
for (const m of d06.matchAll(/`(#[0-9A-F]{6})` vs [a-z]+ `(#[0-9A-F]{6})`[^|]*\| ([0-9.]+) \| \**([0-9.]+)\** \| ([0-9.]+) \| ([0-9.]+):1 \|/g)) {
  const [, a, b, n, deu, pro, lc] = m;
  const want = [deltaE(a, b), deltaE(simulate(a, 'deutan'), simulate(b, 'deutan')), deltaE(simulate(a, 'protan'), simulate(b, 'protan'))].map((x) => x.toFixed(1));
  check(JSON.stringify([n, deu, pro]) === JSON.stringify(want) && fmt(contrast(a, b)) === lc, `CVD row ${a} vs ${b}: ΔE ${want.join(' / ')}, luminance ${fmt(contrast(a, b))}:1`);
}

// ---------------------------------------------------------------- 6. Identifiers and keys
section('6. Identifiers, npubs, links and anchors');
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const idRe = /\b(pi|pm_card|acc|po|pq|dp|mer|dev|st|re|tr|jr|evt|ten|req|rcpt|3ds|file|sess)_([0-9A-Za-z]+)\b/g;
const idSources = [...docs.map((d) => [d.rel, d.text]), ['api/openapi.yaml', readFileSync(join(root, 'api', 'openapi.yaml'), 'utf8')], ['nostr/examples', JSON.stringify(examples)]];
let ids = 0;
for (const [name, text] of idSources) {
  for (const m of text.matchAll(idRe)) {
    if (m[2] === 'live' || m[2] === 'secret') continue; // session-token and client-secret prefixes, not IDs
    ids++;
    if (!ULID.test(m[2])) bad(`${name}: ${m[0]} is not a prefixed ULID (26 Crockford base32 characters)`);
  }
}
ok(`${ids} prefixed IDs checked`);
let npubs = 0;
for (const [name, text] of idSources) {
  for (const m of text.matchAll(/\bnpub1[02-9ac-hj-np-z]+\b/g)) {
    npubs++;
    try {
      const dec = nip19.decode(m[0]);
      if (dec.type !== 'npub') bad(`${name}: ${m[0]} is not an npub`);
      else if (!Object.values(K).includes(dec.data)) bad(`${name}: ${m[0].slice(0, 16)}… is not one of the published test keys`);
    } catch (e) {
      bad(`${name}: invalid npub ${m[0].slice(0, 16)}… (${e.message})`);
    }
  }
}
ok(`${npubs} npubs decode and belong to the published test keys`);

// GitHub-style heading anchors.
const slug = (h) =>
  h
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
const anchorsOf = (text) => {
  const seen = {};
  const out = new Set();
  for (const m of text.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6} (.+)$/gm)) {
    let s = slug(m[1]);
    if (s in seen) s = `${s}-${++seen[s]}`;
    else seen[s] = 0;
    out.add(s);
  }
  return out;
};
let links = 0;
for (const d of docs) {
  const prose = d.text.replace(/```[\s\S]*?```/g, '');
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) continue;
    links++;
    const [file, anchor] = href.split('#');
    const target = file ? resolve(dirname(d.path), file) : d.path;
    if (!existsSync(target)) {
      bad(`${d.rel}: broken link ${href}`);
      continue;
    }
    if (anchor && target.endsWith('.md') && !anchorsOf(readFileSync(target, 'utf8')).has(anchor)) bad(`${d.rel}: missing anchor ${href}`);
  }
}
ok(`${links} relative links and anchors checked`);
check(relative(repoRoot, root) === 'payments', 'spec lives in <repo>/payments');

// The ledger migration shipped with the platform is the DDL of docs/04 §3.2.
const migration = join(root, 'platform', 'internal', 'db', 'migrations', '0001_ledger.sql');
if (existsSync(migration)) {
  const ddl = d04.match(/```sql\n([\s\S]*?)```/)[1];
  const body = readFileSync(migration, 'utf8').split('\n').filter((l) => !l.startsWith('-- 0001') && !l.startsWith('-- PostgreSQL-compatible')).join('\n').trim();
  check(body === ddl.trim(), 'platform migration 0001_ledger.sql equals the DDL in docs/04 §3.2');
}

// ---------------------------------------------------------------- 6b. Mobile conformance vectors
// The vectors the Android and iOS apps test against are generated by the Go platform; a third
// implementation (noble-curves, nostr-tools) checks them here.
const vecFile = join(root, 'mobile', 'conformance', 'vectors.json');
if (existsSync(vecFile)) {
  section('6b. Mobile conformance vectors (generated in Go, checked in JavaScript)');
  const vec = JSON.parse(readFileSync(vecFile, 'utf8'));
  const { schnorr } = await import('@noble/curves/secp256k1.js');
  check(vec.bip340.every((x) => bytesToHex(schnorr.sign(hexToBytes(x.message), hexToBytes(x.secret), hexToBytes(x.aux))) === x.signature
    && bytesToHex(schnorr.getPublicKey(hexToBytes(x.secret))) === x.pubkey), `${vec.bip340.length} BIP-340 signatures reproduce byte for byte`);
  check(vec.test_keys.every((k) => bytesToHex(sha256(utf8ToBytes('goonerspay-spec/test-key/' + k.role))) === k.secret
    && nip19.npubEncode(k.pubkey) === k.npub && nip19.nsecEncode(hexToBytes(k.secret)) === k.nsec), 'test keys, npubs and nsecs');
  const ser = (e) => JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  check(vec.events.every((x) => ser(x.event) === x.serialization && bytesToHex(sha256(utf8ToBytes(x.serialization))) === x.event.id
    && schnorr.verify(hexToBytes(x.event.sig), hexToBytes(x.event.id), hexToBytes(x.event.pubkey))), `${vec.events.length} NIP-01 serializations (escaping edge cases) and signatures`);
  const nip98 = JSON.parse(Buffer.from(vec.nip98.authorization_header.slice(6), 'base64').toString());
  check(nip98.id === vec.nip98.event.id && verifyEventStrict(nip98).length === 0 && nip98.tags.find((t) => t[0] === 'payload')[1] === bytesToHex(sha256(utf8ToBytes(vec.nip98.body))), 'NIP-98 login vector');
  check(verifyEventStrict(vec.device_list.event).length === 0, 'kind 17710 device list vector');
  check(vec.canonical_json.every((c) => canonicalJson(JSON.parse(c.json)) === c.canonical), `${vec.canonical_json.length} canonical JSON vectors match JavaScript's canonicalJson`);
  {
    const entries = vec.journal.entries;
    const chained = entries.every((e, i) =>
      verifyEventStrict(e.event).length === 0 && e.event.kind === 7714 && e.event.content === canonicalJson(e.fields) &&
      JSON.parse(e.event.content).prev === (i === 0 ? null : entries[i - 1].event.id) && e.event.pubkey === testKey(vec.journal.device_role).pk);
    check(chained, 'kind 7714 journal vector: canonical content, signatures and the prev chain');
  }
  const j = vec.jwk_thumbprint.jwk;
  check(Buffer.from(sha256(utf8ToBytes(`{"crv":"${j.crv}","kty":"${j.kty}","x":"${j.x}","y":"${j.y}"}`))).toString('base64url') === vec.jwk_thumbprint.thumbprint, 'JWK thumbprint (RFC 7638)');
  const { createDecipheriv } = await import('node:crypto');
  const blob = Buffer.from(vec.dev_card.ciphertext_base64, 'base64');
  const dc = createDecipheriv('aes-256-gcm', Buffer.from(vec.dev_card.key, 'hex'), blob.subarray(0, 12));
  dc.setAAD(Buffer.from(vec.dev_card.ksn));
  dc.setAuthTag(blob.subarray(blob.length - 16));
  check(Buffer.concat([dc.update(blob.subarray(12, blob.length - 16)), dc.final()]).toString() === vec.dev_card.plaintext, 'sandbox card blob decrypts');
  check(vec.brcode.every((b) => crc16(b.code.slice(0, -4)) === b.code.slice(-4)), 'BR Code CRCs');
  // The on-device fraud model (07 §3.3), a third time: heaviest signals first, a noisy OR in
  // integer thousandths truncated at every step.
  const dr = vec.device_risk;
  const deviceScore = (signals) => {
    const known = [...new Set(signals.filter((s) => s in dr.weights))].sort((a, b) => dr.weights[b] - dr.weights[a] || (a < b ? -1 : a > b ? 1 : 0));
    let clean = 1000;
    for (const s of known) clean = Math.trunc((clean * (1000 - dr.weights[s])) / 1000);
    return [1000 - clean, known.slice(0, dr.max_signals)];
  };
  check(dr.cases.every((c) => { const [m, sent] = deviceScore(c.signals); return m === c.score_milli && JSON.stringify(sent) === JSON.stringify(c.sent); }),
    `${dr.cases.length} device risk vectors (model ${dr.model}) match JavaScript's scoring`);
  const signalDocs = d07;
  check(Object.keys(dr.weights).every((s) => signalDocs.includes('`' + s + '`')), 'every device signal code is documented in 07 §3.3');
}

// ---------------------------------------------------------------- 6d. Web console formats and charts
// format.js holds the console's amount parsers and its sales chart model: the same rules and
// cases as Money.parseReais and Today in the Kotlin and Swift cores (TodayTest, TodayTests).
const consoleFormat = join(root, 'platform', 'internal', 'console', 'static', 'format.js');
if (existsSync(consoleFormat)) {
  section('6d. Web console formats and charts (same cases as the app cores)');
  const f = await import(consoleFormat);
  const reais = { '150': 15000, '150,5': 15050, '150,05': 15005, ' 0,99 ': 99, '1.234,56': 123456, '1.234.567': 123456700 };
  check(Object.entries(reais).every(([k, v]) => f.parseReais(k) === v) && ['', ',50', '1,234', '12.34', '1.23,00', 'abc', '-5', '1,2,3', '12345678901'].every((k) => f.parseReais(k) === null),
    'parseReais takes what people type and refuses "12.34" (never read as R$ 1.234 or R$ 12,34), as both apps do');
  const qty = { '0,5': '0.5', '1.234,56': '1234.56', '0.001': '0.001', '1.5': '1.5', '100.00': '100.00', '1.000.000': '1000000' };
  check(Object.entries(qty).every(([k, v]) => f.parseQuantity(k) === v) && ['1.000', '12.345', '', '-1', '1,2,3'].every((k) => f.parseQuantity(k) === null),
    'parseQuantity refuses an amount that could be a thousand or one ("1.000")');
  const compact = { 0: 'R$ 0', 90000: 'R$ 900', 99950: 'R$ 1 mil', 149999: 'R$ 1,5 mil', 250000: 'R$ 2,5 mil', 1000000: 'R$ 10 mil', 1234000: 'R$ 12 mil',
    99999999: 'R$ 1 mi', 125000000: 'R$ 1,3 mi', 1500000000: 'R$ 15 mi' };
  check(Object.entries(compact).every(([k, v]) => f.compact(Number(k)) === v), 'compact axis labels match the app cores');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(same(f.ticks(0), [0, 10000]) && same(f.ticks(50), [0, 100]) && same(f.ticks(12000), [0, 5000, 10000, 15000]) && same(f.ticks(1000000), [0, 500000, 1000000])
    && same(f.ticks(1200000), [0, 500000, 1000000, 1500000]) && same(f.axis(24), [0, 6, 12, 18, 23]) && same(f.axis(7), [0, 1, 2, 3, 4, 5, 6]) && same(f.axis(30), [0, 6, 12, 18, 24, 29]),
  'axis ticks and labels match the app cores');
  check(same(f.shares([10000, 2000]), [83, 17]) && same(f.shares([1, 1, 1]), [34, 33, 33]) && same(f.shares([0, 0]), [0, 0]) && f.change(50) === '+50%' && f.change(-12.5) === '−12,5%'
    && f.change(0) === '0%' && f.change(null) === null && f.versus('2026-10-30', true) === 'vs. sexta passada até agora' && f.versus('2026-11-01', false) === 'vs. domingo passado',
  'shares, changes and weekdays match the app cores');
  const ex = (section) => docJson.find((j) => j.doc.endsWith('02-api-reference.md') && j.value.object === section)?.value;
  const day = f.dayView(ex('day_summary'), true);
  const period = f.periodView(ex('period_summary'), '2026-11-06');
  check(day.title === 'Hoje' && day.change === '+50%' && day.compareName === 'sexta passada' && day.compare.length === 24 && same(day.ticks, [0, 5000, 10000])
    && day.labels[11] === '11h' && day.spoken[23] === '23h às 0h' && same(day.axis, [0, 6, 12, 18, 23]), 'the day example draws as both apps draw it');
  check(period.title === 'Últimos 7 dias' && period.range === '31/10 a 06/11' && period.change === '+12,4%' && period.versus === 'vs. os 7 dias anteriores até agora'
    && period.spoken[0] === 'sábado, 31/10' && same(period.byMethod.map((m) => m.method), ['credit', 'debit', 'pix']) && period.shares.reduce((a, b) => a + b, 0) === 100
    && same(period.ticks, [0, 50000, 100000, 150000]) && period.compare.length === 7, 'the period example draws as both apps draw it');
}

// ---------------------------------------------------------------- 6c. Web console verifier
// The console verifies statements in the browser with its own BIP-340 and RFC 6962 code
// (platform/internal/console/static/verify.js); it is held to the signed examples here.
const consoleVerify = join(root, 'platform', 'internal', 'console', 'static', 'verify.js');
if (existsSync(consoleVerify)) {
  section('6c. Web console verifier (browser code, run in Node)');
  const cv = await import(consoleVerify);
  const st = examples['7713-settlement-statement.json'];
  const rt = examples['7715-transparency-root.json'];
  const mid = JSON.parse(st.content).merchant_id;
  const keys = [K['platform-receipts'], K['platform-transparency']];
  const good = await cv.verifyStatement(st, rt, mid, keys);
  check(good.check.ok, 'the console verifies the example statement against the published root and keys');
  const forged = { ...st, content: st.content.replace(/"gross":\d+/, '"gross":1') };
  check(!(await cv.verifyStatement(forged, rt, mid, keys)).check.ok, 'the console rejects a statement with altered totals');
  check(!(await cv.verifyStatement(st, rt, mid, [K['platform-receipts']])).check.ok, 'the console rejects a root signed by a key not on the list');
  check(!(await cv.verifyStatement(st, rt, 'mer_someone_else', keys)).check.ok, "the console rejects another merchant's statement");
  check(await cv.receiptIncluded(good.statement, examples['proof-receipt-0.json']), 'the console proves a receipt is in the statement');
  const events = Object.values(examples).filter((e) => e && typeof e.sig === 'string');
  const verified = await Promise.all(events.map((e) => cv.verifyEvent(e)));
  check(verified.every(Boolean), `the console's BIP-340 code verifies all ${events.length} example events`);
}

// ---------------------------------------------------------------- 6e. Receipt claim page
// The page a receipt's QR opens (platform/internal/console/static/claim/nostr.js) signs the
// relay's NIP-42 challenge and opens the gift wrap with its own BIP-340, NIP-44 v2 and NIP-59
// code; it is held here to the signed example and to nostr-tools.
const claimCrypto = join(root, 'platform', 'internal', 'console', 'static', 'claim', 'nostr.js');
if (existsSync(claimCrypto)) {
  section('6e. Receipt claim page (browser code, run in Node)');
  const cn = await import(claimCrypto);
  const pure = await import('nostr-tools/pure');
  const nt44 = await import('nostr-tools/nip44');
  const ex = examples['1059-receipt-giftwrap.json'];
  const k = ex.claim_url.split('#k=')[1];
  const opened = await cn.unwrapReceipt(ex.wrap, k, K['platform-receipts']).catch((e) => ({ error: e.message }));
  check(!opened.error && opened.seal.id === ex.seal.id && opened.receipt.kind === 7711 && opened.receipt.pubkey === K['platform-receipts'],
    'the claim page opens the example gift wrap with its claim key: wrap, seal and receipt signatures, signed by the receipts key' + (opened.error ? ': ' + opened.error : ''));
  const refused = async (wrap, signer) => cn.unwrapReceipt(wrap, k, signer).then(() => false, () => true);
  check(await refused({ ...ex.wrap, content: ex.wrap.content.slice(0, 40) + (ex.wrap.content[40] === 'A' ? 'B' : 'A') + ex.wrap.content.slice(41) }, K['platform-receipts']) &&
    await refused(ex.wrap, K['platform-transparency']), 'it refuses an altered wrap and a receipt sealed by another key');
  const sk = pure.generateSecretKey();
  const peer = pure.generateSecretKey();
  const hexOf = (b) => Buffer.from(b).toString('hex');
  const ev = await cn.signEvent({ kind: 22242, created_at: 1700000000, tags: [['relay', 'wss://relay.example'], ['challenge', 'c1']], content: '' }, hexOf(sk));
  check(cn.publicKey(hexOf(sk)) === pure.getPublicKey(sk) && pure.verifyEvent({ ...ev }), "its NIP-42 AUTH event is signed as nostr-tools expects (BIP-340, NIP-01 id)");
  const ckOurs = await cn.conversationKey(hexOf(sk), pure.getPublicKey(peer));
  const ckTheirs = nt44.v2.utils.getConversationKey(sk, pure.getPublicKey(peer));
  let interop = hexOf(ckOurs) === hexOf(ckTheirs);
  for (const msg of ['a', 'recibo ✓ R$ 12,90', 'x'.repeat(300), 'y'.repeat(65535)]) {
    interop &&= (await cn.nip44Decrypt(nt44.v2.encrypt(msg, ckTheirs), ckOurs)) === msg && nt44.v2.decrypt(await cn.nip44Encrypt(msg, ckOurs), ckTheirs) === msg;
  }
  check(interop, 'its NIP-44 v2 conversation keys and encryption interoperate with nostr-tools both ways (1 to 65,535 bytes)');
}

// ---------------------------------------------------------------- 7. External tools
if (!fast) {
  section('7. OpenAPI lint, Mermaid rendering, ledger SQL');
  const sub = (cmd, args) => spawnSync(cmd, args, { cwd: here, encoding: 'utf8' });
  const lint = sub('npx', ['--no-install', 'redocly', 'lint', '../api/openapi.yaml', '--config', 'redocly.yaml', '--format', 'stylish']);
  lint.status === 0 ? ok('openapi.yaml lints clean (Redocly)') : bad('openapi.yaml lint failed:\n' + (lint.stdout + lint.stderr).trim().split('\n').slice(-25).join('\n'));
  const mer = sub('node', ['check-mermaid.mjs']);
  mer.status === 0 ? ok(mer.stdout.trim().split('\n').pop()) : bad('Mermaid: ' + (mer.stdout + mer.stderr).trim());
  const led = sub('node', ['check-ledger.mjs']);
  if (led.status === 2) console.log('  skip ledger SQL (PostgreSQL not installed)');
  else led.status === 0 ? ok('ledger DDL, postings and invariants L1–L5 (PostgreSQL)') : bad('ledger:\n' + led.stdout);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
