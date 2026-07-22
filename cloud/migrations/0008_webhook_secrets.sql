-- 0008_webhook_secrets — maps an ASC numeric app id to our app row + the
-- webhook HMAC secret used to verify inbound deliveries (src/api/webhookReceiver.ts).
--
-- The secret is SEALED at rest via the SAME KEK/DEK envelope crypto as
-- `stored_credentials` (src/crypto/credentialVault.ts) — ciphertext + wrapped
-- DEK + kek_version, never plaintext. See src/d1.ts `saveWebhookSecret` /
-- `getWebhookSecretByAscAppId` and credentialStore's `saveCredential` /
-- `useCredential` for the reference pattern. Guarded so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS webhook_secrets (
  asc_app_id   TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  wrapped_dek  TEXT NOT NULL,
  kek_version  INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
