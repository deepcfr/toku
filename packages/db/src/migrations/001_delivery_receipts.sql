-- create an enum for showing delivery status of the message
CREATE TYPE delivery_status AS ENUM('PENDING', 'DELIVERED', 'EXPIRED', 'FAILED');

-- use the enum type
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_token TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  status delivery_status NOT NULL DEFAULT 'PENDING',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

-- partial index -> helps the server quickly find missed messages when a user goes back online
CREATE INDEX idx_delivery_pending_recipient ON delivery_receipts (recipient_hash)
WHERE
  status = 'PENDING'
