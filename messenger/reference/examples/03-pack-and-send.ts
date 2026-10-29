/**
 * Example 3: pack ciphertext into a transport frame and ship it through Telegram.
 *
 *   node examples/03-pack-and-send.ts                     # offline: local Bot API fake
 *   TELEGRAM_BOT_TOKEN=123:ABC… TELEGRAM_CHAT_ID=-100… \
 *     node examples/03-pack-and-send.ts                   # real Bot API, your own private channel
 *
 * The real run uses the "personal blob store" topology: your bot uploads the frame to a
 * private channel where it is an admin, then downloads it again by file_id.
 */
import {
  TAG_BYTES,
  TelegramBotTransport,
  XWING,
  armorFrame,
  decodeContent,
  decodeFrame,
  encodeContent,
  encodeFrame,
  epochOf,
  openBox,
  padToBucket,
  randomBytes,
  routingTag,
  sealBox,
  toHex,
  unpad,
  utf8ToBytes,
  watchTags,
  xwingKeygen,
} from '../src/index.ts';

// Recipient: an X-Wing inbox key and an inbox tag key (both from the contact card).
const inboxKem = xwingKeygen();
const inboxTagKey = randomBytes(32);

// 1. L2 plaintext: protobuf Content.
const content = encodeContent({ text: { body: 'Sealed for Bob only. The host sees a 4 KiB blob.' } });

// 2. L0 routing tag for this epoch: unlinkable without inboxTagKey, rotates hourly.
const now = Date.now();
const tag = routingTag(inboxTagKey, epochOf(now));

// 3. Pad inside the AEAD so the whole frame lands on a bucket, then seal (X-Wing HPKE).
//    The tag is the AEAD's associated data: moving the body under another tag breaks it.
const overhead = TAG_BYTES + XWING.cipherText + 16;
const box = sealBox(inboxKem.publicKey, padToBucket(content, overhead), utf8ToBytes('SMA/v1/sealed-box'), tag);
const frame = encodeFrame({ tag, body: box });
console.log(`frame: ${frame.length} B = tag 16 ‖ X-Wing enc 1120 ‖ AES-GCM(padded ${box.length - 1120 - 16} B) ‖ tag 16`);
console.log('text armor (Nostr/Matrix):', `${armorFrame(frame).slice(0, 48)}… (${armorFrame(frame).length} chars)`);

// 4. Ship it.
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const tg = new TelegramBotTransport(
  token && chatId ? { token } : { token: '123456789:EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE', fetch: offlineBotApi() },
);
const { messageId, fileId } = await tg.putBlob(chatId ?? '-1001234567890', frame);
console.log(`${token ? 'Telegram' : 'offline fake'}: message ${messageId}, file_id ${fileId.slice(0, 16)}…`);

// 5. Receiver side: download, check the tag is ours, open, unpad, decode.
const received = await tg.getBlob(fileId);
const { tag: rxTag, body } = decodeFrame(received);
if (!watchTags(inboxTagKey, Date.now()).includes(toHex(rxTag))) throw new Error('not addressed to us');
const opened = decodeContent(unpad(openBox(inboxKem.secretKey, body, utf8ToBytes('SMA/v1/sealed-box'), rxTag)));
console.log('recipient reads:', (opened.text as { body: string }).body);

/** Stand-in for api.telegram.org so the example runs without credentials. */
function offlineBotApi(): typeof fetch {
  const files = new Map<string, Uint8Array>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const dl = url.match(/\/file\/bot[^/]+\/(.+)$/);
    if (dl) return new Response(new Uint8Array(files.get(dl[1]!)!));
    if (url.endsWith('/sendDocument')) {
      const doc = (init!.body as FormData).get('document') as File;
      files.set('documents/1.bin', new Uint8Array(await doc.arrayBuffer()));
      console.log(`  POST sendDocument  name=${doc.name} type=${doc.type} size=${doc.size}`);
      return Response.json({ ok: true, result: { message_id: 1, chat: { id: -1 }, document: { file_id: 'BQACAgEAAxkDAAIB', file_unique_id: 'x' } } });
    }
    if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'documents/1.bin', file_size: 4096 } });
    return Response.json({ ok: false, error_code: 404 });
  }) as typeof fetch;
}
