// raw bytes -> structured js object
// runs on server and redis subscribe
import { MIN_FRAME_SIZE, PROTOCOL_MAGIC_BYTE, SIZES } from "./constants";
import { ProtocolError } from "./errors";
import {
  ErrorCode,
  MessageType,
  type AnyMessage,
  type ChatMessage,
  type DecoderContext,
  type DeliveryAckMessage,
  type ErrorMessage,
  type JoinRoomMessage,
  type KeyExchangeMessage,
  type LeaveRoomMessage,
  type PresencePingMessage,
  type RoomStateMessage,
} from "./types";

const utf8 = new TextDecoder();

export function decode(bytes: Uint8Array): AnyMessage {
  // check if the frame contains atleast the magic byte and type
  if (bytes.byteLength < MIN_FRAME_SIZE)
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "FRAME_TOO_SHORT");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let o = 0;
  const magicByte = view.getUint8(o++);

  // if not our magic byte, drop it immediately, no further processing needed
  if (magicByte !== PROTOCOL_MAGIC_BYTE)
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "BAD_MAGIC");

  const type = view.getUint8(o++);
  const ctx: DecoderContext = { bytes, view, o };

  // route the remaining buffer to the correct sub-decoder
  switch (type) {
    case MessageType.JOIN_ROOM:
      return decodeJoin(ctx);
    case MessageType.LEAVE_ROOM:
      return decodeLeave(ctx);
    case MessageType.CHAT_MESSAGE:
      return decodeChat(ctx);
    case MessageType.KEY_EXCHANGE:
      return decodeKeyExchange(ctx);
    case MessageType.DELIVERY_ACK:
      return decodeAck(ctx);
    case MessageType.PRESENCE_PING:
      return decodePing(ctx);
    case MessageType.ROOM_STATE:
      return decodeRoomState(ctx);
    case MessageType.ERROR:
      return decodeError(ctx);
    default:
      throw new ProtocolError(ErrorCode.INVALID_FRAME, "UNKNOWN_OPCODE");
  }
}

// every read below is bounds-checked before it executes
// ctx.o is the shared cursor, exact fit asserted once per decoder
function requireBytes(ctx: DecoderContext, n: number, what: string): void {
  if (ctx.o + n > ctx.bytes.byteLength)
    throw new ProtocolError(ErrorCode.INVALID_FRAME, what);
}

function readU8(ctx: DecoderContext, what: string): number {
  requireBytes(ctx, 1, what);
  return ctx.view.getUint8(ctx.o++);
}

function readU16(ctx: DecoderContext, what: string): number {
  requireBytes(ctx, SIZES.MSG_ID, what);
  const v = ctx.view.getUint16(ctx.o, false);
  ctx.o += SIZES.MSG_ID;
  return v;
}

function readU64(ctx: DecoderContext, what: string): bigint {
  requireBytes(ctx, SIZES.TIMESTAMP, what);
  const v = ctx.view.getBigUint64(ctx.o, false);
  ctx.o += SIZES.TIMESTAMP;
  return v;
}

function readRaw(ctx: DecoderContext, n: number, what: string): Uint8Array {
  requireBytes(ctx, n, what);
  const s = ctx.bytes.subarray(ctx.o, ctx.o + n);
  ctx.o += n;
  return s;
}

function readStr(
  ctx: DecoderContext,
  lenGate: string,
  strGate: string
): string {
  const len = readU8(ctx, lenGate);
  return utf8.decode(readRaw(ctx, len, strGate));
}

function end(ctx: DecoderContext): void {
  if (ctx.o !== ctx.bytes.byteLength)
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "TRAILING_GARBAGE");
}

// sub-decoders, each starts past the 2-byte header
function decodeJoin(ctx: DecoderContext): JoinRoomMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const publicKey = readRaw(ctx, SIZES.PUBKEY, "TRUNCATED_PUBLIC_KEY");
  const passwordHash = readRaw(ctx, SIZES.HASH, "TRUNCATED_PASSWORD_HASH");
  end(ctx);

  return {
    type: MessageType.JOIN_ROOM,
    roomToken,
    publicKey,
    passwordHash,
  };
}

function decodeLeave(ctx: DecoderContext): LeaveRoomMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  end(ctx);

  return {
    type: MessageType.LEAVE_ROOM,
    roomToken,
  };
}

function decodeChat(ctx: DecoderContext): ChatMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const from = readStr(ctx, "TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const msgId = readU16(ctx, "TRUNCATED_MSG_ID");
  const timestamp = readU64(ctx, "TRUNCATED_TIMESTAMP");
  const iv = readRaw(ctx, SIZES.IV, "TRUNCATED_IV");
  const ctLen = readU16(ctx, "TRUNCATED_CT_LEN");
  const cipherText = readRaw(ctx, ctLen, "TRUNCATED_CIPHERTEXT");
  const burn = readU8(ctx, "TRUNCATED_BURN") !== 0;
  end(ctx);

  return {
    type: MessageType.CHAT_MESSAGE,
    roomToken,
    from,
    msgId,
    timestamp,
    iv,
    cipherText,
    burn,
  };
}

function decodeKeyExchange(ctx: DecoderContext): KeyExchangeMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const from = readStr(ctx, "TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const publicKey = readRaw(ctx, SIZES.PUBKEY, "TRUNCATED_PUBLIC_KEY");
  end(ctx);

  return {
    type: MessageType.KEY_EXCHANGE,
    roomToken,
    from,
    publicKey,
  };
}

function decodeAck(ctx: DecoderContext): DeliveryAckMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const from = readStr(ctx, "TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const msgId = readU16(ctx, "TRUNCATED_MSG_ID");
  end(ctx);

  return {
    type: MessageType.DELIVERY_ACK,
    roomToken,
    from,
    msgId,
  };
}

function decodePing(ctx: DecoderContext): PresencePingMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const from = readStr(ctx, "TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  end(ctx);

  return {
    type: MessageType.PRESENCE_PING,
    roomToken,
    from,
  };
}

function decodeRoomState(ctx: DecoderContext): RoomStateMessage {
  const roomToken = readStr(ctx, "TRUNCATED_ROOM_LEN", "TRUNCATED_ROOM_TOKEN");
  const count = readU8(ctx, "TRUNCATED_MEMBER_CNT");
  const members: Uint8Array[] = [];
  for (let i = 0; i < count; i++)
    members.push(readRaw(ctx, SIZES.PUBKEY, "TRUNCATED_MEMBER_KEY"));
  end(ctx);

  return {
    type: MessageType.ROOM_STATE,
    roomToken,
    members,
  };
}

function decodeError(ctx: DecoderContext): ErrorMessage {
  const code = readU8(ctx, "TRUNCATED_ERROR_CODE");
  if (!isErrorCode(code))
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "UNKNOWN_ERROR_CODE");
  end(ctx);

  return {
    type: MessageType.ERROR,
    code,
  };
}

function isErrorCode(n: number): n is ErrorCode {
  return (Object.values(ErrorCode) as number[]).includes(n);
}
