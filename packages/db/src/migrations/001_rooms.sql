-- holds the room token and tells us when the room actually expires
CREATE TABLE IF NOT EXISTS rooms (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
