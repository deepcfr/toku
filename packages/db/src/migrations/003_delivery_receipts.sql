-- create an enum for showing delivery status of the message
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM('PENDING', 'DELIVERED', 'EXPIRED', 'FAILED');
  END IF;
END $$;

-- use the enum type
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_token TEXT NOT NULL REFERENCES rooms (token) ON DELETE CASCADE,
  recipient_hash TEXT NOT NULL,
  message_id INT NOT NULL,
  status delivery_status NOT NULL DEFAULT 'PENDING',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  FOREIGN KEY (room_token, message_id) REFERENCES room_messages (room_token, msg_id) ON DELETE CASCADE,
  CONSTRAINT unique_room_msg_recipient UNIQUE (room_token, recipient_hash, message_id)
);

-- partial index -> helps the server quickly find missed messages when a user goes back online
CREATE INDEX IF NOT EXISTS idx_delivery_pending_recipient ON delivery_receipts (recipient_hash)
WHERE
  status = 'PENDING';
