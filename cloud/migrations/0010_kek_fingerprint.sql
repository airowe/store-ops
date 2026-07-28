-- 0010_kek_fingerprint — record WHICH key-encryption key sealed each stored
-- credential (#372).
--
-- WHY: CRED_KEK_V1 was set to a new random value on a deployment that already
-- had one. That replaced the key which unwraps existing rows and silently
-- orphaned every stored credential. Nothing detected it, because a
-- wrong-but-present KEK is indistinguishable from the correct one until a
-- decrypt actually fails — and metadata reads never decrypt, so the UI kept
-- advertising a key that could no longer be used.
--
-- kek_fingerprint is a truncated, domain-separated hash of the KEK
-- (crypto/credentialVault.ts kekFingerprint). It is NOT key material and NOT a
-- checksum of the credential: it identifies the wrapping key only, at 64 bits —
-- enough to distinguish the handful of KEKs a deployment holds, far too short
-- to help brute-force one. Safe to store and safe to log.
--
-- Nullable on purpose. Rows written before this migration have no fingerprint,
-- and a NULL must be read as "unknown", never as "mismatched" — treating legacy
-- rows as broken would be a fabricated failure, exactly the class of error this
-- column exists to prevent. Rows backfill on their next successful use, where
-- the decrypt has just proven which KEK opens them.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, and the schema tests apply schema.sql
-- (which already declares this column for fresh DBs) AND then every migration.
-- So this uses the repo's standard rebuild — create-new → copy → drop → rename,
-- the same shape as 0006 — which is a no-op-equivalent on a DB that already has
-- the column, rather than failing with "duplicate column name".

DROP TABLE IF EXISTS stored_credentials_new;

CREATE TABLE stored_credentials_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id        TEXT REFERENCES apps(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('asc','play','asa')),
  key_id        TEXT NOT NULL DEFAULT '',
  issuer_id     TEXT NOT NULL DEFAULT '',
  ciphertext    TEXT NOT NULL,
  wrapped_dek   TEXT NOT NULL,
  kek_version   INTEGER NOT NULL,
  kek_fingerprint TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE (user_id, app_id, kind)
);

-- Column-listed on both sides so this copies correctly whether or not the
-- source table already carries kek_fingerprint.
INSERT INTO stored_credentials_new
  (id, user_id, app_id, kind, key_id, issuer_id, ciphertext, wrapped_dek, kek_version, created_at, last_used_at)
  SELECT id, user_id, app_id, kind, key_id, issuer_id, ciphertext, wrapped_dek, kek_version, created_at, last_used_at
  FROM stored_credentials;

DROP TABLE stored_credentials;
ALTER TABLE stored_credentials_new RENAME TO stored_credentials;

CREATE INDEX IF NOT EXISTS idx_stored_cred_user ON stored_credentials(user_id);
