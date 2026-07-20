# Ops runbook — light up the credentialed features (#179, #253)

Two features are **code-complete and tested** but dark in production behind
owner-only gates: **ASC one-click push (#179)** and **ASA keyword popularity
(#253)**. Neither needs code — they need the steps below, which only the account
owner can do (they involve prod secrets + Apple credentials).

All commands run from `cloud/`. Secrets are set with `wrangler secret put` (they
never live in the repo or in `wrangler.toml`).

---

## A. Activate credential storage + ASC push (#179)

This lights up: envelope-encrypted credential storage, the keyed autonomous
sweep, and the "Push to App Store Connect" button on approved runs (web +
mobile). Until `CRED_KEK_V1` is set, `credentialsEnabled(env)` is false and no
key can be stored; until `ASC_WRITE_ENABLED` is on, `ascPushRoute` 403s.

### 1. Mint a 32-byte KEK and set it as a secret

`CRED_KEK_V1` must be **base64 of exactly 32 random bytes** (AES-256-GCM key).

```bash
# generate a fresh 32-byte key, base64-encoded
KEK=$(openssl rand -base64 32)
echo "$KEK"        # keep this somewhere safe (a password manager) — losing it
                   #   makes every stored credential un-decryptable

# set it (paste $KEK when prompted)
cd cloud
npx wrangler secret put CRED_KEK_V1
```

> **Custody:** the KEK lives only in the Worker secret store. D1 holds only the
> envelope (encrypted DEK + ciphertext), never the KEK or a plaintext `.p8`.
> Rotation later = add `CRED_KEK_V2` (the code lazy-re-wraps on use); never
> delete V1 until every credential has been re-wrapped.

### 2. Enable ASC writes

`ASC_WRITE_ENABLED` accepts `"1"` or `"true"`.

```bash
npx wrangler secret put ASC_WRITE_ENABLED
# enter: 1
```

> **Sequencing choice (per #179):** you can set `CRED_KEK_V1` first (storage +
> keyed sweep light up, push still 403s) and flip `ASC_WRITE_ENABLED` later once
> you've watched a keyed sweep run cleanly. Or set both now. Both are reversible
> (`wrangler secret delete`).

### 3. Verify

```bash
npx wrangler secret list           # CRED_KEK_V1 + ASC_WRITE_ENABLED present
```

Then in the app: connect an ASC key on an app (Settings/Connect), leave "save
this key" checked, approve a run, and click **Push to App Store Connect**. You
should see "name + subtitle + keywords staged on version X" — no CLI. The
`pushCommands` CLI handoff stays available behind the "Prefer the CLI?"
disclosure.

**Invariants that stay true regardless:** push only on approved/shipped runs +
explicit click; the `.p8` is decrypted per-request and never logged or persisted
onto a run; `applyAscMetadata` only pushes non-empty fields (blank never wipes).

---

## B. Turn on Apple Search Ads keyword popularity (#253)

The OAuth client, the `searchpopularity` reader, the connect route, and the
verification script are all built. They stay dark behind `ASA_POPULARITY_ENABLED`
because Apple's live v5 response shape was never exercised against a real funded
ASA account here. **Verify against live data before flipping the flag** — a
degraded read must yield "no popularity", never a fabricated number.

### 1. Create an ASA API certificate (Apple side)

Apple Search Ads → **Account Settings → API → Create API Certificate**. You get:
a private key (PEM, EC P-256), `clientId`, `teamId`, `keyId`, `orgId`.

### 2. Run the verification script against Apple's live API

Creds come from env vars (never disk/logs). From `cloud/`:

```bash
ASA_PRIVATE_KEY_FILE=~/Downloads/asa-key.pem \
ASA_CLIENT_ID=… ASA_TEAM_ID=… ASA_KEY_ID=… ASA_ORG_ID=… \
  npx tsx scripts/verify-asa-popularity.mts
```

It runs the REAL auth + read path and prints: the minted token, the `/acls`
org-reachability probe, and the popularity map for a few sample keywords.

### 3. Two outcomes

- **Numbers return** → the reader works. Set the flag and the numbers flow into
  scoring + UI (labeled `source:"asa"`, never silently blended with derived
  proxies):
  ```bash
  npx wrangler secret put ASA_POPULARITY_ENABLED   # enter: 1
  ```
- **Empty map** → Apple's JSON keys differ from the parser's expected
  (`searchPopularity` / `popularity` / `score`). Add a raw-dump to the script,
  inspect Apple's real JSON, fix `cloud/src/engine/asaClient.ts`'s parser, and
  re-verify. (This is the one bit that may need a small code follow-up — file an
  issue with the raw shape if so.)

---

## Quick reference

| Flag / secret | Feature | Accepted value |
|---|---|---|
| `CRED_KEK_V1` | credential storage (#67/#179) | base64 of 32 random bytes |
| `ASC_WRITE_ENABLED` | ASC one-click push (#179) | `1` or `true` |
| `ASA_POPULARITY_ENABLED` | ASA keyword popularity (#253) | `1` or `true` (after live verify) |

All three are set with `npx wrangler secret put <NAME>` from `cloud/` and removed
with `npx wrangler secret delete <NAME>`.
