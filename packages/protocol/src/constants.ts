// every valid frame opens with this byte, anything else drops instantly
export const PROTOCOL_MAGIC_BYTE = 0xaa;

export const SIZES = {
  MAGIC: 1,
  TYPE: 1,
  ROOM_LEN: 1,
  FROM_LEN: 1,
  TIMESTAMP: 8,
  MSG_ID: 2,
  IV: 12,
  AUTH_TAG: 16,
  PUBKEY: 32,
  HASH: 32,
  MEMBER_CNT: 1,
  CT_LEN: 2,
  ERROR_CODE: 1,
} as const;

// minimum valid frame size, magic byte + message type
// anything shorter than this is physically incomplete and dropped immediately
export const MIN_FRAME_SIZE = SIZES.MAGIC + SIZES.TYPE;
