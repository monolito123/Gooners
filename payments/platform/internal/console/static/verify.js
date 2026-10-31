// Statement verification in the browser (docs/03 §6.5), trusting nothing the API says: the
// platform's BIP-340 signatures on the statement (kind 7713) and the day's public root (kind
// 7715), the totals, the commitment and the RFC 6962 inclusion of the statement in the root.
// The same checks as the Kotlin and Swift apps and tools/check.mjs; this module runs in Node
// too, which is how the spec checker holds it to the signed examples.

const enc = new TextEncoder();

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s) => {
  if (typeof s !== 'string' || s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('not hex');
  return Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
};
const concat = (...as) => {
  const out = new Uint8Array(as.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of as) {
    out.set(a, i);
    i += a.length;
  }
  return out;
};

export async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

/** Keys sorted, no whitespace, JSON.stringify's string escaping (docs/03 §2.2). */
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  if (typeof v === 'number' && !Number.isInteger(v)) throw new Error('floats are not allowed in canonical JSON');
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- BIP-340 on secp256k1

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod(s0, m);
}
function pow(b, e, m = P) {
  let r = 1n;
  for (b = mod(b, m); e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m;
  return r;
}
function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  if (p[0] === q[0] && mod(p[1] + q[1]) === 0n) return null;
  const l = p[0] === q[0] && p[1] === q[1] ? mod(3n * p[0] * p[0] * inv(2n * p[1])) : mod((q[1] - p[1]) * inv(q[0] - p[0]));
  const x = mod(l * l - p[0] - q[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
}
function mul(k, p) {
  let r = null;
  for (; k > 0n; k >>= 1n, p = add(p, p)) if (k & 1n) r = add(r, p);
  return r;
}
const num = (b) => BigInt('0x' + (hex(b) || '0'));
const bytes32 = (n) => unhex(n.toString(16).padStart(64, '0'));
async function taggedHash(tag, ...msgs) {
  const t = await sha256(enc.encode(tag));
  return sha256(concat(t, t, ...msgs));
}

/** BIP-340 Schnorr verification: pubkey and msg 32 bytes, sig 64 bytes, all hex. */
export async function schnorrVerify(sigHex, msgHex, pubHex) {
  try {
    const [sig, msg, pub] = [unhex(sigHex), unhex(msgHex), unhex(pubHex)];
    if (sig.length !== 64 || msg.length !== 32 || pub.length !== 32) return false;
    const x = num(pub);
    if (x >= P) return false;
    const c = mod(x ** 3n + 7n);
    let y = pow(c, (P + 1n) / 4n);
    if ((y * y) % P !== c) return false;
    if (y & 1n) y = P - y;
    const r = num(sig.slice(0, 32));
    const s = num(sig.slice(32));
    if (r >= P || s >= N) return false;
    const e = mod(num(await taggedHash('BIP0340/challenge', bytes32(r), pub, msg)), N);
    const R = add(mul(s, G), mul(mod(N - e, N), [x, y]));
    return R !== null && (R[1] & 1n) === 0n && R[0] === r;
  } catch {
    return false;
  }
}

/** A Nostr event's ID (NIP-01) and signature. */
export async function verifyEvent(ev) {
  const id = hex(await sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
  return id === ev.id && (await schnorrVerify(ev.sig, ev.id, ev.pubkey));
}

// ---------------------------------------------------------------- RFC 6962 Merkle

const leafHash = (data) => sha256(concat(new Uint8Array([0]), data));
const nodeHash = (l, r) => sha256(concat(new Uint8Array([1]), l, r));

export async function verifyInclusion(leafData, index, treeSize, path, rootHex) {
  if (index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = await leafHash(leafData);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = await nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = await nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && hex(r) === rootHex;
}

/** The leaf committing a merchant's statement into the day's public log (docs/03 §6.2). */
export const statementLeafData = (saltHex, commitmentHex) => concat(enc.encode('goonerspay/v1/statement-leaf'), unhex(saltHex), unhex(commitmentHex));

/**
 * Checks a statement against its day's public root. platformKeys, when given, are the keys
 * the platform publishes; both events must be signed by one of them.
 */
export async function verifyStatement(statement, root, merchantId, platformKeys = []) {
  const c = JSON.parse(statement.content);
  const { statement_commitment: commitment, transparency: t, ...body } = c;
  const rc = (() => {
    try {
      return JSON.parse(root.content);
    } catch {
      return {};
    }
  })();
  const signedBy = async (ev) => (await verifyEvent(ev)) && (platformKeys.length === 0 || platformKeys.includes(ev.pubkey));
  const sum = (k) => c.lines.reduce((a, l) => a + l[k], 0);
  const check = {
    statementSigned: statement.kind === 7713 && (await signedBy(statement)),
    forThisMerchant: c.merchant_id === merchantId,
    totalsAddUp: c.totals.gross === sum('amount') && c.totals.fees === sum('fee') && c.totals.net === c.totals.gross - c.totals.fees - c.totals.refunds - c.totals.chargebacks,
    commitmentMatches: hex(await sha256(enc.encode(canonicalJson(body)))) === commitment,
    rootSigned: root.kind === 7715 && (await signedBy(root)) && root.id === t.root_event_id && rc.date === c.date,
    inPublicRoot: await verifyInclusion(statementLeafData(t.leaf_salt, commitment), t.leaf_index, t.tree_size, t.audit_path.map(unhex), rc.root),
  };
  check.ok = Object.values(check).every(Boolean);
  return { statement: c, check, signers: { statement: statement.pubkey, root: root.pubkey } };
}

/** Whether a receipt is in the statement, from the platform's proof. */
export async function receiptIncluded(statementContent, proof) {
  const p = proof.statement_inclusion;
  return statementContent.lines.some((l) => l.receipt_event_id === proof.receipt_event_id) &&
    verifyInclusion(unhex(proof.receipt_event_id), p.leaf_index, p.tree_size, p.audit_path.map(unhex), statementContent.receipts_root);
}
