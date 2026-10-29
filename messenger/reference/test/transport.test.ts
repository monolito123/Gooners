import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../src/bytes.ts';
import { encodeFrame } from '../src/envelope.ts';
import { FailoverTransport } from '../src/transport/failover.ts';
import { MemoryTransport } from '../src/transport/memory.ts';
import { TelegramBotTransport } from '../src/transport/telegram.ts';
import { RateLimitedError } from '../src/transport/types.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawXX';
const frame = () => encodeFrame({ tag: randomBytes(16), body: randomBytes(4096 - 16) });

/** Minimal fake of the Bot API: sendDocument, getUpdates, getFile, file download. */
function fakeTelegram(opts: { rateLimitSends?: number } = {}) {
  const files = new Map<string, Uint8Array>();
  const updates: unknown[] = [];
  const requests: { method: string; form?: FormData; json?: any }[] = [];
  let rateLimit = opts.rateLimitSends ?? 0;
  let nextId = 1;
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const file = url.match(/\/file\/bot[^/]+\/(.+)$/);
    if (file) return new Response(new Uint8Array(files.get(file[1]!)!));
    const method = url.split('/').pop()!;
    const form = init?.body instanceof FormData ? init.body : undefined;
    const json = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, form, json });

    if (method === 'sendDocument') {
      if (rateLimit-- > 0) {
        return new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }));
      }
      const doc = form!.get('document') as File;
      const fileId = `BQAC${nextId}`;
      files.set(`documents/${fileId}.bin`, new Uint8Array(await doc.arrayBuffer()));
      const msg = { message_id: nextId, chat: { id: Number(form!.get('chat_id')) }, document: { file_id: fileId, file_unique_id: `u${nextId}`, file_size: doc.size } };
      updates.push({ update_id: 1000 + nextId, channel_post: msg });
      nextId++;
      return ok(msg);
    }
    if (method === 'getUpdates') return ok(updates.filter((u: any) => u.update_id >= (json.offset ?? 0)));
    if (method === 'getFile') return ok({ file_id: json.file_id, file_size: 4096, file_path: `documents/${json.file_id}.bin` });
    return new Response(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }));
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe('TelegramBotTransport', () => {
  it('uploads frames as neutral octet-stream documents and reads them back', async () => {
    const tg = fakeTelegram();
    const t = new TelegramBotTransport({ token: TOKEN, fetch: tg.fetch });
    const f = frame();
    const id = await t.send('-1001234567890', f);
    assert.equal(id, '-1001234567890:1');

    const req = tg.requests[0]!;
    assert.equal(req.method, 'sendDocument');
    const doc = req.form!.get('document') as File;
    assert.equal(doc.name, 'data.bin');
    assert.equal(doc.type, 'application/octet-stream');
    assert.equal(req.form!.get('disable_content_type_detection'), 'true');
    assert.equal(req.form!.get('caption'), null);

    const res = await t.fetch('-1001234567890');
    assert.equal(res.frames.length, 1);
    assert.deepEqual(res.frames[0]!.frame, f);
    assert.equal((await t.fetch('-1001234567890')).frames.length, 0, 'offset advanced');
  });

  it('maps HTTP 429 retry_after to RateLimitedError', async () => {
    const t = new TelegramBotTransport({ token: TOKEN, fetch: fakeTelegram({ rateLimitSends: 1 }).fetch });
    await assert.rejects(t.send('-100', frame()), (e: unknown) => e instanceof RateLimitedError && e.retryAfterMs === 7000);
  });

  it('refuses to upload anything that is not a padded frame', async () => {
    const t = new TelegramBotTransport({ token: TOKEN, fetch: fakeTelegram().fetch });
    await assert.rejects(t.send('-100', randomBytes(1000)), /not a frame/);
  });
});

describe('FailoverTransport', () => {
  it('falls back when the primary is rate limited, then parks it until retry_after', async () => {
    let now = 0;
    const tg = new TelegramBotTransport({ token: TOKEN, fetch: fakeTelegram({ rateLimitSends: 1 }).fetch });
    const nostr = new MemoryTransport('nostr');
    const fo = new FailoverTransport([tg, nostr], () => now);
    const routes = [
      { transport: 'telegram-bot', mailbox: '-100' },
      { transport: 'nostr', mailbox: 'inbox' },
    ];
    assert.deepEqual(await fo.send(routes, frame()), [routes[1]]);
    assert.equal(fo.isAvailable('telegram-bot'), false);
    assert.equal(fo.isAvailable('telegram-bot', 'fetch'), true, 'a send quota does not block reading');
    now += 7000;
    assert.equal(fo.isAvailable('telegram-bot'), true);
    assert.deepEqual(await fo.send(routes, frame()), [routes[0]]);
  });

  it('sends redundantly and dedupes on receipt', async () => {
    const a = new MemoryTransport('a');
    const b = new MemoryTransport('b');
    const fo = new FailoverTransport([a, b]);
    const routes = [
      { transport: 'a', mailbox: 'm' },
      { transport: 'b', mailbox: 'm' },
    ];
    const f = frame();
    assert.equal((await fo.send(routes, f, 2)).length, 2);
    const got = await fo.fetch(routes);
    assert.equal(got.length, 1);
    assert.equal((await fo.fetch(routes)).length, 0);
  });

  it('fails loudly when every route is down', async () => {
    const a = new MemoryTransport('a');
    a.rateLimitNextSends = 5;
    const fo = new FailoverTransport([a]);
    await assert.rejects(fo.send([{ transport: 'a', mailbox: 'm' }], frame()), /no transport delivered/);
  });
});
