-- 0008_webhook_secrets — maps an ASC numeric app id to our app row + the
-- webhook HMAC secret used to verify inbound deliveries (src/api/webhookReceiver.ts).
--
-- WHY a dedicated table rather than `stored_credentials`: that table's envelope
-- crypto (KEK/DEK sealing) exists to protect high-value ASC API keys and its
-- `kind` union is closed to "asc" | "play" | "asa". A webhook secret is a
-- different, lower-sensitivity value we GENERATE and hand to Apple ourselves
-- at registration time (not a customer-supplied credential) — plaintext-at-rest
-- here is the simplest correct option; if this needs to be sealed later, follow
-- credentialStore's KEK/DEK model. Guarded so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS webhook_secrets (
  asc_app_id  TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  secret      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
