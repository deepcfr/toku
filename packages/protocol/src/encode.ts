// frame -> bytes, runs in server before redis publish and in web before ws send
// output stays Uint8Array so web (browser) can import this package, no Buffer

import { PROTOCOL_MAGIC_BYTE, SIZES } from "./constants";
import {
  MessageType,
  type AnyMessage,
  type ChatMessage,
  type DeliveryAckMessage,
  type ErrorMessage,
  type JoinRoomMessage,
  type KeyExchangeMessage,
  type LeaveRoomMessage,
  type PresencePingMessage,
  type RoomStateMessage,
} from "./types";

export function encode(msg: AnyMessage): Uint8Array {
  switch (msg.type) {
    case MessageType.JOIN_ROOM:
      return encodeJoin(msg);

    case MessageType.LEAVE_ROOM:
      return encodeLeave(msg);

    case MessageType.CHAT_MESSAGE:
      return encodeChat(msg);

    case MessageType.KEY_EXCHANGE:
      return encodeKeyExchange(msg);

    case MessageType.DELIVERY_ACK:
      return encodeAck(msg);

    case MessageType.PRESENCE_PING:
      return encodePing(msg);

    case MessageType.ROOM_STATE:
      return encodeRoomState(msg);

    case MessageType.ERROR:
      return encodeError(msg);

    default:
      // msg is never here, all 8 opcodes handled above
      // cast only to report runtime-forged values tsc cannot see
      throw new Error(
        `unsupported message type: ${(msg as unknown as { type: unknown }).type}`
      );
  }
}

// encode all the different types of messages
function encodeJoin(m: JoinRoomMessage): Uint8Array {
  // string -> raw bytes
  const room = new TextEncoder().encode(m.roomToken);

  // | 1 | 1 | 1 | N | 32 | 32 |
  // if ROOM_LEN = 10, the next 10 bytes will be used for the room
  // next offset = previous offset + size, 2 + N
  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.PUBKEY +
    SIZES.HASH;

  const out = new Uint8Array(totalSize);

  let o = 0;

  /**
   * slots hold 0-255(1 byte), bigger numbers(2 byte or 4 byte...) span several slots acting as one
   * DataView glues them together and reads them back as a single number
   */

  // not needed for 1 byte numbers
  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;
  out[o++] = room.length;

  out.set(room, o);
  o += room.length;
  out.set(m.publicKey, o);
  o += SIZES.PUBKEY;
  out.set(m.passwordHash, o);

  return out;
}

function encodeLeave(m: LeaveRoomMessage): Uint8Array {
  const room = new TextEncoder().encode(m.roomToken);
  const totalSize = SIZES.MAGIC + SIZES.TYPE + SIZES.ROOM_LEN + room.length;

  const out = new Uint8Array(totalSize);

  let o = 0;

  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;
  out[o++] = room.length;
  out.set(room, o);

  return out;
}

function encodePing(m: PresencePingMessage): Uint8Array {
  const encoder = new TextEncoder();
  const room = encoder.encode(m.roomToken);
  const from = encoder.encode(m.from);

  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.FROM_LEN +
    from.length;

  const out = new Uint8Array(totalSize);

  let o = 0;

  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;

  out[o++] = room.length;
  out.set(room, o);
  o += room.length;

  out[o++] = from.length;
  out.set(from, o);

  return out;
}

function encodeChat(m: ChatMessage): Uint8Array {
  // reachable boundary, media ciphertexts exceed the 2-byte length prefix
  if (m.cipherText.length > 0xffff) throw new Error("ciphertext too large");
  const encoder = new TextEncoder();
  const room = encoder.encode(m.roomToken);
  const from = encoder.encode(m.from);

  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.FROM_LEN +
    from.length +
    SIZES.MSG_ID +
    SIZES.TIMESTAMP +
    SIZES.IV +
    SIZES.CT_LEN +
    m.cipherText.length +
    SIZES.BURN;

  const out = new Uint8Array(totalSize);

  // use DataView
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let o = 0;

  view.setUint8(o++, PROTOCOL_MAGIC_BYTE);
  view.setUint8(o++, m.type);

  view.setUint8(o++, room.length);
  out.set(room, o);
  o += room.length;

  view.setUint8(o++, from.length);
  out.set(from, o);
  o += from.length;

  view.setUint16(o, m.msgId, false);
  o += SIZES.MSG_ID;

  // standard js numbers cant safely hold full 64-bit/8-byte integers without losing precision, so use a bigint
  view.setBigUint64(o, m.timestamp, false);
  o += SIZES.TIMESTAMP;

  out.set(m.iv, o);
  o += SIZES.IV;

  view.setUint16(o, m.cipherText.length, false);
  o += SIZES.CT_LEN;

  out.set(m.cipherText, o);
  o += m.cipherText.length;

  view.setUint8(o, m.burn ? 1 : 0);

  return out;
}

function encodeKeyExchange(m: KeyExchangeMessage): Uint8Array {
  const encoder = new TextEncoder();
  const room = encoder.encode(m.roomToken);
  const from = encoder.encode(m.from);

  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.FROM_LEN +
    from.length +
    SIZES.PUBKEY;

  const out = new Uint8Array(totalSize);

  let o = 0;

  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;

  out[o++] = room.length;
  out.set(room, o);
  o += room.length;

  out[o++] = from.length;
  out.set(from, o);
  o += from.length;

  out.set(m.publicKey, o);

  return out;
}

function encodeAck(m: DeliveryAckMessage): Uint8Array {
  const encoder = new TextEncoder();
  const room = encoder.encode(m.roomToken);
  const from = encoder.encode(m.from);

  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.FROM_LEN +
    from.length +
    SIZES.MSG_ID;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let o = 0;

  view.setUint8(o++, PROTOCOL_MAGIC_BYTE);
  view.setUint8(o++, m.type);

  view.setUint8(o++, room.length);
  out.set(room, o);
  o += room.length;

  view.setUint8(o++, from.length);
  out.set(from, o);
  o += from.length;

  view.setUint16(o, m.msgId, false);

  return out;
}

function encodeRoomState(m: RoomStateMessage): Uint8Array {
  const encoder = new TextEncoder();
  const room = encoder.encode(m.roomToken);
  const totalSize =
    SIZES.MAGIC +
    SIZES.TYPE +
    SIZES.ROOM_LEN +
    room.length +
    SIZES.MEMBER_CNT +
    m.members.length * SIZES.PUBKEY;

  const out = new Uint8Array(totalSize);

  let o = 0;

  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;

  out[o++] = room.length;
  out.set(room, o);
  o += room.length;

  // 1-byte safety limit. upto 255 members are allowed
  if (m.members.length > 0xff) throw new Error("too many members");
  out[o++] = m.members.length;
  for (const key of m.members) {
    out.set(key, o);
    o += SIZES.PUBKEY;
  }

  return out;
}

function encodeError(m: ErrorMessage): Uint8Array {
  const totalSize = SIZES.MAGIC + SIZES.TYPE + SIZES.ERROR_CODE;

  const out = new Uint8Array(totalSize);

  let o = 0;
  out[o++] = PROTOCOL_MAGIC_BYTE;
  out[o++] = m.type;
  out[o] = m.code;

  return out;
}
