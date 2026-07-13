-- 0001_api_keys — scoped "shipaso_…" agent/MCP keys (see cloud/src/apiKeys.ts).
-- Store ONLY the SHA-256 hash of each key; the raw key is shown once and never
-- persisted. Idempotent (IF NOT EXISTS) so it's a no-op on a DB that already had
-- the table created by hand via the schema.sql commands.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT '',
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
