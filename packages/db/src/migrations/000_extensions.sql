-- required for gen_random_uuid() used in later migrations
-- runs first by filename order, safe to re-run
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
