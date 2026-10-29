/**
 * App core: one Endpoint (crypto state), the relay pool (transport), the encrypted vault
 * (persistence) and the user-visible model (contacts, messages, outbox).
 */
import {
  Endpoint,
  KEY_LABELS,
  armorFrame,
  cardContent,
  cardFromContent,
  cardLocatorTag,
  createContactCard,
  dearmorFrame,
  decodeCapsule,
  decodeContent,
  deriveRootKey,
  deriveSubkey,
  encodeCapsule,
  encodeContent,
  fromBase64Url,
  fromHex,
  openCard,
  parseContactCard,
  randomBytes,
  recoveryPhraseToSeed,
  safetyNumber,
  sanitizeName,
  sanitizeRelays,
  sealCard,
  toBase64Url,
  toHex,
} from '../../reference/src/index.ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import { DEFAULT_RELAYS, FRAME_TTL_S, KIND_CARD, KIND_FRAME, type NostrEvent, RelayPool, cardSigningKey, signEvent } from './nostr.ts';
import { Vault } from './vault.ts';

export const MAX_TEXT = 4000;
const BACKLOG_EPOCHS = 7 * 24; // accept frames up to a week old (relays expire them after 14 days)
const OUTBOX_GIVE_UP_MS = 3 * 24 * 3600_000;
const SPK_ROTATE_MS = 7 * 24 * 3600_000;

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Message {
  id: string;
  dir: 'in' | 'out' | 'system';
  text: string;
  ts: number;
  status: MessageStatus;
}

export interface Contact {
  fp: string;
  name: string;
  /** base64url ContactCard, needed to start a session with them. */
  card: string | null;
  relays: string[];
  verified: boolean;
  addedAt: number;
  unread: number;
}

interface OutItem {
  event: NostrEvent;
  relays: string[];
  peer: string;
  msgId: string | null;
  createdAt: number;
}

interface AppState {
  v: 1;
  endpoint: string;
  name: string;
  relays: string[];
  capsuleKey: string;
  contacts: Record<string, Contact>;
  messages: Record<string, Message[]>;
  outbox: OutItem[];
  lastOnlineMs: number;
}

export class Messenger {
  private state: AppState;
  private endpoint: Endpoint;
  private readonly vault: Vault;
  readonly pool = new RelayPool();
  private timers: ReturnType<typeof setInterval>[] = [];
  private subscribedEpoch = -1;
  private watchedCount = 0;
  private flushing = false;
  onChange: () => void = () => {};

  private constructor(state: AppState, vault: Vault) {
    this.state = state;
    this.vault = vault;
    this.endpoint = Endpoint.deserialize(state.endpoint);
    this.pool.onStatus = () => this.onChange();
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /** New account, or the same identity restored from its recovery phrase. */
  static async create(phrase: string, name: string, passphrase: string, relays = DEFAULT_RELAYS): Promise<Messenger> {
    const root = deriveRootKey(recoveryPhraseToSeed(phrase));
    const endpoint = new Endpoint(root);
    const state: AppState = {
      v: 1,
      endpoint: endpoint.serialize(),
      name: sanitizeName(name) || 'Eu',
      relays: sanitizeRelays(relays),
      capsuleKey: toBase64Url(deriveSubkey(root, KEY_LABELS.contactCapsuleKey)),
      contacts: {},
      messages: {},
      outbox: [],
      lastOnlineMs: Date.now(),
    };
    root.fill(0);
    const vault = await Vault.create(passphrase, JSON.stringify(state));
    return new Messenger(state, vault);
  }

  static async unlock(passphrase: string): Promise<Messenger> {
    const { vault, stateJson } = await Vault.unlock(passphrase);
    const state = JSON.parse(stateJson) as AppState;
    if (state.v !== 1) throw new Error('unsupported app state');
    return new Messenger(state, vault);
  }

  async start(): Promise<void> {
    this.pool.setRelays(this.state.relays);
    this.pool.onEvent((_relay, e) => this.onEvent(e));
    this.maybeRotatePrekey();
    await this.resubscribe(true);
    void this.publishCard();
    void this.flushOutbox();
    this.timers.push(
      setInterval(() => void this.flushOutbox(), 15_000),
      setInterval(() => {
        this.state.lastOnlineMs = Date.now();
        void this.resubscribe(false);
        this.maybeRotatePrekey();
        void this.persist();
      }, 60_000),
    );
  }

  lock(): void {
    for (const t of this.timers) clearInterval(t);
    this.pool.close();
    this.vault.lock();
  }

  private async persist(): Promise<void> {
    this.state.endpoint = this.endpoint.serialize();
    await this.vault.save(JSON.stringify(this.state));
  }

  private changed(): void {
    void this.persist();
    this.onChange();
  }

  // ─── Accessors for the UI ────────────────────────────────────────────────────

  get name(): string {
    return this.state.name;
  }
  get relays(): string[] {
    return [...this.state.relays];
  }
  get fingerprint(): string {
    return this.endpoint.fingerprintHex;
  }
  contacts(): Contact[] {
    return Object.values(this.state.contacts).sort((a, b) => this.lastActivity(b.fp) - this.lastActivity(a.fp));
  }
  contact(fp: string): Contact | undefined {
    return this.state.contacts[fp];
  }
  messages(fp: string): Message[] {
    return this.state.messages[fp] ?? [];
  }
  lastActivity(fp: string): number {
    const m = this.state.messages[fp];
    return m?.length ? m[m.length - 1]!.ts : (this.state.contacts[fp]?.addedAt ?? 0);
  }
  relayStatus(): { url: string; connected: boolean }[] {
    return this.pool.status().filter((r) => this.state.relays.includes(r.url));
  }
  safetyNumberWith(fp: string): string {
    return safetyNumber(fromHex(this.fingerprint), fromHex(fp));
  }
  pendingCount(): number {
    return this.state.outbox.length;
  }

  // ─── Invites ─────────────────────────────────────────────────────────────────

  inviteCode(): string {
    return toBase64Url(encodeCapsule(fromHex(this.fingerprint), fromBase64Url(this.state.capsuleKey), this.state.relays));
  }

  /** Publishes our encrypted contact card where invite holders will look for it. */
  async publishCard(): Promise<boolean> {
    const key = fromBase64Url(this.state.capsuleKey);
    const tag = toHex(cardLocatorTag(key));
    const card = createContactCard(this.endpoint, this.state.name, this.state.relays);
    const event = signEvent(KIND_CARD, toBase64Url(sealCard(key, card)), [['d', tag], ['z', tag]], cardSigningKey(key));
    const res = await this.pool.publish(event, this.state.relays);
    return res.some((r) => r.ok);
  }

  /** Accepts an invite link, a "#c=..." fragment or the bare code. */
  async addContactFromInvite(input: string): Promise<Contact> {
    const code = extractInviteCode(input);
    if (!code) throw new Error('Convite inválido.');
    let capsule;
    try {
      capsule = decodeCapsule(fromBase64Url(code));
    } catch {
      throw new Error('Convite inválido ou corrompido.');
    }
    const fp = toHex(capsule.fingerprint);
    if (fp === this.fingerprint) throw new Error('Este é o seu próprio convite.');
    const author = toHex(schnorr.getPublicKey(cardSigningKey(capsule.capsuleKey)));
    const tag = toHex(capsule.tag);
    const events = await this.pool.query([{ kinds: [KIND_CARD], authors: [author], '#d': [tag] }], capsule.relays);
    events.sort((a, b) => b.created_at - a.created_at);
    for (const e of events) {
      try {
        const cardBytes = openCard(capsule.capsuleKey, fromBase64Url(e.content));
        const parsed = parseContactCard(cardBytes, { expectedFingerprint: capsule.fingerprint });
        const c = this.upsertContact(fp, parsed.displayName, toBase64Url(cardBytes), parsed.relays);
        this.changed();
        return c;
      } catch {
        /* stale or forged event: try the next one */
      }
    }
    throw new Error('Não encontrei o cartão deste convite nos relays. Peça um convite novo ou tente mais tarde.');
  }

  private upsertContact(fp: string, name: string, card: string | null, relays: string[]): Contact {
    const existing = this.state.contacts[fp];
    const c: Contact = existing ?? { fp, name: name || 'Contato', card: null, relays: [], verified: false, addedAt: Date.now(), unread: 0 };
    if (!existing && name) c.name = name;
    if (card) c.card = card;
    if (relays.length) c.relays = relays;
    this.state.contacts[fp] = c;
    return c;
  }

  renameContact(fp: string, name: string): void {
    const c = this.state.contacts[fp];
    if (c && sanitizeName(name)) {
      c.name = sanitizeName(name);
      this.changed();
    }
  }

  setVerified(fp: string, verified: boolean): void {
    const c = this.state.contacts[fp];
    if (c) {
      c.verified = verified;
      this.changed();
    }
  }

  deleteContact(fp: string): void {
    delete this.state.contacts[fp];
    delete this.state.messages[fp];
    this.state.outbox = this.state.outbox.filter((o) => o.peer !== fp);
    this.changed();
  }

  markRead(fp: string): void {
    const c = this.state.contacts[fp];
    if (c && c.unread) {
      c.unread = 0;
      this.changed();
    }
  }

  async setProfile(name: string, relays: string[]): Promise<void> {
    const clean = sanitizeRelays(relays);
    if (clean.length === 0) throw new Error('Informe pelo menos um relay wss:// válido.');
    this.state.name = sanitizeName(name) || this.state.name;
    this.state.relays = clean;
    this.pool.setRelays(clean);
    this.subscribedEpoch = -1;
    await this.resubscribe(false);
    this.changed();
    await this.publishCard();
  }

  // ─── Sending ─────────────────────────────────────────────────────────────────

  sendText(fp: string, text: string): void {
    const body = text.trim();
    if (!body) return;
    if (body.length > MAX_TEXT) throw new Error(`Mensagem longa demais (máx. ${MAX_TEXT} caracteres).`);
    const c = this.state.contacts[fp];
    if (!c) throw new Error('Contato desconhecido.');
    const messageId = randomBytes(16);
    const msg: Message = { id: toHex(messageId), dir: 'out', text: body, ts: Date.now(), status: 'pending' };
    const contents: Uint8Array[] = [];

    if (!this.endpoint.hasSession(fp)) {
      if (!c.card) throw new Error('Ainda não há uma sessão com este contato.');
      // First message of a session we start: introduce ourselves with our card.
      contents.push(cardContent(createContactCard(this.endpoint, this.state.name, this.state.relays)));
    }
    contents.push(encodeContent({ messageId, text: { body } }));
    this.push(fp, msg);
    for (const content of contents) this.enqueue(fp, this.encrypt(fp, content), content === contents[contents.length - 1] ? msg.id : null);
    this.refreshSubscriptionIfNeeded();
    this.changed();
    void this.flushOutbox();
  }

  /** A session we just created (or accepted) adds tags we must watch for replies. */
  private refreshSubscriptionIfNeeded(): void {
    const size = this.endpoint.watchedTags(Date.now()).size;
    if (size !== this.watchedCount) {
      this.watchedCount = size;
      this.subscribedEpoch = -1;
      void this.resubscribe(false);
    }
  }

  private encrypt(fp: string, content: Uint8Array): Uint8Array {
    if (this.endpoint.hasSession(fp)) return this.endpoint.sendTo(fp, content);
    const card = this.state.contacts[fp]?.card;
    if (!card) throw new Error('no card');
    return this.endpoint.send(parseContactCard(fromBase64Url(card), { expectedFingerprint: fromHex(fp) }).contact, content);
  }

  private enqueue(fp: string, frame: Uint8Array, msgId: string | null): void {
    const tag = toHex(frame.subarray(0, 16));
    const expiration = String(Math.floor(Date.now() / 1000) + FRAME_TTL_S);
    const event = signEvent(KIND_FRAME, armorFrame(frame), [['z', tag], ['expiration', expiration]]);
    const relays = sanitizeRelays([...(this.state.contacts[fp]?.relays ?? []), ...this.state.relays]);
    this.state.outbox.push({ event, relays, peer: fp, msgId, createdAt: Date.now() });
  }

  async flushOutbox(): Promise<void> {
    if (this.flushing || this.state.outbox.length === 0) return;
    this.flushing = true;
    try {
      const done = new Set<string>();
      for (const item of [...this.state.outbox]) {
        const res = await this.pool.publish(item.event, item.relays);
        const msg = item.msgId ? this.findMessage(item.peer, item.msgId) : undefined;
        if (res.some((r) => r.ok)) {
          done.add(item.event.id);
          if (msg && msg.status === 'pending') msg.status = 'sent';
        } else if (Date.now() - item.createdAt > OUTBOX_GIVE_UP_MS) {
          done.add(item.event.id);
          if (msg) msg.status = 'failed';
        }
      }
      // Items enqueued while we were publishing are kept for the next round.
      this.state.outbox = this.state.outbox.filter((o) => !done.has(o.event.id));
    } finally {
      this.flushing = false;
      this.changed();
    }
  }

  // ─── Receiving ───────────────────────────────────────────────────────────────

  private async resubscribe(catchUp: boolean): Promise<void> {
    const now = Date.now();
    const epoch = Math.floor(now / 3600_000);
    if (!catchUp && epoch === this.subscribedEpoch) return;
    this.subscribedEpoch = epoch;
    const offlineEpochs = Math.ceil((now - this.state.lastOnlineMs) / 3600_000) + 1;
    const backlog = catchUp ? Math.min(BACKLOG_EPOCHS, offlineEpochs) : 1;
    const tags = [...this.endpoint.watchedTags(now, backlog).keys()];
    this.watchedCount = this.endpoint.watchedTags(now).size;
    const since = Math.floor(now / 1000) - (backlog + 2) * 3600;
    const filters = [];
    for (let i = 0; i < tags.length; i += 100) filters.push({ kinds: [KIND_FRAME], '#z': tags.slice(i, i + 100), since });
    await this.pool.subscribe('frames', filters, this.state.relays);
  }

  private onEvent(e: NostrEvent): void {
    if (e.kind !== KIND_FRAME) return;
    let frame: Uint8Array;
    try {
      frame = dearmorFrame(e.content);
    } catch {
      return;
    }
    let got;
    try {
      got = this.endpoint.receive(frame, Date.now(), BACKLOG_EPOCHS);
    } catch (err) {
      console.warn('frame rejected', err);
      return;
    }
    if (!got) return;
    this.handleContent(got.from, got.plaintext, got.newSession);
    this.refreshSubscriptionIfNeeded();
  }

  private handleContent(from: string, plaintext: Uint8Array, newSession: boolean): void {
    let content;
    try {
      content = decodeContent(plaintext);
    } catch {
      return;
    }
    const known = Boolean(this.state.contacts[from]);
    const c = this.upsertContact(from, '', null, []);
    // Notices sort just before the message that triggered them.
    const noticeTs = Math.min(Number(content.sentAtMs) || Date.now(), Date.now()) - 1;
    if (!known) {
      c.name = 'Novo contato';
      this.push(from, { id: `sys-${noticeTs}`, dir: 'system', text: 'Este contato iniciou uma conversa com você. Confira o número de segurança antes de confiar.', ts: noticeTs, status: 'sent' });
    } else if (newSession) {
      this.push(from, { id: `sys-${noticeTs}`, dir: 'system', text: 'Nova sessão segura iniciada por este contato.', ts: noticeTs, status: 'sent' });
    }

    switch (content.body) {
      case 'contactCard': {
        try {
          const cardBytes = cardFromContent(content);
          const parsed = parseContactCard(cardBytes, { expectedFingerprint: fromHex(from) });
          if (!known || c.name === 'Novo contato') c.name = parsed.displayName || c.name;
          c.card = toBase64Url(cardBytes);
          c.relays = parsed.relays;
        } catch (err) {
          console.warn('bad contact card', err);
        }
        break;
      }
      case 'text': {
        const body = String((content.text as { body?: string }).body ?? '').slice(0, MAX_TEXT);
        const id = toHex(content.messageId);
        if (!this.findMessage(from, id)) {
          this.push(from, { id, dir: 'in', text: body, ts: Math.min(Number(content.sentAtMs) || Date.now(), Date.now()), status: 'delivered' });
          c.unread += 1;
          this.sendReceipt(from, [content.messageId]);
        }
        break;
      }
      case 'receipt': {
        const r = content.receipt as { messageIds?: Uint8Array[] };
        for (const id of r.messageIds ?? []) {
          const m = this.findMessage(from, toHex(id));
          if (m && m.dir === 'out') m.status = 'delivered';
        }
        break;
      }
      default:
        this.push(from, { id: toHex(content.messageId), dir: 'system', text: 'Mensagem de um tipo que esta versão não suporta.', ts: Date.now(), status: 'sent' });
    }
    this.changed();
  }

  private sendReceipt(fp: string, ids: Uint8Array[]): void {
    try {
      this.enqueue(fp, this.endpoint.sendTo(fp, encodeContent({ receipt: { type: 'DELIVERED', messageIds: ids } })), null);
      void this.flushOutbox();
    } catch (err) {
      console.warn('receipt failed', err);
    }
  }

  private push(fp: string, m: Message): void {
    (this.state.messages[fp] ??= []).push(m);
    this.state.messages[fp]!.sort((a, b) => a.ts - b.ts);
  }

  private findMessage(fp: string, id: string): Message | undefined {
    return this.state.messages[fp]?.find((m) => m.id === id);
  }

  private maybeRotatePrekey(): void {
    const spk = this.endpoint.signedPrekeys[0];
    if (spk && Date.now() - spk.createdAtMs > SPK_ROTATE_MS) {
      this.endpoint.rotateSignedPrekey();
      void this.publishCard();
      this.changed();
    }
  }
}

export function extractInviteCode(input: string): string | null {
  const s = input.trim();
  const m = s.match(/[#&?]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{40,}$/.test(s) ? s : null;
}
