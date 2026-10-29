import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToUtf8, randomBytes, utf8ToBytes } from '../src/bytes.ts';
import { xwingKeygen } from '../src/hpke.ts';
import {
  ENCRYPTED_HEADER_BYTES,
  MAX_SKIP,
  type RatchetState,
  deserializeState,
  initInitiator,
  initResponder,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeState,
} from '../src/ratchet.ts';

const ad = utf8ToBytes('associated-data');

function pair(): { alice: RatchetState; bob: RatchetState } {
  const seed = { rootKey: randomBytes(32), headerKeyA: randomBytes(32), nextHeaderKeyB: randomBytes(32) };
  const spk = xwingKeygen();
  return { alice: initInitiator(seed, spk.publicKey), bob: initResponder(seed, spk) };
}

/** Small mutable wrapper so tests read like a conversation. */
class Party {
  state: RatchetState;
  constructor(state: RatchetState) {
    this.state = state;
  }
  send(text: string): Uint8Array {
    const r = ratchetEncrypt(this.state, utf8ToBytes(text), ad);
    this.state = r.state;
    return r.message;
  }
  recv(message: Uint8Array): string {
    const r = ratchetDecrypt(this.state, message, ad);
    this.state = r.state;
    return bytesToUtf8(r.plaintext);
  }
}

describe('hybrid KEM ratchet', () => {
  it('ping-pongs across many ratchet steps', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    for (let i = 0; i < 10; i++) {
      assert.equal(b.recv(a.send(`a${i}`)), `a${i}`);
      assert.equal(a.recv(b.send(`b${i}`)), `b${i}`);
    }
  });

  it('the responder cannot send first', () => {
    const { bob } = pair();
    assert.throws(() => ratchetEncrypt(bob, utf8ToBytes('x'), ad), /cannot send before receiving/);
  });

  it('handles out-of-order delivery within a chain', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    const m = [a.send('0'), a.send('1'), a.send('2'), a.send('3')];
    assert.equal(b.recv(m[2]!), '2');
    assert.equal(b.recv(m[0]!), '0');
    assert.equal(b.recv(m[3]!), '3');
    assert.equal(b.recv(m[1]!), '1');
  });

  it('handles a message from an older chain arriving after a ratchet step', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    const a0 = a.send('a0');
    const a1 = a.send('a1'); // delayed
    assert.equal(b.recv(a0), 'a0');
    assert.equal(a.recv(b.send('b0')), 'b0');
    const a2 = a.send('a2'); // new chain
    assert.equal(b.recv(a2), 'a2');
    assert.equal(b.recv(a1), 'a1'); // from the previous chain, via skipped keys
  });

  it('rejects replays and keeps working afterwards', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    const m0 = a.send('once');
    b.recv(m0);
    assert.throws(() => b.recv(m0));
    assert.equal(b.recv(a.send('next')), 'next');
  });

  it('rejects tampering without corrupting the session', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    const m = a.send('payload');
    for (const i of [0, 20, ENCRYPTED_HEADER_BYTES - 1, ENCRYPTED_HEADER_BYTES + 1, m.length - 1]) {
      const t = m.slice();
      t[i]! ^= 0x01;
      assert.throws(() => b.recv(t), `flip at ${i}`);
    }
    assert.throws(() => ratchetDecrypt(b.state, m, utf8ToBytes('wrong ad')));
    assert.equal(b.recv(m), 'payload');
  });

  it(`refuses to skip more than MAX_SKIP (${MAX_SKIP}) messages`, () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    let last: Uint8Array = new Uint8Array();
    for (let i = 0; i <= MAX_SKIP + 1; i++) last = a.send(String(i));
    assert.throws(() => ratchetDecrypt(bob, last, ad), /too many skipped/);
  });

  it('encrypts headers: the advertised KEM key never appears on the wire', () => {
    const { alice } = pair();
    const { state, message } = ratchetEncrypt(alice, utf8ToBytes('x'), ad);
    const ek = state.kemSelf.publicKey.subarray(0, 32);
    const hay = Buffer.from(message);
    assert.equal(hay.indexOf(Buffer.from(ek)), -1);
  });

  it('survives serialisation', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    const pending = a.send('before');
    b.recv(a.send('first'));
    b.state = deserializeState(serializeState(b.state));
    assert.equal(b.recv(pending), 'before'); // skipped key survived
    assert.equal(a.recv(b.send('after restore')), 'after restore');
  });

  it('heals after a state compromise (post-compromise security)', () => {
    const { alice, bob } = pair();
    const a = new Party(alice);
    const b = new Party(bob);
    b.recv(a.send('hello'));

    // The attacker copies Alice's entire state, then passively observes every message.
    const eve = new Party(deserializeState(serializeState(a.state)));
    const b1 = b.send('b1: still readable by the attacker');
    assert.equal(a.recv(b1), 'b1: still readable by the attacker');
    assert.equal(eve.recv(b1), 'b1: still readable by the attacker');

    // Alice answers with fresh KEM randomness the attacker never saw...
    b.recv(a.send('a1'));
    // ...so Bob's next chain is encapsulated to a key pair the attacker does not hold.
    const b2 = b.send('b2: healed');
    assert.equal(a.recv(b2), 'b2: healed');
    assert.throws(() => eve.recv(b2));
  });
});
