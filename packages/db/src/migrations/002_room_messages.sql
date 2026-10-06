/*
since this is an E2EE chat app, we cant store the actual message. 
so we store the ciphertext and the iv that client uses to decrypt the ciphertext along with the secret key
and msgid for delivery ack
*/
CREATE TABLE IF NOT EXISTS room_messages (
  room_token TEXT NOT NULL REFERENCES rooms (token) ON DELETE CASCADE,
  msg_id INT NOT NULL,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- msg_id or room_token on its own is not unique, so we use a composite primary key
  PRIMARY KEY (room_token, msg_id)
);
