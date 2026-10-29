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
import { contrast, fmt, resolveTokens, simulate, deltaE } from './color.mjs';

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
const docFiles = [join(root, 'README.md'), ...readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort().map((f) => join(docsDir, f))];
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
    transfer: 'Transfer', payout_quote: 'PayoutQuote', payout: 'Payout', merchant: 'Merchant', device: 'Device', settlement: 'Settlement',
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
  if ('three_ds' in v && !('id' in v)) return 'PaymentIntentConfirm';
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

// ---------------------------------------------------------------- 5. Design tokens
section('5. Design tokens: contrast and colour-vision tables');
const tokens = JSON.parse(readFileSync(join(root, 'design', 'tokens.json'), 'utf8'));
const tok = resolveTokens(tokens);
for (const p of tokens.$extensions['ipplus.contrastPairs']) {
  const c = contrast(tok(p.theme, p.fg), tok(p.theme, p.bg));
  if (c < p.min) bad(`${p.theme} ${p.fg} on ${p.bg}: ${fmt(c)} < ${p.min}`);
}
ok(`${tokens.$extensions['ipplus.contrastPairs'].length} token pairs meet their WCAG minimum`);
for (const p of tokens.$extensions['ipplus.rejected']) if (contrast(p.fg, p.bg) >= p.min) bad(`rejected pair ${p.fg}/${p.bg} actually passes`);
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
