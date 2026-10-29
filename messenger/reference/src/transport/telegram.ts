/**
 * Telegram Bot API adapter (Example 3 transport).
 *
 * Frames are uploaded as documents (application/octet-stream, neutral file name, no
 * caption, content-type detection off). Telegram stores opaque bytes; it sees the bot,
 * the chat, the size bucket and timing, and nothing else.
 *
 * Topologies that work with the Bot API (see docs/01-transport.md §2):
 *   - personal blob store: your own bot uploads to your own private channel; file_id is a
 *     permanent handle *for that bot* (backups, media chunks, device sync);
 *   - bot → user mailbox: a bot posts into a chat whose reader is an MTProto *user* client.
 * What does NOT work: bot ↔ bot through a group. Telegram's Bots FAQ: "bots will not be able
 * to see messages from other bots regardless of mode". Use MTProto user clients (TDLib /
 * GramJS) or another transport for user ↔ user mailboxes.
 *
 * Limits (Bot API, cloud): upload ≤ 50 MB, getFile download ≤ 20 MB, roughly 1 msg/s per
 * chat, 20 msg/min per group, ~30 msg/s per bot. A 429 carries `parameters.retry_after`.
 */
import { decodeFrame } from '../envelope.ts';
import { RateLimitedError, TransportRejectedError, type FetchResult, type Transport } from './types.ts';

type FetchFn = typeof globalThis.fetch;

interface BotResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

interface TgDocument {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  document?: TgDocument;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
}

export const TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const NEUTRAL_FILE_NAME = 'data.bin';

export interface TelegramBotOptions {
  token: string;
  fetch?: FetchFn;
  apiBase?: string;
}

export class TelegramBotTransport implements Transport {
  readonly name = 'telegram-bot';
  readonly maxFrameBytes = 1 << 20; // frames; blobs may go up to the 20 MB download cap
  private readonly token: string;
  private readonly fetchFn: FetchFn;
  private readonly apiBase: string;
  /** getUpdates is per bot, not per chat: frames for other mailboxes wait here. */
  private readonly pending = new Map<string, { id: string; frame: Uint8Array }[]>();
  private offset = 0;

  constructor(opts: TelegramBotOptions) {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(opts.token)) throw new Error('malformed bot token');
    this.token = opts.token;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.apiBase = opts.apiBase ?? 'https://api.telegram.org';
  }

  private async call<T>(method: string, body: FormData | Record<string, unknown>): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await this.fetchFn(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    const json = (await res.json()) as BotResponse<T>;
    if (json.ok && json.result !== undefined) return json.result;
    if (json.error_code === 429) throw new RateLimitedError(this.name, (json.parameters?.retry_after ?? 1) * 1000);
    if (json.error_code === 400 || json.error_code === 403) {
      throw new TransportRejectedError(this.name, `${method}: ${json.description ?? json.error_code}`);
    }
    throw new Error(`${this.name} ${method} failed: ${json.error_code} ${json.description ?? ''}`);
  }

  /** Uploads raw bytes as a document; returns the message and the bot-specific file_id. */
  async putBlob(chatId: string, bytes: Uint8Array): Promise<{ messageId: number; fileId: string }> {
    const form = new FormData();
    form.set('chat_id', chatId);
    // Copy into a plain ArrayBuffer-backed view (Blob rejects SharedArrayBuffer views).
    form.set('document', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), NEUTRAL_FILE_NAME);
    form.set('disable_content_type_detection', 'true');
    form.set('disable_notification', 'true');
    const msg = await this.call<TgMessage>('sendDocument', form);
    if (!msg.document) throw new Error('sendDocument returned no document');
    return { messageId: msg.message_id, fileId: msg.document.file_id };
  }

  /** Downloads a document by file_id (only file_ids minted for this same bot work). */
  async getBlob(fileId: string): Promise<Uint8Array> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new Error('file is not downloadable via the Bot API');
    if ((file.file_size ?? 0) > TELEGRAM_BOT_DOWNLOAD_LIMIT) throw new Error('file exceeds the Bot API 20 MB download limit');
    const res = await this.fetchFn(`${this.apiBase}/file/bot${this.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async send(mailbox: string, frame: Uint8Array): Promise<string> {
    decodeFrame(frame); // refuse anything that is not a well-formed, padded frame
    const { messageId } = await this.putBlob(mailbox, frame);
    return `${mailbox}:${messageId}`;
  }

  async fetch(mailbox: string): Promise<FetchResult> {
    const updates = await this.call<TgUpdate[]>('getUpdates', {
      offset: this.offset,
      timeout: 0,
      allowed_updates: ['message', 'channel_post'],
    });
    for (const u of updates) {
      const msg = u.message ?? u.channel_post;
      if (msg?.document) {
        try {
          const frame = await this.getBlob(msg.document.file_id);
          decodeFrame(frame);
          const chat = String(msg.chat.id);
          const list = this.pending.get(chat) ?? [];
          list.push({ id: `${chat}:${msg.message_id}`, frame });
          this.pending.set(chat, list);
        } catch (err) {
          // Rate limited mid-batch: stop here; the offset still points at this update.
          if (err instanceof RateLimitedError) throw err;
          // Anything else is not one of our frames: skip it.
        }
      }
      this.offset = Math.max(this.offset, u.update_id + 1);
    }
    const frames = this.pending.get(mailbox) ?? [];
    this.pending.delete(mailbox);
    return { frames, cursor: String(this.offset) };
  }
}
