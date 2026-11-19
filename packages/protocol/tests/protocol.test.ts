import { describe, expect, it } from "bun:test";
import {
  decode,
  encode,
  ErrorCode,
  MessageType,
  ProtocolError,
  SIZES,
  type ChatMessage,
  type DeliveryAckMessage,
  type ErrorMessage,
  type JoinRoomMessage,
  type KeyExchangeMessage,
  type LeaveRoomMessage,
  type PresencePingMessage,
  type RoomStateMessage,
} from "../src";

describe("Protocol Encoding & Decoding", () => {
  it("encodes and decodes JOIN_ROOM message", () => {
    const msg: JoinRoomMessage = {
      type: MessageType.JOIN_ROOM,
      roomToken: "room-abc-123",
      publicKey: new Uint8Array(SIZES.PUBKEY).fill(0x11),
      passwordHash: new Uint8Array(SIZES.HASH).fill(0x22),
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as JoinRoomMessage;

    expect(decoded.type).toBe(MessageType.JOIN_ROOM);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.publicKey).toEqual(msg.publicKey);
    expect(decoded.passwordHash).toEqual(msg.passwordHash);
  });

  it("encodes and decodes LEAVE_ROOM message", () => {
    const msg: LeaveRoomMessage = {
      type: MessageType.LEAVE_ROOM,
      roomToken: "room-leave-999",
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as LeaveRoomMessage;

    expect(decoded.type).toBe(MessageType.LEAVE_ROOM);
    expect(decoded.roomToken).toBe(msg.roomToken);
  });

  it("encodes and decodes CHAT_MESSAGE message", () => {
    const msg: ChatMessage = {
      type: MessageType.CHAT_MESSAGE,
      roomToken: "chat-room-456",
      from: "alice-pubkey-hash-hex",
      msgId: 42,
      timestamp: 1718000000000n,
      iv: new Uint8Array(SIZES.IV).fill(0x07),
      cipherText: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      burn: true,
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as ChatMessage;

    expect(decoded.type).toBe(MessageType.CHAT_MESSAGE);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.from).toBe(msg.from);
    expect(decoded.msgId).toBe(msg.msgId);
    expect(decoded.timestamp).toBe(msg.timestamp);
    expect(decoded.iv).toEqual(msg.iv);
    expect(decoded.cipherText).toEqual(msg.cipherText);
    expect(decoded.burn).toBe(true);
  });

  it("encodes and decodes KEY_EXCHANGE message", () => {
    const msg: KeyExchangeMessage = {
      type: MessageType.KEY_EXCHANGE,
      roomToken: "room-keyex-111",
      from: "carol-sender",
      publicKey: new Uint8Array(SIZES.PUBKEY).fill(0xaa),
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as KeyExchangeMessage;

    expect(decoded.type).toBe(MessageType.KEY_EXCHANGE);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.from).toBe(msg.from);
    expect(decoded.publicKey).toEqual(msg.publicKey);
  });

  it("encodes and decodes DELIVERY_ACK message", () => {
    const msg: DeliveryAckMessage = {
      type: MessageType.DELIVERY_ACK,
      roomToken: "room-ack-222",
      from: "bob-ack",
      msgId: 101,
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as DeliveryAckMessage;

    expect(decoded.type).toBe(MessageType.DELIVERY_ACK);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.from).toBe(msg.from);
    expect(decoded.msgId).toBe(msg.msgId);
  });

  it("encodes and decodes PRESENCE_PING message", () => {
    const msg: PresencePingMessage = {
      type: MessageType.PRESENCE_PING,
      roomToken: "room-ping-333",
      from: "dave-presence",
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as PresencePingMessage;

    expect(decoded.type).toBe(MessageType.PRESENCE_PING);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.from).toBe(msg.from);
  });

  it("encodes and decodes ROOM_STATE message", () => {
    const member1 = new Uint8Array(SIZES.PUBKEY).fill(0x01);
    const member2 = new Uint8Array(SIZES.PUBKEY).fill(0x02);
    const msg: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      roomToken: "room-roster-777",
      members: [member1, member2],
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as RoomStateMessage;

    expect(decoded.type).toBe(MessageType.ROOM_STATE);
    expect(decoded.roomToken).toBe(msg.roomToken);
    expect(decoded.members.length).toBe(2);
    expect(decoded.members[0]).toEqual(member1);
    expect(decoded.members[1]).toEqual(member2);
  });

  it("encodes and decodes ERROR message", () => {
    const msg: ErrorMessage = {
      type: MessageType.ERROR,
      code: ErrorCode.BANNED,
    };

    const encoded = encode(msg);
    const decoded = decode(encoded) as ErrorMessage;

    expect(decoded.type).toBe(MessageType.ERROR);
    expect(decoded.code).toBe(ErrorCode.BANNED);
  });

  describe("Validation & Error Guards", () => {
    it("rejects frame shorter than MIN_FRAME_SIZE", () => {
      expect(() => decode(new Uint8Array([0xaa]))).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "FRAME_TOO_SHORT")
      );
    });

    it("rejects invalid magic byte", () => {
      expect(() => decode(new Uint8Array([0xbb, 0x01]))).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "BAD_MAGIC")
      );
    });

    it("rejects unknown opcode", () => {
      expect(() => decode(new Uint8Array([0xaa, 0x99]))).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "UNKNOWN_OPCODE")
      );
    });

    it("rejects trailing garbage", () => {
      const msg: LeaveRoomMessage = {
        type: MessageType.LEAVE_ROOM,
        roomToken: "tok",
      };
      const valid = encode(msg);
      const withGarbage = new Uint8Array(valid.length + 2);
      withGarbage.set(valid, 0);
      withGarbage.set([0xde, 0xad], valid.length);

      expect(() => decode(withGarbage)).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "TRAILING_GARBAGE")
      );
    });

    it("rejects truncated room token length", () => {
      // magic, type (LEAVE_ROOM), but missing room len byte
      expect(() => decode(new Uint8Array([0xaa, 0x02]))).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "TRUNCATED_ROOM_LEN")
      );
    });

    it("rejects truncated room token string", () => {
      // magic, type (LEAVE_ROOM), len = 5, but only 2 string bytes provided
      expect(() => decode(new Uint8Array([0xaa, 0x02, 5, 0x61, 0x62]))).toThrow(
        new ProtocolError(ErrorCode.INVALID_FRAME, "TRUNCATED_ROOM_TOKEN")
      );
    });
  });
});
