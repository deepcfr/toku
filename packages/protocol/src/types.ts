// slot[1] contains the message type -> 1 byte
export const MessageType = {
  JOIN_ROOM: 0x01,
  LEAVE_ROOM: 0x02,
  CHAT_MESSAGE: 0x03,
  KEY_EXCHANGE: 0x04,
  DELIVERY_ACK: 0x05,
  PRESENCE_PING: 0x06,
  ROOM_STATE: 0x07,
  ERROR: 0x08,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface BaseMessage {
  type: MessageType;
  roomToken: string;
}

export interface JoinRoomMessage extends BaseMessage {
  type: typeof MessageType.JOIN_ROOM;
  publicKey: Uint8Array;
  passwordHash: Uint8Array;
}

export interface LeaveRoomMessage extends BaseMessage {
  type: typeof MessageType.LEAVE_ROOM;
}

export interface ChatMessage extends BaseMessage {
  type: typeof MessageType.CHAT_MESSAGE;
  from: string;
  msgId: number;
  timestamp: bigint;
  iv: Uint8Array;
  cipherText: Uint8Array;
  burn: boolean;
}

export interface KeyExchangeMessage extends BaseMessage {
  type: typeof MessageType.KEY_EXCHANGE;
  from: string;
  publicKey: Uint8Array;
}

export interface DeliveryAckMessage extends BaseMessage {
  type: typeof MessageType.DELIVERY_ACK;
  from: string;
  msgId: number;
}

export interface PresencePingMessage extends BaseMessage {
  type: typeof MessageType.PRESENCE_PING;
  from: string;
}

export interface RoomStateMessage extends BaseMessage {
  type: typeof MessageType.ROOM_STATE;
  members: Uint8Array[];
}

export interface ErrorMessage {
  type: typeof MessageType.ERROR;
  code: ErrorCode;
}

export const ErrorCode = {
  RATE_LIMITED: 0x01,
  ROOM_NOT_FOUND: 0x02,
  ROOM_FULL: 0x03,
  WRONG_PASSWORD: 0x04,
  BANNED: 0x05,
  INVALID_FRAME: 0x06,
  MALFORMED_CRYPTO: 0x07,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// every frame on the wire, server switches on type to narrow
export type AnyMessage =
  | JoinRoomMessage
  | LeaveRoomMessage
  | ChatMessage
  | KeyExchangeMessage
  | DeliveryAckMessage
  | PresencePingMessage
  | RoomStateMessage
  | ErrorMessage;
