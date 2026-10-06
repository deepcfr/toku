-- security incident enum type
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_label') THEN
    CREATE TYPE incident_label AS ENUM('RATE_LIMIT_REDIS', 'MALFORMED_FRAME', 'ROOM_SPAM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS security_incident_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash TEXT NOT NULL,
  incident_type incident_label NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  room_token TEXT REFERENCES rooms (token) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_identity_time ON security_incident_log (identity_hash, occurred_at DESC);
