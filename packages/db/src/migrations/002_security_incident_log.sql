-- security incident enum type
CREATE TYPE incident_label AS ENUM(
  'RATE_LIMIT_REDIS',
  'MALFORMED_FRAME',
  'ROOM_SPAM'
);

CREATE TABLE IF NOT EXISTS security_incident_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash TEXT NOT NULL,
  incident_type incident_label NOT NULL,
  occured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  room_token TEXT
);

CREATE INDEX idx_security_identity_time ON security_incident_log (identity_hash, occured_at DESC);
