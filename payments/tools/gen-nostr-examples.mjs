// Generates the signed Nostr examples in ../nostr/examples from deterministic TEST keys.
// Run: npm run gen   (outputs are reproducible: same input, same bytes)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  testKey, det, signEvent, giftWrap, canonicalJson, mth, auditPath, statementLeafData,
  bytesToHex, hexToBytes, sha256, utf8ToBytes, iso, fee,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'nostr', 'examples');
mkdirSync(outDir, { recursive: true });
const write = (name, value) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + '\n');

// ---------- keys ----------
const K = {
  receipts: testKey('platform-receipts'),
  transparency: testKey('platform-transparency'),
  inbox: testKey('platform-inbox'),
  root: testKey('merchant-root'),
  android: testKey('merchant-device-android'),
  ios: testKey('merchant-device-ios'),
  claim1: testKey('customer-claim-1'),
};
write('keys.json', {
  warning: 'PUBLIC TEST KEYS. Secret key = SHA-256("ipplus-spec/test-key/" + role). Never use for anything real.',
  keys: Object.values(K).map(({ role, pk, npub }) => ({ role, pubkey: pk, npub })),
});

const T0 = 1793295730; // 2026-10-29T17:42:10Z
const RELAY = 'wss://relay.ipplus.example';
const MERCHANT_ID = 'mer_01JB8Z2K5D6F7G8H9J0K1M2N3P';

// ---------- 17710 device authorization list (root-signed, public, replaceable) ----------
const deviceAuth = signEvent(
  {
    kind: 17710,
    created_at: T0 - 19800,
    tags: [
      ['v', '1'],
      ['merchant', MERCHANT_ID],
      ['device', K.android.pk, 'android', 'Caixa 1', String(T0 - 19800)],
      ['device', K.ios.pk, 'ios', 'iPad balcão', String(T0 - 19800)],
    ],
    content: '',
  },
  K.root,
  'device-auth',
);
write('17710-device-authorization.json', deviceAuth);

// ---------- 17711 merchant payment profile (root-signed, public, replaceable) ----------
const profile = signEvent(
  {
    kind: 17711,
    created_at: T0 - 19790,
    tags: [['v', '1'], ['relay', RELAY], ['relay', 'wss://relay2.ipplus.example']],
    content: canonicalJson({
      v: 1,
      display_name: 'Café Aurora',
      nip05: 'cafeaurora@ipplus.example',
      cnpj: '12.345.678/0001-95',
      city: 'São Paulo',
      methods: ['card_present', 'pix', 'payment_link'],
      receipts: { relays: [RELAY, 'wss://relay2.ipplus.example'], signer: K.receipts.pk },
    }),
  },
  K.root,
  'profile',
);
write('17711-merchant-profile.json', profile);

// ---------- 27235 NIP-98 login (device-signed) ----------
const loginBody = JSON.stringify({
  dpop_jwk: { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' },
  device_id: 'dev_01JB9A2B3C4D5E6F7G8H9J0K1M',
});
const nip98 = signEvent(
  {
    kind: 27235,
    created_at: T0 - 600,
    tags: [
      ['u', 'https://api.ipplus.example/v1/auth/nostr'],
      ['method', 'POST'],
      ['payload', bytesToHex(sha256(utf8ToBytes(loginBody)))],
    ],
    content: '',
  },
  K.android,
  'nip98',
);
write('27235-nip98-login.json', {
  event: nip98,
  request_body: loginBody,
  authorization_header: 'Nostr ' + Buffer.from(JSON.stringify(nip98)).toString('base64'),
});

// ---------- 7710 payment request (device-signed) ----------
const payReq = signEvent(
  {
    kind: 7710,
    created_at: T0 - 30,
    tags: [['merchant', K.root.pk], ['expiration', String(T0 + 870)]],
    content: canonicalJson({
      v: 1,
      request_id: 'pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0',
      amount: { value: 12990, currency: 'BRL', exponent: 2 },
      description: 'Mesa 4: 2 cappuccinos, 1 pão de queijo, 1 suco',
      methods: ['card_present', 'pix'],
      checkout_url: 'https://pay.ipplus.example/pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0',
      pix_br_code: '00020101021226790014br.gov.bcb.pix2557pix.ipplus.example/qr/v2/9d36b84fc70b478fb95c12729b90ca255204000053039865406129.905802BR5911CAFE AURORA6009SAO PAULO62070503***63047CD0',
      expires_at: iso(T0 + 870),
    }),
  },
  K.android,
  'payreq',
);
write('7710-payment-request.json', payReq);

// ---------- 27710 remote charge (iPad → Android terminal, ephemeral, gift-wrapped as 21059) ----------
const remote = signEvent(
  {
    kind: 27710,
    created_at: T0 - 25,
    tags: [['p', K.android.pk], ['merchant', K.root.pk]],
    content: canonicalJson({ v: 1, action: 'charge', payment_intent_id: 'pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0', amount: { value: 12990, currency: 'BRL', exponent: 2 }, display: 'Mesa 4', ttl_s: 120 }),
  },
  K.ios,
  'remote-charge',
);
const remoteWrapped = giftWrap(remote, K.ios, K.android.pk, 'remote-charge', { wrapKind: 21059 });
write('27710-remote-charge.json', { inner: remote, ...remoteWrapped, recipient: 'merchant-device-android' });

// ---------- 7714 terminal journal (device-signed, hash-chained) ----------
const journalPrevId = bytesToHex(det('journal-prev')); // stands in for seq 411's event id
const journal = signEvent(
  {
    kind: 7714,
    created_at: T0 + 1,
    tags: [['merchant', K.root.pk]],
    content: canonicalJson({
      v: 1,
      seq: 412,
      prev: journalPrevId,
      type: 'auth_result',
      payment_intent_id: 'pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0',
      amount: { value: 12990, currency: 'BRL', exponent: 2 },
      result: 'approved',
      terminal_id: 'TP000418',
      stan: '004211',
      local_time: '2026-10-29T14:42:11-03:00',
      app: { version: '1.8.0', mpoc_sdk: '4.2.1' },
      device_risk: { score_milli: 40, model: 'fs-device-2026-10-a' },
    }),
  },
  K.android,
  'journal',
);
const journalWrapped = giftWrap(journal, K.android, K.inbox.pk, 'journal');
write('7714-terminal-journal.json', { inner: journal, ...journalWrapped, recipient: 'platform-inbox' });

// ---------- a day of receipts (platform-signed) ----------
const sales = [
  { pi: 'pi_01JBK3Z9Y8X7W6V5T4S3R2Q1P0', at: T0, amount: 12990, bps: 319, method: { type: 'card', brand: 'visa', funding: 'credit', last4: '0119', application_label: 'VISA CREDITO', aid: 'A0000000031010', entry_mode: 'contactless', cvm: 'no_cvm' }, auth: { code: 'B7K2Q9', rrn: '630217004211', stan: '004211' }, installments: { count: 1, type: 'none' }, journal: journal.id },
  { pi: 'pi_01JBK4QW7E6R5T4Y3V2X1W0P9A', at: T0 + 780, amount: 4500, bps: 137, method: { type: 'card', brand: 'mastercard', funding: 'debit', last4: '5100', application_label: 'MAESTRO', aid: 'A0000000043060', entry_mode: 'contactless', cvm: 'consumer_device_cvm' }, auth: { code: '771203', rrn: '630217004236', stan: '004236' }, installments: { count: 1, type: 'none' } },
  { pi: 'pi_01JBK5HZ3D2F1G0H9J8K7M6N5P', at: T0 + 1680, amount: 2390, bps: 0, method: { type: 'pix', end_to_end_id: 'E00000000202610291810a1B2c3D4e5F' }, installments: { count: 1, type: 'none' } },
  { pi: 'pi_01JBK8V6B5N4M3Q2W1E0R9T8Y7', at: T0 + 4800, amount: 31000, bps: 499, method: { type: 'card', brand: 'mastercard', funding: 'credit', last4: '4444', application_label: 'MASTERCARD', aid: 'A0000000041010', entry_mode: 'contactless', cvm: 'online_pin' }, auth: { code: 'Q81KZ0', rrn: '630219004311', stan: '004311' }, installments: { count: 3, type: 'merchant' } },
];

const receipts = sales.map((s, i) =>
  signEvent(
    {
      kind: 7711,
      created_at: s.at,
      tags: [['merchant', K.root.pk], ...(s.journal ? [['e', s.journal, RELAY, 'journal']] : [])],
      content: canonicalJson({
        v: 1,
        receipt_id: 'rcpt_' + s.pi.slice(3),
        payment_intent_id: s.pi,
        merchant: { id: MERCHANT_ID, name: 'Café Aurora', cnpj: '12.345.678/0001-95', address: 'Rua Augusta 1500, São Paulo - SP', nip05: 'cafeaurora@ipplus.example' },
        amount: { value: s.amount, currency: 'BRL', exponent: 2 },
        method: s.method,
        ...(s.auth ? { authorization: { ...s.auth, terminal_id: 'TP000418', approved_at: iso(s.at) } } : {}),
        installments: s.installments,
        settlement_date: '2026-10-29',
        fiscal_note: 'Comprovante de pagamento. Não é documento fiscal.',
      }),
    },
    K.receipts,
    'receipt-' + i,
  ),
);
write('7711-receipt.json', receipts[0]);

// Customer delivery: wrapped to the one-time claim key shown as a QR (03 §3.2).
const receiptWrapped = giftWrap(receipts[0], K.receipts, K.claim1.pk, 'receipt-0-claim', {
  wrapAt: T0 + 2,
  sealAt: T0 + 2,
  wrapTags: [['expiration', String(T0 + 2 + 90 * 86400)]], // unclaimed claim wraps expire after 90 days (03 §3.2)
});
write('1059-receipt-giftwrap.json', {
  note: 'Receipt 7711 sealed (kind 13, signed by the receipts key) and gift-wrapped (kind 1059) to the one-time claim key.',
  recipient: 'customer-claim-1',
  claim_url: 'https://r.ipplus.example/c#k=' + K.claim1.skHex,
  ...receiptWrapped,
});

// ---------- 7712 adjustment (next day: partial refund of the installment sale) ----------
const adjustment = signEvent(
  {
    kind: 7712,
    created_at: T0 + 86400,
    tags: [['merchant', K.root.pk], ['e', receipts[3].id, RELAY, 'receipt']],
    content: canonicalJson({
      v: 1,
      type: 'refund',
      refund_id: 're_01JBMQ0A9S8D7F6G5H4J3K2M1N',
      payment_intent_id: sales[3].pi,
      amount: { value: 10000, currency: 'BRL', exponent: 2 },
      reason: 'requested_by_customer',
      processed_at: iso(T0 + 86400),
    }),
  },
  K.receipts,
  'adjustment',
);
write('7712-adjustment.json', adjustment);

// ---------- statement body and its Merkle root over receipt ids ----------
const receiptLeaves = receipts.map((r) => hexToBytes(r.id));
const receiptsRoot = bytesToHex(mth(receiptLeaves));
const gross = sales.reduce((a, s) => a + s.amount, 0);
const fees = sales.reduce((a, s) => a + fee(s.amount, s.bps), 0);
const body = {
  v: 1,
  merchant_id: MERCHANT_ID,
  date: '2026-10-29',
  currency: 'BRL',
  totals: { gross, fees, refunds: 0, chargebacks: 0, net: gross - fees },
  count: receipts.length,
  receipts_root: receiptsRoot,
  receipts_tree: 'rfc6962-sha256, leaves = receipt event ids (32 bytes) in capture order',
  lines: sales.map((s, i) => ({ receipt_event_id: receipts[i].id, amount: s.amount, fee: fee(s.amount, s.bps), settles: s.installments.type === 'merchant' ? 'per_installment' : 'instant' })),
};
const statementCommitment = bytesToHex(sha256(utf8ToBytes(canonicalJson(body))));

// ---------- transparency log: previous day (genesis) and this day ----------
function buildLog(date, ourLeafData, dummies) {
  const leaves = [...dummies.map((d) => d), ...(ourLeafData ? [ourLeafData] : [])];
  // Sort leaves by their leaf hash so a position reveals nothing about merchant order.
  const sorted = leaves
    .map((data) => ({ data, h: bytesToHex(sha256(data)) }))
    .sort((a, b) => (a.h < b.h ? -1 : 1))
    .map((x) => x.data);
  return { date, leaves: sorted, root: bytesToHex(mth(sorted)) };
}
const dummy = (date, n) => Array.from({ length: n }, (_, i) => det(`dummy/${date}/${i}`));

const prevLog = buildLog('2026-10-28', null, dummy('2026-10-28', 8));
const prevRootEvent = signEvent(
  {
    kind: 7715,
    created_at: 1793239200, // 2026-10-29T02:00:00Z
    tags: [['log', 'ipplus-settlement-v1'], ['date', '2026-10-28']],
    content: canonicalJson({ v: 1, log: 'ipplus-settlement-v1', date: '2026-10-28', tree_size: prevLog.leaves.length, root: prevLog.root, prev: null, padding: 'dummy leaves to a multiple of 8 (production: 4096)' }),
  },
  K.transparency,
  'root-2026-10-28',
);
write('7715-transparency-root-2026-10-28.json', prevRootEvent);

const salt = bytesToHex(det('statement-salt/' + MERCHANT_ID + '/2026-10-29'));
const ourLeaf = statementLeafData(salt, statementCommitment);
const log = buildLog('2026-10-29', ourLeaf, dummy('2026-10-29', 7));
const ourIndex = log.leaves.findIndex((l) => bytesToHex(l) === bytesToHex(ourLeaf));
const rootEvent = signEvent(
  {
    kind: 7715,
    created_at: 1793325600, // 2026-10-30T02:00:00Z
    tags: [['log', 'ipplus-settlement-v1'], ['date', '2026-10-29'], ['e', prevRootEvent.id, RELAY, 'prev']],
    content: canonicalJson({ v: 1, log: 'ipplus-settlement-v1', date: '2026-10-29', tree_size: log.leaves.length, root: log.root, prev: prevRootEvent.id, padding: 'dummy leaves to a multiple of 8 (production: 4096)' }),
  },
  K.transparency,
  'root-2026-10-29',
);
write('7715-transparency-root.json', rootEvent);

// ---------- 7713 settlement statement (platform-signed, gift-wrapped to the merchant) ----------
const statement = signEvent(
  {
    kind: 7713,
    created_at: 1793325660, // 2026-10-30T02:01:00Z
    tags: [['merchant', K.root.pk], ['e', rootEvent.id, RELAY, 'transparency']],
    content: canonicalJson({
      ...body,
      statement_commitment: statementCommitment,
      transparency: {
        root_event_id: rootEvent.id,
        leaf_salt: salt,
        leaf_index: ourIndex,
        tree_size: log.leaves.length,
        audit_path: auditPath(ourIndex, log.leaves).map(bytesToHex),
      },
    }),
  },
  K.receipts,
  'statement',
);
write('7713-settlement-statement.json', statement);
write('7713-statement-giftwrap.json', { recipient: 'merchant-root', ...giftWrap(statement, K.receipts, K.root.pk, 'statement-root') });

// Inclusion proof of receipt 0 in the statement (API: GET /v1/settlements/{id}/proofs/{receipt_event_id}).
write('proof-receipt-0.json', {
  receipt_event_id: receipts[0].id,
  statement_inclusion: { leaf_index: 0, tree_size: receipts.length, audit_path: auditPath(0, receiptLeaves).map(bytesToHex), root: receiptsRoot },
  transparency_inclusion: { leaf_index: ourIndex, tree_size: log.leaves.length, audit_path: auditPath(ourIndex, log.leaves).map(bytesToHex), root: log.root },
});

// ---------- 27711 / 27712 reconciliation (ephemeral) ----------
const reconReq = signEvent(
  {
    kind: 27711,
    created_at: T0 + 5400,
    tags: [['p', K.inbox.pk], ['merchant', K.root.pk]],
    content: canonicalJson({ v: 1, journal_head: { seq: 412, id: journal.id }, receipts_since: T0 - 3600, known_receipts: receipts.length }),
  },
  K.android,
  'recon-req',
);
const reconRes = signEvent(
  {
    kind: 27712,
    created_at: T0 + 5401,
    tags: [['p', K.android.pk], ['e', reconReq.id]],
    content: canonicalJson({ v: 1, status: 'consistent', journal_head_seen: { seq: 412, id: journal.id }, receipts: receipts.length, missing: [] }),
  },
  K.inbox,
  'recon-res',
);
write('27711-reconciliation.json', { request: reconReq, response: reconRes });

// ---------- 37710 payment link (addressable, device-signed) ----------
const link = signEvent(
  {
    kind: 37710,
    created_at: T0 - 86400,
    tags: [['d', 'cappuccino'], ['title', 'Cappuccino'], ['price', '990', 'BRL'], ['merchant', K.root.pk]],
    content: canonicalJson({ v: 1, title: 'Cappuccino', amount: { value: 990, currency: 'BRL', exponent: 2 }, checkout_url: 'https://pay.ipplus.example/l/cafeaurora/cappuccino', methods: ['card', 'pix'] }),
  },
  K.android,
  'link',
);
write('37710-payment-link.json', link);

console.log('wrote examples to', outDir);
console.log({ receipt0: receipts[0].id, journal: journal.id, statement: statement.id, root: rootEvent.id, receiptsRoot, gross, fees, net: gross - fees, ourIndex });
console.log('npubs', Object.fromEntries(Object.values(K).map((k) => [k.role, k.npub])));
