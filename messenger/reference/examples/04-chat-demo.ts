/**
 * Example 4: end-to-end conversation over two untrusted transports with failover.
 *   node examples/04-chat-demo.ts
 *
 * Alice and Bob share one public mailbox on each host (like a Nostr relay or a big
 * Telegram channel). Everyone reads everything; only the right recipient's tag table
 * matches a frame, and only it can open it.
 */
import {
  Endpoint,
  FailoverTransport,
  MemoryTransport,
  type ContactInfo,
  decodeContent,
  decodeFrame,
  encodeContent,
  generateRecoveryPhrase,
  randomBytes,
  safetyNumber,
  toHex,
  verifyPrekeyBundle,
} from '../src/index.ts';

const telegram = new MemoryTransport('telegram');
const nostr = new MemoryTransport('nostr');
// Each device keeps its own view of transport health and its own dedupe set.
const aliceNet = new FailoverTransport([telegram, nostr]);
const bobNet = new FailoverTransport([telegram, nostr]);
const routes = [
  { transport: 'telegram', mailbox: 'shared-board' },
  { transport: 'nostr', mailbox: 'shared-board' },
];

const alice = Endpoint.fromRecoveryPhrase(generateRecoveryPhrase());
const bob = Endpoint.fromRecoveryPhrase(generateRecoveryPhrase());

// Contact exchange: in the app, Alice scans Bob's QR (fingerprint + capsule key) and
// fetches his encrypted ContactCard. The fingerprint pin is what defeats a lying host.
const cardOf = (e: Endpoint): ContactInfo => ({
  fingerprint: e.identity.fingerprint,
  inboxTagKey: e.inboxTagKey,
  bundle: verifyPrekeyBundle(e.publishBundle(), e.identity.fingerprint),
});
const bobCard = cardOf(bob);
const aliceCard = cardOf(alice);
console.log('safety number (compare in person):', safetyNumber(alice.identity.fingerprint, bob.identity.fingerprint));

async function deliver(to: Endpoint, net: FailoverTransport, name: string): Promise<void> {
  for (const { frame } of await net.fetch(routes)) {
    const got = to.receive(frame);
    if (!got) continue; // somebody else's frame
    const c = decodeContent(got.plaintext);
    const shown = c.body === 'text' ? (c.text as { body: string }).body : `[${c.body}]`;
    console.log(`  ${name} ← ${got.from.slice(0, 8)}${got.newSession ? ' (new session)' : ''}: ${shown}`);
  }
}

const say = async (from: Endpoint, net: FailoverTransport, to: ContactInfo, body: string) => {
  const via = await net.send(routes, from.send(to, encodeContent({ text: { body } })));
  console.log(`  sent via ${via.map((r) => r.transport).join(', ')}`);
};

console.log('\n1. First contact (PreKeyMessage to Bob\'s inbox tag)');
await say(alice, aliceNet, bobCard, 'Hi Bob, this is Alice.');
await deliver(bob, bobNet, 'Bob');

console.log('\n2. Telegram starts rate limiting; traffic fails over to Nostr');
telegram.rateLimitNextSends = 1;
await say(bob, bobNet, aliceCard, 'Hi Alice! Telegram is throttling us.');
await deliver(alice, aliceNet, 'Alice');

console.log('\n3. Call signalling rides the same ratchet');
const offer = encodeContent({
  call: { callId: randomBytes(16), type: 'OFFER', sdp: 'v=0\r\n…', mediaKeySeed: randomBytes(32), video: true },
});
console.log(`  sent via ${(await aliceNet.send(routes, alice.send(bobCard, offer))).map((r) => r.transport).join(', ')}`);
await deliver(bob, bobNet, 'Bob');

console.log('\n4. What the hosts store (all they can see):');
for (const t of [telegram, nostr]) {
  for (const f of t.inspect('shared-board')) {
    console.log(`  ${t.name.padEnd(8)} ${String(f.length).padStart(6)} B  tag ${toHex(decodeFrame(f).tag)}  body ${toHex(f.subarray(16, 24))}…`);
  }
}
