# PRD — Issue #67: Encrypted ASC Key Storage (OVERRIDES never-persist rule)

> **Status: DECISION-GATED — DO NOT BUILD WITHOUT OWNER SIGN-OFF.**
> This PRD specifies Option 2 (custodial, encrypted-at-rest `.p8`) from issue #67. The issue body is explicit: this is **post-launch only**, requires a threat model + owner approval before *any* code, and the launch scope is Option 1 (per-run polish, no security-posture change). This document is the design artifact the owner reviews to make that call — not a green light to merge. Section 8 carries the explicit decision ask.

---

## 1. Problem & Context

### What exists today (the honest, launch-safe baseline)
Apple offers **no OAuth / "connect my account" flow** for the App Store Connect (ASC) API — authentication is `.p8` private key + ES256 JWT only. ShipASO's entire ASC integration is built around a single, deliberate security posture: **the `.p8` is used once per request and never persisted.**

This posture is implemented in concrete, well-commented code:

- **`cloud/src/engine/ascJwt.ts:1-12`** — the module header declares it is *"the ONLY place the `.p8` is handled. The key bytes live in local variables for the duration of one mint and are never persisted, never logged, and never placed in an error message."*
- **`mintAscJwt()` (`cloud/src/engine/ascJwt.ts:65-105`)** — takes `{ p8, keyId, issuerId }`, parses PKCS#8 (`parseP8`, line 34), imports a non-extractable `CryptoKey` (`extractable=false`, line 80), signs, and returns a ≤19-minute JWT. The key never leaves the function scope.
- Three API routes accept `{ p8, keyId, issuerId }` **in the request body only**, mint a JWT, use it, and discard:
  - **`runAppWithAsc` — `POST /apps/:id/run-asc`** (`cloud/src/api/index.ts:917-1044`): reads live subtitle/keywords/snapshot. Header comment (line 911-913): *"...are NEVER persisted — same ephemeral-credential posture as /asc/verify and /asc/push."*
  - **`ascVerifyRoute` — `POST /runs/:id/asc/verify`** (`cloud/src/api/index.ts:1485-1521`): probes `GET /v1/apps`. Comment (line 1482): *"the `.p8` is used in-request and never persisted (no D1, no secret) and never logged."*
  - **`ascPushRoute` — `POST /runs/:id/asc/push`** (`cloud/src/api/index.ts:1535-1578`): the only write path, gated behind `ASC_WRITE_ENABLED` (`cloud/src/index.ts:50-53`).
- **Frontend** re-enters the `.p8` per action, holds it only in DOM inputs + an in-memory `ascCredsMemory` for the session, and tells the user so verbatim: *"Your .p8 is used once and never stored."* (`cloud/public/app.js` — `ascPushCta` ~L2014, `ascVerifyPanel` ~L2061, `ascCredsMemory` reuse note ~L2042).
- **D1 schema (`cloud/schema.sql`)** has **no column anywhere** that stores key material. The only persisted credential is ShipASO's *own* GitHub App private key (`GITHUB_APP_PRIVATE_KEY`, a Worker secret — not a customer credential).

### What's missing / the friction
Because nothing is stored, the user must **re-paste the `.p8` on every action**: once for `run-asc`, again for `verify`, again for `push`, and — critically — **the weekly cron (`runWeeklySweep`, `cloud/src/cron/scheduled.ts:103-191`) can never read ASC data at all.** The cron runs `runAgent` against **iTunes-only** public data (`scheduled.ts:130`); it has no `.p8`, so autopilot/fleet customers get a degraded, public-only weekly loop while manual runs can be ASC-rich. This is the core UX gap: **standing autonomy can't see the customer's real ASC metadata.**

### Why it matters / why it's hard
Storing the `.p8` is a **deliberate security-posture change with real blast radius**: ShipASO becomes custodian of customers' Apple credentials. A breach of stored keys = attacker can read/write every connected customer's App Store listing. The issue body is unambiguous that this **explicitly overrides the standing "never-persist" rule** and must not ship without a threat model, an encryption-at-rest design, revocation/rotation UX, and explicit owner approval. This PRD provides all four so the owner can decide.

### Honesty-product framing
ShipASO's core value is **honesty** — never present unseen data as measured, never auto-push. The current per-run model is *maximally honest about custody* ("we never hold your key"). Persisting the key trades that custody honesty for a UX win. The design below preserves the *other* two honesty invariants absolutely: stored keys still **never auto-push** (the human approval gate is untouched), and cron ASC reads remain clearly attributed as measured-from-ASC vs. inferred.

---

## 2. Goal & Non-Goals

### Goal
Let a customer **opt in, once, to ShipASO storing their ASC `.p8` encrypted at rest**, so that:
1. `run-asc`, `verify`, and `push` no longer require re-pasting the key.
2. The **weekly cron can perform ASC-grounded reads** for opted-in apps (the real prize).
3. The customer can **see, rotate, and revoke** the stored key at any time, with a hard delete.

All while keeping the two untouchable invariants: **(a) the agent never auto-pushes** — `push` still requires an approved run + an explicit human click; **(b) honesty of measurement** — ASC-sourced data stays distinguished from inferred.

### Non-Goals
- **Not** changing the approval gate, the threshold logic, or making the cron push. Cron stays read-only (`scheduled.ts:5-21`). Push remains human-gated, `ASC_WRITE_ENABLED`-gated, and approval-gated.
- **Not** "Sign in with Apple" for ASC (does not exist — rejected in the issue).
- **Not** the team-key invite model (rejected in the issue).
- **Not** removing the per-run ephemeral path. Encrypted storage is **purely additive and opt-in**; the never-store path stays the default and remains available for users who decline custody.
- **Not** storing keyId/issuerId in a way that's treated as secret — they are non-sensitive identifiers (already shown in UI placeholders), but they live alongside the encrypted blob for convenience.
- **Not** building Option 1 (launch polish) — that is the separate launch-scope deliverable in the same issue and is tracked independently.

---

## 3. Proposed Approach (grounded in real files)

### 3.1 Encryption model — envelope encryption, per-tenant key, Worker-held master key
We do **not** store plaintext. We use **envelope encryption**:

1. A **master key** (`ASC_KEK`) lives as a **Worker secret** (`wrangler secret put ASC_KEK`), never in D1, never in code, never in `wrangler.toml` (mirrors the existing secret convention documented in `wrangler.toml` and `SESSION_SECRET` handling in `cloud/src/auth.ts`).
2. For each stored key we generate a fresh **256-bit data encryption key (DEK)** and a **96-bit IV**, AES-GCM-encrypt the `.p8` bytes with the DEK, then **wrap (encrypt) the DEK with the KEK** (AES-GCM). We store: `ciphertext`, `iv`, `wrapped_dek`, `dek_iv`, plus an **AAD** binding of `user_id|app_id|keyId` so a stolen row can't be replayed under a different tenant.
3. All crypto is **Web Crypto (`crypto.subtle`)** — the same primitive set already used in `ascJwt.ts:76` and `auth.ts`. No new dependency.

A new pure module **`cloud/src/engine/ascKeyVault.ts`** owns this, mirroring the `ascJwt.ts` discipline (network-free, exhaustively unit-tested, key-free error messages):

```
export async function sealP8(input: { p8: string; kek: CryptoKey; aad: string }): Promise<SealedP8>
export async function openP8(sealed: SealedP8, opts: { kek: CryptoKey; aad: string }): Promise<string>
export async function importKek(rawBase64: string): Promise<CryptoKey>   // non-extractable AES-GCM key
export class AscVaultError extends Error {}   // messages NEVER contain key material (mirrors AscCredError)
export type SealedP8 = { ciphertext: string; iv: string; wrappedDek: string; dekIv: string; alg: "AES-GCM"; v: 1 }
```

`SealedP8` is versioned (`v: 1`) so a future KEK rotation / algo change is non-breaking.

### 3.2 Storage — new D1 table, never on the run trace
A new table **`asc_keys`** (one row per app, opt-in). It must **never** be read into the `ReasoningTrace` or any client response — same boundary discipline as the ASC snapshot, which `runAppWithAsc` keeps server-side only (`cloud/src/api/index.ts:1033-1036`: *"persistRun deliberately does NOT copy it onto the trace, so it never reaches the client"*). The vault row stays entirely in the data layer (`d1.ts`); only booleans/metadata (`hasStoredKey`, `keyId`, `created_at`, `last_used_at`) ever reach the API surface.

### 3.3 New D1 accessors (`cloud/src/d1.ts`)
Following the existing accessor style (`getApp` line 360, `setGithubConnection`, etc.):
- `putAscKey(db, { appId, userId, keyId, issuerId, sealed })` — upsert (one row per app).
- `getAscKey(db, appId)` → `{ keyId, issuerId, sealed, ... } | null` (data layer only).
- `getAscKeyMeta(db, appId)` → `{ hasStoredKey, keyId, issuerId, created_at, last_used_at } | null` (safe to surface).
- `deleteAscKey(db, appId)` — hard delete (revocation).
- `touchAscKeyUsed(db, appId)` — bump `last_used_at` (audit trail).

### 3.4 Decrypt-on-use helper in the API (`cloud/src/api/index.ts`)
A single private helper resolves credentials with a clear precedence, so all three routes share one path:

```
async function resolveAscCreds(env, app, userId, body):
  { p8, keyId, issuerId } | null
  // 1. body.p8 + body.keyId + body.issuerId present  → use ephemeral (current behavior, unchanged)
  // 2. else if a stored key exists for app            → openP8(...) with the Worker KEK, touchAscKeyUsed
  // 3. else                                            → null (caller 400s, exactly as today)
```

This is the minimal wiring change: `runAppWithAsc` (`index.ts:925-933`), `ascVerifyRoute` (`index.ts:1496-1502`), and `ascPushRoute` (`index.ts:1552-1559`) each replace their `if (!body.p8 ...) throw 400` + inline `mintAscJwt` with a call to `resolveAscCreds`, then mint as before. The mint/use code (`mintAscJwt`) is **unchanged** — the key still only ever lives in a local for the duration of one mint.

### 3.5 New opt-in storage routes (`cloud/src/api/index.ts`)
- **`POST /apps/:id/asc/key`** `{ p8, keyId, issuerId }` → verify against Apple first (reuse the `ascVerifyRoute` probe of `GET /v1/apps`, `index.ts:1509`), and **only on success** seal + `putAscKey`. Returns `{ stored: true, keyId, appsVisible }`. Refusing to store an unverified key prevents silently persisting garbage.
- **`GET /apps/:id/asc/key`** → `getAscKeyMeta` → `{ hasStoredKey, keyId, issuerId, created_at, last_used_at }`. Never returns ciphertext or plaintext.
- **`DELETE /apps/:id/asc/key`** → `deleteAscKey` → `{ deleted: true }`. The revocation control.

All three use `requireOwnedApp` (`index.ts:510-514`) so a user can only touch their own app's key. Routing is added to the dispatcher near the existing `run-asc` segment match (`index.ts:1897`).

### 3.6 Cron — the actual payoff (`cloud/src/cron/scheduled.ts`)
In `runWeeklySweep` (`scheduled.ts:107-176`), for each app, after building the iTunes input but before `runAgent`, check `getAscKey(env.DB, app.id)`. If a stored key exists **and** `env.ASC_KEK` is set, decrypt, mint a JWT, and perform the same ASC read `runAppWithAsc` does (`findAscAppId` → `readAscLocalization` → `readAscSnapshot`, `index.ts:943-953`), threading `baseCopy`/snapshot into the run so the weekly pass is **ASC-grounded** for opted-in apps. On any decrypt/read failure: **degrade to the current iTunes-only path** (never strand the sweep — matches the existing per-app isolation at `scheduled.ts:177-187` and the honest-fallback comment at `index.ts:957-961`). **The cron still never pushes** (`scheduled.ts:5,20-21` invariant preserved).

To keep the ASC read logic in one place, extract the read block from `runAppWithAsc` into a small reusable `readAscForRun(fetch, { token, bundleId, locale })` in a new helper so both the API route and the cron call identical code (avoids drift).

### 3.7 Frontend (`cloud/public/app.js`)
- In `ascVerifyPanel` (~L2061) and `ascPushCta` (~L2014): add an opt-in **"Remember this key (encrypted) so weekly runs can read your ASC data"** checkbox. When a stored key exists (`GET .../asc/key`), pre-fill keyId/issuerId, show *"Stored, encrypted · last used {date}"*, hide the `.p8` textarea, and show a **"Forget key"** button (→ `DELETE`).
- The copy must change **honestly**: the current *"used once and never stored"* line stays the default for the ephemeral path, but when the user opts into storage it must read e.g. *"Stored encrypted at rest. Used for weekly runs and pushes. You can revoke it anytime."* — no claim of non-storage when we are storing.

---

## 4. Exact Files to Change / Add

### New files
| File | Purpose |
|---|---|
| `cloud/src/engine/ascKeyVault.ts` | Envelope-encryption seal/open + KEK import. Pure, network-free, Web Crypto only. |
| `cloud/src/engine/ascKeyVault.spec.ts` | Unit tests (round-trip, tamper detection, AAD binding, key-free errors). |
| `cloud/src/engine/ascReadForRun.ts` | Extracted shared ASC-read block (used by API route + cron). |
| `cloud/src/engine/ascReadForRun.spec.ts` | Unit tests for the extracted read (mock fetch). |
| `cloud/migrations/0001_asc_keys.sql` *(or appended to `schema.sql` with the documented `ALTER`/`CREATE` migration block convention used at `schema.sql:37-46`)* | `asc_keys` table. |

### Changed files
| File | Change |
|---|---|
| `cloud/schema.sql` | Add `asc_keys` table + the inline migration `CREATE TABLE` comment block (per existing convention at `schema.sql:130-134`). |
| `cloud/src/index.ts` | Add `ASC_KEK?: string` to `Env` (next to the secrets block, `index.ts:31-57`), with a comment: opt-in custodial key encryption; unset → storage disabled, ephemeral-only. |
| `cloud/src/d1.ts` | Add `AscKeyRow` type + `putAscKey` / `getAscKey` / `getAscKeyMeta` / `deleteAscKey` / `touchAscKeyUsed`. Cascade-delete via `deleteApp` (`d1.ts:375`) so disconnecting an app drops its key. |
| `cloud/src/api/index.ts` | Add `resolveAscCreds` helper; refactor `runAppWithAsc` / `ascVerifyRoute` / `ascPushRoute` to use it; add `POST/GET/DELETE /apps/:id/asc/key` handlers + dispatcher routing (~`index.ts:1897`). Import `sealP8`/`openP8`/`importKek` from the new vault. |
| `cloud/src/cron/scheduled.ts` | Decrypt-on-use ASC read for opted-in apps before `runAgent` (`scheduled.ts:127-131`); honest fallback to iTunes-only on any failure. |
| `cloud/public/app.js` | Opt-in "remember key" checkbox, stored-key status UI, "Forget key" control, honest copy when storing. |
| `cloud/wrangler.toml` | Document `ASC_KEK` in the secrets section (alongside `SESSION_SECRET` etc., near the secrets block). |

### Proposed `asc_keys` schema
```sql
CREATE TABLE IF NOT EXISTS asc_keys (
  app_id        TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id        TEXT NOT NULL,         -- ASC API key id (non-secret identifier)
  issuer_id     TEXT NOT NULL,         -- ASC issuer id (non-secret identifier)
  sealed_json   TEXT NOT NULL,         -- SealedP8 v1: {ciphertext, iv, wrappedDek, dekIv, alg, v}
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_asc_keys_user ON asc_keys(user_id);
```
`ON DELETE CASCADE` on `app_id` means `deleteApp` already shreds the key when an app is disconnected — no extra wiring, no orphaned ciphertext.

---

## 5. Test Plan (TDD, `*.spec.ts`, colocated)

Follows the repo convention: pure logic in colocated `*.spec.ts` (vitest), integration flows in `cloud/tests/e2e/*.e2e.ts`. **Scaffold stub → failing test → implement**, per the project's TDD rule.

### Unit — `cloud/src/engine/ascKeyVault.spec.ts` (the security core; mirrors `ascJwt.spec.ts`)
- `sealP8` → `openP8` round-trips the exact `.p8` bytes (use the throwaway `TEST_P8` from `ascJwt.spec.ts:6-10`).
- `openP8` **throws `AscVaultError`** on a tampered `ciphertext` (flip a byte) — AES-GCM auth tag must fail.
- `openP8` throws when the **AAD doesn't match** (decrypt with a different `user_id|app_id|keyId`) — proves cross-tenant replay protection.
- Two seals of the same `.p8` produce **different `iv` + `ciphertext`** (fresh IV per seal — no deterministic leak).
- **No error from the vault contains key material** — parameterized over plaintext/tamper/AAD-mismatch cases (strong assertion, mirrors the `AscCredError` key-free guarantee).
- `importKek` rejects a malformed base64 KEK with `AscVaultError`, not a raw Web Crypto error.

### Unit — `cloud/src/d1.ts` accessors (new cases in a `d1.ascKeys.spec.ts`, matching `d1.recordApproval.spec.ts` style)
- `putAscKey` then `getAscKey` returns the sealed row; `getAscKeyMeta` returns **metadata only** (assert `sealed`/ciphertext keys are **absent**).
- `deleteAscKey` removes it (`getAscKey` → null); `touchAscKeyUsed` updates `last_used_at`.
- Disconnecting the app (`deleteApp`) cascades to a null `getAscKey` (FK cascade test).

### Unit — `cloud/src/api/index.ts`
- `resolveAscCreds` precedence (parameterized): body-creds-present → ephemeral; stored-only → decrypted; neither → null. No literals unexplained.
- `serializeRunResult` / run views still **never** include any `asc_keys` field (extend the existing privacy-boundary leak test pattern around `ascContext`).

### E2E — `cloud/tests/e2e/ascKeyStorage.e2e.ts` (new, mirrors `flows.e2e.ts` + `helpers.ts`)
- Store key (mock Apple `GET /v1/apps` 200) → `GET .../asc/key` shows `hasStoredKey:true`, `keyId`, **no ciphertext** → `run-asc` with **no body p8** succeeds (uses stored) → `DELETE .../asc/key` → subsequent `run-asc` with no body p8 **400s** (ephemeral required again).
- Storing an **unverified** key (mock Apple 401) → route refuses, `getAscKey` → null.
- Owner isolation: user B cannot `GET`/`DELETE` user A's app key (404 via `requireOwnedApp`).

### Cron — `cloud/src/cron/scheduled.spec.ts` (extend existing)
- App with stored key + `ASC_KEK` set → sweep performs the ASC read (mock fetch) and the run trace reflects ASC-grounded `baseCopy`.
- App with stored key but **decrypt fails / read fails** → sweep degrades to iTunes-only and **still completes** the app (no thrown sweep).
- **Cron never pushes** assertion holds (no write call) regardless of stored key.

### Honesty regression
- Assert UI copy: when storing, the rendered panel does **not** contain "never stored" (guard against shipping a false custody claim).

---

## 6. Honesty & Security Considerations

This is the heart of the decision. Mapped to the product's three invariants:

1. **Never auto-push.** Untouched. `ascPushRoute` still requires `ASC_WRITE_ENABLED` + an `approved`/`shipped` run (`index.ts:1541-1549`) + an explicit human click. The cron still only *prepares* (`scheduled.ts:5,20`). A stored key **broadens read, never write authority** — pushing always needs a human at the keyboard.
2. **Never present unseen data as measured.** Cron ASC reads are real measurements and flow through the same `auditFindings({..., hasAscKey: true})` path (`index.ts:1000-1006`) and the same `ascContext` privacy boundary (`ascContext.ts`). On decrypt/read failure the sweep falls back to iTunes-only and the run is honestly `hasAscKey:false` — we never label inferred data as ASC-measured.
3. **Custody honesty.** The current UI promises "never stored." This feature **must not lie**: storage is opt-in, behind an explicit checkbox, and the copy changes to state plainly that the key is stored (encrypted) and how it's used. Default stays ephemeral.

**Security specifics:**
- **Envelope encryption**: per-key DEK wrapped by a Worker-held KEK (`ASC_KEK`). D1 holds only ciphertext + wrapped DEK; the KEK never touches D1. A D1 dump alone is useless without the Worker secret.
- **AAD tenant binding** (`user_id|app_id|keyId`) prevents replaying a stolen row under another tenant.
- **Non-extractable keys**: KEK and the per-mint signing key imported with `extractable=false` (as `ascJwt.ts:80` already does).
- **No key material in logs or errors** — `AscVaultError` is key-free by construction (mirrors `AscCredError`, `ascJwt.ts:16-21`).
- **Hard revocation**: `DELETE` shreds the row; app disconnect cascades. We tell users to also rotate/revoke the key in Apple's console (a stored ciphertext we deleted is gone, but the underlying Apple key still exists until they revoke it there — the UI must say so honestly).
- **Recommend least-privilege keys**: the storage UI should repeat the Option-1 guidance to mint a limited/read-only ASC role where possible, shrinking blast radius.
- **Blast radius (state it plainly for the decision):** ShipASO becomes custodian of customer Apple credentials. KEK compromise + D1 compromise together = full read/write of every opted-in customer's listing. This is a genuine, deliberate increase over today's zero-custody posture. The KEK must be treated as a tier-1 secret (rotation runbook required before GA).
- **KEK rotation** is supported by `SealedP8.v` versioning + a re-wrap pass (DEKs re-wrapped under a new KEK without re-encrypting payloads) — design for it now, implement the runbook before GA.

---

## 7. Risks & Rollout

| Risk | Mitigation |
|---|---|
| Custody breach blast radius | Envelope encryption, KEK as Worker secret never in D1, AAD binding, least-privilege key guidance, hard revoke. Owner accepts residual risk explicitly (§8). |
| Silent posture drift / accidental persistence on the ephemeral path | Storage is a **separate opt-in route**; ephemeral routes are refactored only to *read* a stored key, never to write one. Leak tests assert no key on traces/responses. |
| KEK loss → all stored keys unrecoverable | Acceptable + honest: users re-enter the key; document it. KEK backed up out-of-band (secret manager runbook). |
| Cron ASC read slows/fails the weekly sweep | Per-app isolation + iTunes-only fallback (existing pattern, `scheduled.ts:177`). |
| Honesty regression (UI still says "never stored" while storing) | Explicit UI copy test (§5). |
| ASC rate limits when cron reads many apps | Reuse single JWT per app; the read is already best-effort and degrades. Monitor; add backoff if needed. |

**Rollout (staged, flag-gated):**
1. Land vault module + tests, **no routes wired** (dead-safe).
2. Land D1 table + accessors + migration; deploy schema.
3. Wire storage routes behind a feature flag (`ASC_KEY_STORAGE_ENABLED`, mirroring `ASC_WRITE_ENABLED` at `index.ts:50-53`) — **default OFF**; set `ASC_KEK` secret. Internal dogfood on a test Apple key only.
4. Wire cron decrypt-on-use behind the same flag.
5. Frontend opt-in UI.
6. GA only after KEK-rotation runbook + a written threat-model doc (the issue's hard precondition) are committed.

---

## 8. Effort Estimate & Decision Required

**Effort: L (Large).** Not because any single piece is big (the vault module is ~120 LOC, routes are thin), but because it spans crypto, schema/migration, three refactored routes, the cron path, frontend, an unusually heavy security test surface, and **mandatory pre-GA artifacts** (threat model + KEK-rotation runbook). Breakdown: vault + tests (M), D1 + migration (S), API routes/refactor (M), cron (S), frontend (S), threat model + runbook docs (M).

**This needs an explicit product DECISION before any code, per the issue body.** The owner must affirmatively sign off on:
1. **Becoming custodian of customer Apple `.p8` keys** — accepting the increased breach blast radius this PRD describes in §6 (it explicitly overrides the standing "never-persist" rule).
2. **The encryption model** (Worker-held KEK envelope encryption in D1) — vs. a stronger alternative (e.g. Cloudflare Secrets Store / a dedicated KMS) the owner may prefer for tier-1 custody.
3. **GA preconditions**: that a written threat model + KEK-rotation runbook are blocking for GA (not optional).
4. **Honesty copy**: approving the shift from "never stored" to an explicit "stored, encrypted, opt-in, revocable" claim.

Until that sign-off, **only the launch-scope Option 1 (per-run acquisition polish) should ship**, and this PRD stays a design artifact. No `asc_keys` table, no KEK, no storage routes get merged pre-approval.

