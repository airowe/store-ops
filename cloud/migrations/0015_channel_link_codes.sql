-- 0015_channel_link_codes — the short-lived codes that let a Telegram chat
-- prove someone controls it.
--
-- WHY THIS EXISTS RATHER THAN REUSING THE HMAC TOKENS:
-- Every other proof in this codebase is a self-describing signed token
-- (`payload.sig`) that needs no storage. That does not fit here. Telegram's
-- deep-link start parameter is documented as "up to 64 base64url characters",
-- and the existing token format measures 116 characters and contains a '.',
-- which is not base64url. A token Telegram silently truncates would verify
-- fine in tests and fail only in production.
--
-- So the code is OPAQUE and short, and the meaning lives here instead of in
-- the string. That also buys a property the signed tokens do not have:
-- SINGLE USE. A signed token stays valid for its whole TTL however many times
-- it is replayed; a row can be consumed. A deep link is pasted into a chat
-- log, so replay is the realistic risk, not forgery.
--
-- EXPIRY IS ENFORCED ON READ, not by a sweeper. A row that outlives its
-- expires_at is dead the moment it is looked at, so a cron that fails to run
-- can never resurrect one. The sweep below is housekeeping, never the
-- security boundary.
CREATE TABLE IF NOT EXISTS channel_link_codes (
  -- The opaque code itself, carried in the Telegram start payload. PRIMARY KEY
  -- so a duplicate code can never exist, and so consuming one is a single
  -- DELETE that either matched or did not.
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- Which channel this code links. Present from the start so Discord/WhatsApp
  -- reuse the same flow rather than each inventing one.
  channel TEXT NOT NULL,
  -- What the user will see this destination called once it is linked.
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Housekeeping only: expiry is enforced when a code is read, so this index
-- exists to make the sweep cheap, not to make it load-bearing.
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_expires
  ON channel_link_codes (expires_at);

-- A user's pending codes, for showing "waiting for you to open the link".
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_user
  ON channel_link_codes (user_id);
