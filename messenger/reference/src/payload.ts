/**
 * L2 plaintext encoding with the canonical schema in ../../proto/sma.proto.
 *
 * src/schema.static.js is generated from the .proto by `npm run gen:schema` (protobufjs
 * static code: no eval, so it runs under a strict Content-Security-Policy in browsers and the
 * Android WebView). The .proto stays the single source of truth; a test checks the generated
 * code is current. Other clients can use any protobuf compiler; the bytes are identical.
 */
import { randomBytes } from './bytes.ts';
import { sma } from './schema.static.js';

const T = sma.v1;

/** The subset of a generated message class this module uses. */
interface MessageClass {
  fromObject(o: Record<string, unknown>): object;
  verify(m: object): string | null;
  encode(m: object): { finish(): Uint8Array };
  decode(b: Uint8Array): object;
  toObject(m: object, o: { longs: NumberConstructor; enums: StringConstructor; oneofs: boolean }): Record<string, unknown>;
}

export const ContentType = T.Content as unknown as MessageClass & { decode(b: Uint8Array): { toJSON(): unknown } };
export const PrekeyBundleType = T.PrekeyBundle as unknown as MessageClass;
export const SignedBlobType = T.SignedBlob as unknown as MessageClass;
export const ContactCapsuleType = T.ContactCapsule as unknown as MessageClass;

/** Loose shape of a decoded `Content`; `body` names the populated oneof member. */
export interface ContentObject {
  messageId: Uint8Array;
  sentAtMs: number;
  expireAfterS?: number;
  replyTo?: Uint8Array;
  groupId?: Uint8Array;
  body?: string;
  [member: string]: unknown;
}

export type MessageTypeName = 'PrekeyBundle' | 'SignedBlob' | 'ContactCapsule' | 'ContactCard';

const types: Record<MessageTypeName, MessageClass> = {
  PrekeyBundle: PrekeyBundleType,
  SignedBlob: SignedBlobType,
  ContactCapsule: ContactCapsuleType,
  ContactCard: T.ContactCard as unknown as MessageClass,
};

function encodeWith(type: MessageClass, value: Record<string, unknown>): Uint8Array {
  // fromObject converts enum names and nested objects; verify then checks the result.
  const message = type.fromObject(value);
  const problem = type.verify(message);
  if (problem) throw new Error(problem);
  return type.encode(message).finish();
}

function decodeWith(type: MessageClass, bytes: Uint8Array): Record<string, unknown> {
  // Unknown fields are skipped (forward compatibility); enums as names, uint64 as number.
  return type.toObject(type.decode(bytes), { longs: Number, enums: String, oneofs: true });
}

export function encodeContent(value: Omit<ContentObject, 'messageId' | 'sentAtMs'> & Partial<ContentObject>): Uint8Array {
  return encodeWith(ContentType, { messageId: randomBytes(16), sentAtMs: Date.now(), ...value });
}

export function decodeContent(bytes: Uint8Array): ContentObject {
  const obj = decodeWith(ContentType, bytes) as unknown as ContentObject;
  if (!(obj.messageId instanceof Uint8Array) || obj.messageId.length !== 16) throw new Error('Content.message_id must be 16 bytes');
  return obj;
}

export function encodeMessage(typeName: MessageTypeName, value: Record<string, unknown>): Uint8Array {
  return encodeWith(types[typeName], value);
}

export function decodeMessage(typeName: MessageTypeName, bytes: Uint8Array): Record<string, unknown> {
  return decodeWith(types[typeName], bytes);
}
