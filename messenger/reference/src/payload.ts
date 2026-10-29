/**
 * L2 plaintext encoding with the canonical schema in ../../proto/sma.proto.
 *
 * protobufjs parses the .proto at load time so the schema file is the single source of
 * truth. A production client would use generated code (buf + protoc-gen-es / SwiftProtobuf /
 * Wire) instead; the bytes are identical.
 */
import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';
import { randomBytes } from './bytes.ts';

const PROTO_PATH = new URL('../../proto/sma.proto', import.meta.url);
const root = protobuf.parse(readFileSync(PROTO_PATH, 'utf8'), { keepCase: false }).root;

export const ContentType = root.lookupType('sma.v1.Content');
export const PrekeyBundleType = root.lookupType('sma.v1.PrekeyBundle');
export const SignedBlobType = root.lookupType('sma.v1.SignedBlob');
export const ContactCapsuleType = root.lookupType('sma.v1.ContactCapsule');

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

function encodeWith(type: protobuf.Type, value: Record<string, unknown>): Uint8Array {
  // fromObject converts enum names and nested objects; verify then checks the result.
  const message = type.fromObject(value);
  const problem = type.verify(message);
  if (problem) throw new Error(`${type.name}: ${problem}`);
  return type.encode(message).finish();
}

function decodeWith(type: protobuf.Type, bytes: Uint8Array): Record<string, unknown> {
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

export function encodeMessage(typeName: 'PrekeyBundle' | 'SignedBlob' | 'ContactCapsule', value: Record<string, unknown>): Uint8Array {
  return encodeWith(root.lookupType(`sma.v1.${typeName}`), value);
}

export function decodeMessage(typeName: 'PrekeyBundle' | 'SignedBlob' | 'ContactCapsule', bytes: Uint8Array): Record<string, unknown> {
  return decodeWith(root.lookupType(`sma.v1.${typeName}`), bytes);
}
