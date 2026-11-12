// row shapes mirror the migrations 1:1, update both together
// TIMESTAMPTZ -> Date, BYTEA -> Buffer, UUID/INT -> string/number

export type DeliveryStatus = "PENDING" | "DELIVERED" | "EXPIRED" | "FAILED";
export type IncidentLabel =
  "RATE_LIMIT_REDIS" | "MALFORMED_FRAME" | "ROOM_SPAM";

// rooms table
export interface RoomRow {
  token: string;
  created_at: Date;
  expires_at: Date;
}

// room_messages table
export interface RoomMessageRow {
  room_token: string;
  message_id: number;
  ciphertext: Buffer;
  iv: Buffer;
  created_at: Date;
}

// delivery_receipts table
// column stays recipient_hash (row role), value stored is a pubKeyHash
export interface DeliveryReceiptRow {
  id: string;
  room_token: string;
  recipient_hash: string;
  message_id: number;
  status: DeliveryStatus;
  attempted_at: Date;
  delivered_at: Date | null;
}

// security_incident_log table
export interface SecurityIncidentLogRow {
  id: string;
  identity_hash: string;
  incident_type: IncidentLabel;
  occurred_at: Date;
  room_token: string | null;
}

// active_bans table
export interface ActiveBanRow {
  identity_hash: string;
  reason: string | null;
  banned_at: Date;
  expires_at: Date;
}
