-- Single-use approval challenges (ADR-001, second attempt).
--
-- WHY A TABLE RATHER THAN A SIGNED TOKEN: the first fix minted a stateless
-- HMAC nonce from a dedicated endpoint. That endpoint handed an approval
-- credential to anyone holding the user's cookie, which — for an agent running
-- inside our own page — is everyone. Measured against production: a plain
-- scripted fetch received a valid nonce, 200.
--
-- A stateless token cannot be single-use, because nothing records that it was
-- spent. State is the point here: a challenge is issued when a person opens a
-- run, and BURNED when it is spent. Replay fails at the database, not at a
-- signature check that has no memory.
--
-- WHAT THIS DOES NOT DO: it does not prove a human clicked. An agent in the
-- page can read the challenge from the same response the dashboard reads it
-- from. `isTrusted` never crosses the network and no server-side check can
-- reconstruct it. What this removes is the credential-vending endpoint, the
-- unlimited mint, and the blind-POST path where an agent never loaded the run
-- at all. The residual limit is documented in ADR-001 rather than papered over.
CREATE TABLE IF NOT EXISTS approval_challenges (
  -- 128 bits of CSPRNG, base64url. The PRIMARY KEY is load-bearing: it is what
  -- makes a second INSERT of the same value fail rather than silently pass.
  challenge   TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  -- NULL until spent. Kept rather than deleted so a replay is distinguishable
  -- from an expiry in the logs — "already used" and "too old" are different
  -- failures and a support question can tell them apart.
  spent_at    TEXT,
  FOREIGN KEY (run_id)  REFERENCES runs(id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Issuing looks up by (run, user) to reuse a live challenge rather than pile up
-- a row per render; spending looks up by the primary key.
CREATE INDEX IF NOT EXISTS idx_approval_challenges_run_user
  ON approval_challenges(run_id, user_id, spent_at);
