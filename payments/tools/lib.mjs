// Shared helpers for the spec tools: deterministic test keys, NIP-01 signing,
// NIP-44/NIP-59 gift wrap, RFC 6962 Merkle trees and RFC 8785-style canonical JSON.
// Every key here is a PUBLIC TEST KEY derived from a label. Never use them for anything real.
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import { getEventHash } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';

export { bytesToHex, hexToBytes, utf8ToBytes, sha256, nip19, nip44 };

const LABEL_PREFIX = 'ipplus-spec/test-key/';

/** Deterministic test key for a role, e.g. testKey('merchant-root'). */
export function testKey(role) {
  const sk = sha256(utf8ToBytes(LABEL_PREFIX + role));
  const pk = bytesToHex(schnorr.getPublicKey(sk));
  return { role, sk, skHex: bytesToHex(sk), pk, npub: nip19.npubEncode(pk) };
}

/** Deterministic 32-byte value for a label (nonces, salts, aux randomness). */
export function det(label) {
  return sha256(utf8ToBytes('ipplus-spec/det/' + label));
}

/** Sign a NIP-01 event. Aux randomness is derived from the label so examples are reproducible. */
export function signEvent(template, key, label) {
  const ev = {
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags ?? [],
    content: template.content ?? '',
    pubkey: key.pk,
  };
  ev.id = getEventHash(ev);
  ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), key.sk, det('aux/' + (label ?? ev.id))));
  return { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig };
}

/** Verify id and BIP-340 signature of an event. Returns a list of problems (empty = valid). */
export function verifyEventStrict(ev) {
  const problems = [];
  for (const f of ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']) {
    if (!(f in ev)) problems.push(`missing field ${f}`);
  }
  if (problems.length) return problems;
  const id = getEventHash(ev);
  if (id !== ev.id) problems.push(`id mismatch: computed ${id}`);
  try {
    if (!schnorr.verify(hexToBytes(ev.sig), hexToBytes(id), hexToBytes(ev.pubkey))) problems.push('bad signature');
  } catch (e) {
    problems.push('signature error: ' + e.message);
  }
  return problems;
}

/** Canonical JSON (sorted keys, no whitespace). Equals RFC 8785 for the integer/string data used here. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  if (typeof value === 'number' && !Number.isInteger(value)) throw new Error('floats are not allowed in canonical JSON');
  return JSON.stringify(value);
}

// ---------- NIP-59 gift wrap (deterministic for examples) ----------

/**
 * Wrap a *signed* inner event for one recipient: inner → seal (kind 13, signed by the author)
 * → gift wrap (kind 1059, or 21059 for ephemeral, signed by a one-time key).
 * Receipts deliberately keep the inner signature: they must be non-repudiable (03 §2.3).
 */
export function giftWrap(inner, authorKey, recipientPk, label, { wrapKind = 1059, sealAt, wrapAt, wrapTags = [] } = {}) {
  const sealKey = nip44.v2.utils.getConversationKey(authorKey.sk, recipientPk);
  const seal = signEvent(
    {
      kind: 13,
      created_at: sealAt ?? inner.created_at,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify(inner), sealKey, det('seal-nonce/' + label)),
    },
    authorKey,
    'seal/' + label,
  );
  const ephSk = det('wrap-ephemeral/' + label);
  const eph = { sk: ephSk, pk: bytesToHex(schnorr.getPublicKey(ephSk)) };
  const wrapConvKey = nip44.v2.utils.getConversationKey(eph.sk, recipientPk);
  const wrap = signEvent(
    {
      kind: wrapKind,
      created_at: wrapAt ?? inner.created_at,
      tags: [['p', recipientPk], ...wrapTags],
      content: nip44.v2.encrypt(JSON.stringify(seal), wrapConvKey, det('wrap-nonce/' + label)),
    },
    eph,
    'wrap/' + label,
  );
  return { seal, wrap };
}

/** Unwrap a gift wrap with the recipient's secret key and check every layer. */
export function unwrap(wrap, recipientSk) {
  const problems = [...verifyEventStrict(wrap).map((p) => 'wrap: ' + p)];
  const seal = JSON.parse(nip44.v2.decrypt(wrap.content, nip44.v2.utils.getConversationKey(recipientSk, wrap.pubkey)));
  problems.push(...verifyEventStrict(seal).map((p) => 'seal: ' + p));
  if (seal.kind !== 13) problems.push('seal kind is not 13');
  if (seal.tags.length) problems.push('seal must have no tags');
  const inner = JSON.parse(nip44.v2.decrypt(seal.content, nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey)));
  problems.push(...verifyEventStrict(inner).map((p) => 'inner: ' + p));
  if (inner.pubkey !== seal.pubkey) problems.push('inner author differs from seal author (impersonation)');
  return { seal, inner, problems };
}

// ---------- RFC 6962 Merkle tree ----------

const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);
export const leafHash = (data) => sha256(concatBytes(LEAF, data));
export const nodeHash = (l, r) => sha256(concatBytes(NODE, l, r));

function largestPow2Below(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle Tree Hash (RFC 6962 §2.1) over raw leaf data. */
export function mth(leaves) {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leafHash(leaves[0]);
  const k = largestPow2Below(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** Audit path for leaf m (RFC 6962 §2.1.1). */
export function auditPath(m, leaves) {
  if (leaves.length <= 1) return [];
  const k = largestPow2Below(leaves.length);
  if (m < k) return [...auditPath(m, leaves.slice(0, k)), mth(leaves.slice(k))];
  return [...auditPath(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

/** Verify an inclusion proof (RFC 9162 §2.1.3.2). */
export function verifyInclusion(leafData, index, treeSize, path, rootHex) {
  if (index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leafHash(leafData);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesToHex(r) === rootHex;
}

/** Leaf data committing a merchant's statement into the public transparency log (03 §6.2). */
export function statementLeafData(saltHex, statementCommitmentHex) {
  return concatBytes(utf8ToBytes('ipplus/v1/statement-leaf'), hexToBytes(saltHex), hexToBytes(statementCommitmentHex));
}

// ---------- misc ----------

export const iso = (unix) => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');

/** Integer MDR fee with round-half-up: floor((amount · bps + 5000) / 10000). */
export const fee = (amount, bps) => Math.floor((amount * bps + 5000) / 10000);
