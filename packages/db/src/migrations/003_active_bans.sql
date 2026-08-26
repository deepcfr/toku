CREATE TABLE IF NOT EXISTS active_bans (
  identity_hash TEXT PRIMARY KEY,
  reason TEXT,
  banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_active_bans_expiry ON active_bans (expires_at);
