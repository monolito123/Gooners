/**
 * Rough timings of the pure-JS primitives (single thread). Native code (liboqs, BoringSSL,
 * CryptoKit) is typically 10-50× faster; these numbers are an upper bound for web clients.
 *   node examples/05-benchmark.ts
 */
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  initInitiator,
  initResponder,
  randomBytes,
  ratchetDecrypt,
  ratchetEncrypt,
  xwingDecapsulate,
  xwingEncapsulate,
  xwingKeygen,
  compositeKeygen,
  compositeSign,
  compositeVerify,
  utf8ToBytes,
  type RatchetState,
} from '../src/index.ts';

function bench(name: string, n: number, fn: () => void): void {
  fn(); // warm up the JIT
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  const ms = (performance.now() - t) / n;
  console.log(`${name.padEnd(36)} ${ms.toFixed(2).padStart(8)} ms/op`);
}

const kp = xwingKeygen();
const { cipherText } = xwingEncapsulate(kp.publicKey);
bench('X-Wing keygen', 50, () => xwingKeygen());
bench('X-Wing encapsulate', 50, () => xwingEncapsulate(kp.publicKey));
bench('X-Wing decapsulate', 50, () => xwingDecapsulate(cipherText, kp.secretKey));

const id = compositeKeygen(randomBytes(32), randomBytes(32));
const msg = randomBytes(256);
const sig = compositeSign(id, msg, 'bench');
bench('ML-DSA-65 sign', 30, () => ml_dsa65.sign(msg, id.pqSecretKey));
bench('composite sign (Ed25519 + ML-DSA-65)', 30, () => compositeSign(id, msg, 'bench'));
bench('composite verify', 30, () => compositeVerify(id.publicKey, msg, sig, 'bench'));

// Ratchet: same chain (symmetric only) vs. a full KEM step per message (ping-pong).
const ad = utf8ToBytes('ad');
const seed = { rootKey: randomBytes(32), headerKeyA: randomBytes(32), nextHeaderKeyB: randomBytes(32) };
const spk = xwingKeygen();
let a: RatchetState = initInitiator(seed, spk.publicKey);
let b: RatchetState = initResponder(seed, spk);
const pt = new Uint8Array(1500);
bench('ratchet encrypt+decrypt, same chain', 200, () => {
  const e = ratchetEncrypt(a, pt, ad);
  a = e.state;
  b = ratchetDecrypt(b, e.message, ad).state;
});
bench('ratchet round trip with 2 KEM steps', 30, () => {
  const e1 = ratchetEncrypt(b, pt, ad);
  b = e1.state;
  a = ratchetDecrypt(a, e1.message, ad).state;
  const e2 = ratchetEncrypt(a, pt, ad);
  a = e2.state;
  b = ratchetDecrypt(b, e2.message, ad).state;
});
