-- 0014_notification_channels — per-user delivery destinations, so a
-- notification can reach a channel the user's AGENT already lives in
-- (Telegram, Discord, SMS, WhatsApp) rather than only their inbox.
--
-- WHY A TABLE AND NOT MORE COLUMNS ON users:
-- Today every comms pref is a boolean column (email_digest, push_run_ready,
-- email_run_ready). That shape cannot express what these channels need:
--   • an ADDRESS — a chat id, a phone number, a webhook url. A boolean says
--     whether to send, never where.
--   • MORE THAN ONE per channel — a personal and a team Telegram chat, two
--     devices. A column holds exactly one.
--   • PER-DESTINATION STATE — verified yet? when did it last fail? A column
--     that only holds on/off cannot see a destination that has gone stale, and
--     a rule that only takes on/off cannot notice removal.
-- device_tokens already set this precedent (per-user rows, a `platform`
-- discriminator); this generalizes it beyond push.
--
-- VERIFICATION IS REQUIRED, not decorative. `verified_at` NULL means we have
-- an address nobody has proven they control. An unverified destination MUST
-- NOT receive notifications: a typo'd chat id would otherwise send someone
-- else's listing copy to a stranger, and an attacker who could write a row
-- would have a delivery channel for another account's data. The send path
-- filters on verified_at IS NOT NULL; this column is the enforcement point.
--
-- ENABLED is separate from VERIFIED on purpose. Verified answers "is this
-- address really yours"; enabled answers "do you want traffic here right now".
-- Muting a channel must not force re-proving ownership to turn it back on.
--
-- NO CHECK ON `channel`. Adding SMS/Discord/WhatsApp must not require
-- rebuilding a table that holds user destinations; the ChannelKind union in
-- src/notify/channel.ts is the validation, and the send path ignores a channel
-- it has no deliverer for (reported, never silently dropped).
--
-- FAILURE TRACKING (last_error / last_failed_at) exists so a dead destination
-- is visible rather than a silent hole. A channel that stopped working looks
-- exactly like a quiet week unless something records the difference.
--
-- PRIVACY: an address IS personal data. Rows are per-user and cascade-delete
-- with the user, unlike proposal_edits which is deliberately anonymous — these
-- must be deletable, so they are deliberately identified.
CREATE TABLE IF NOT EXISTS notification_channels (
  id             TEXT PRIMARY KEY,                     -- uuid
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,                        -- 'email' | 'telegram' | future
  address        TEXT NOT NULL,                        -- channel-native: email, chat id, number
  label          TEXT NOT NULL DEFAULT '',             -- user-facing name ("team chat")
  enabled        INTEGER NOT NULL DEFAULT 1,           -- 0 ⇒ muted, ownership still proven
  verified_at    TEXT,                                 -- NULL ⇒ unproven ⇒ NEVER delivered to
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at   TEXT,
  last_failed_at TEXT,
  last_error     TEXT,
  -- One row per (user, channel, address): re-adding the same destination is an
  -- update, not a duplicate that would double-send every notification.
  UNIQUE (user_id, channel, address)
);
CREATE INDEX IF NOT EXISTS idx_notification_channels_user ON notification_channels(user_id);
