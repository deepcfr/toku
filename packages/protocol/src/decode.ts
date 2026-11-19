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

/**
 * Stateful binary reader for parsing frames with automatic bounds checking.
 * Encapsulates the raw byte buffer, DataView, and cursor offset.
 */
export class FrameReader implements DecoderContext {
  public readonly view: DataView;
  public o: number = 0;

  constructor(public readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.o;
  }

  set offset(value: number) {
    this.o = value;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.o;
  }

  requireBytes(n: number, errorDetail: string): void {
    if (this.o + n > this.bytes.byteLength) {
      throw new ProtocolError(ErrorCode.INVALID_FRAME, errorDetail);
    }
  }

  readUint8(errorDetail: string): number {
    this.requireBytes(1, errorDetail);
    return this.view.getUint8(this.o++);
  }

  readUint16(errorDetail: string): number {
    this.requireBytes(2, errorDetail);
    const value = this.view.getUint16(this.o, false);
    this.o += 2;
    return value;
  }

  readUint64(errorDetail: string): bigint {
    this.requireBytes(8, errorDetail);
    const value = this.view.getBigUint64(this.o, false);
    this.o += 8;
    return value;
  }

  readBytes(length: number, errorDetail: string): Uint8Array {
    this.requireBytes(length, errorDetail);
    const slice = this.bytes.subarray(this.o, this.o + length);
    this.o += length;
    return slice;
  }

  readString(lenError: string, dataError: string): string {
    const length = this.readUint8(lenError);
    return utf8.decode(this.readBytes(length, dataError));
  }

  assertFinished(): void {
    if (this.o !== this.bytes.byteLength) {
      throw new ProtocolError(ErrorCode.INVALID_FRAME, "TRAILING_GARBAGE");
    }
  }
}

export function decode(bytes: Uint8Array): AnyMessage {
  // check if the frame contains at least the magic byte and message type
  if (bytes.byteLength < MIN_FRAME_SIZE) {
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "FRAME_TOO_SHORT");
  }

  const reader = new FrameReader(bytes);

  const magicByte = reader.readUint8("FRAME_TOO_SHORT");
  if (magicByte !== PROTOCOL_MAGIC_BYTE) {
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "BAD_MAGIC");
  }

  const type = reader.readUint8("FRAME_TOO_SHORT");

  switch (type) {
    case MessageType.JOIN_ROOM:
      return decodeJoin(reader);
    case MessageType.LEAVE_ROOM:
      return decodeLeave(reader);
    case MessageType.CHAT_MESSAGE:
      return decodeChat(reader);
    case MessageType.KEY_EXCHANGE:
      return decodeKeyExchange(reader);
    case MessageType.DELIVERY_ACK:
      return decodeAck(reader);
    case MessageType.PRESENCE_PING:
      return decodePing(reader);
    case MessageType.ROOM_STATE:
      return decodeRoomState(reader);
    case MessageType.ERROR:
      return decodeError(reader);
    default:
      throw new ProtocolError(ErrorCode.INVALID_FRAME, "UNKNOWN_OPCODE");
  }
}

// sub-decoders: each reads fields in wire order and asserts exact frame consumption
function decodeJoin(reader: FrameReader): JoinRoomMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const publicKey = reader.readBytes(SIZES.PUBKEY, "TRUNCATED_PUBLIC_KEY");
  const passwordHash = reader.readBytes(SIZES.HASH, "TRUNCATED_PASSWORD_HASH");
  reader.assertFinished();

  return {
    type: MessageType.JOIN_ROOM,
    roomToken,
    publicKey,
    passwordHash,
  };
}

function decodeLeave(reader: FrameReader): LeaveRoomMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  reader.assertFinished();

  return {
    type: MessageType.LEAVE_ROOM,
    roomToken,
  };
}

function decodeChat(reader: FrameReader): ChatMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const from = reader.readString("TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const msgId = reader.readUint16("TRUNCATED_MSG_ID");
  const timestamp = reader.readUint64("TRUNCATED_TIMESTAMP");
  const iv = reader.readBytes(SIZES.IV, "TRUNCATED_IV");
  const ctLen = reader.readUint16("TRUNCATED_CT_LEN");
  const cipherText = reader.readBytes(ctLen, "TRUNCATED_CIPHERTEXT");
  const burn = reader.readUint8("TRUNCATED_BURN") !== 0;
  reader.assertFinished();

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

function decodeKeyExchange(reader: FrameReader): KeyExchangeMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const from = reader.readString("TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const publicKey = reader.readBytes(SIZES.PUBKEY, "TRUNCATED_PUBLIC_KEY");
  reader.assertFinished();

  return {
    type: MessageType.KEY_EXCHANGE,
    roomToken,
    from,
    publicKey,
  };
}

function decodeAck(reader: FrameReader): DeliveryAckMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const from = reader.readString("TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  const msgId = reader.readUint16("TRUNCATED_MSG_ID");
  reader.assertFinished();

  return {
    type: MessageType.DELIVERY_ACK,
    roomToken,
    from,
    msgId,
  };
}

function decodePing(reader: FrameReader): PresencePingMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const from = reader.readString("TRUNCATED_FROM_LEN", "TRUNCATED_FROM");
  reader.assertFinished();

  return {
    type: MessageType.PRESENCE_PING,
    roomToken,
    from,
  };
}

function decodeRoomState(reader: FrameReader): RoomStateMessage {
  const roomToken = reader.readString(
    "TRUNCATED_ROOM_LEN",
    "TRUNCATED_ROOM_TOKEN"
  );
  const count = reader.readUint8("TRUNCATED_MEMBER_CNT");
  const members: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    members.push(reader.readBytes(SIZES.PUBKEY, "TRUNCATED_MEMBER_KEY"));
  }
  reader.assertFinished();

  return {
    type: MessageType.ROOM_STATE,
    roomToken,
    members,
  };
}

function decodeError(reader: FrameReader): ErrorMessage {
  const code = reader.readUint8("TRUNCATED_ERROR_CODE");
  if (!isErrorCode(code)) {
    throw new ProtocolError(ErrorCode.INVALID_FRAME, "UNKNOWN_ERROR_CODE");
  }
  reader.assertFinished();

  return {
    type: MessageType.ERROR,
    code,
  };
}

function isErrorCode(n: number): n is ErrorCode {
  return (Object.values(ErrorCode) as number[]).includes(n);
}
