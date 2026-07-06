# Stored credentials — threat model + encryption design (#67 post-launch half)

Status: **approved by owner** (2026-07-04, "offering an option to store their
credentials"). This document is the threat-model/design gate the issue
required before any code. It deliberately OVERRIDES the launch rule ".p8 is
never persisted" — for users who OPT IN, and only server-side. The default
remains per-run ephemeral; the mobile app's never-persist-on-device invariant
is untouched.

## What this buys the user (why custody is worth its risk)

1. **No re-typing** — connect once, run keyed audits with one click.
2. **Autonomous keyed sweeps** — the cron can run the FULL read-and-improve
   loop (subtitle/keywords proposals) on schedule, not just the public audit.
   This is the product's core loop finally running unattended end-to-end
   (still approval-gated — the cron prepares, never pushes).

Peers normalize this custody model (RevenueCat, Appcircle, CI systems all
store customer ASC keys); the differentiator is doing it with our honesty
discipline: opt-in, write-only, revocable, and documented.

## In transit (unchanged surface, stated for completeness)

- Browser → Cloudflare edge: TLS (1.3 at the edge); credential rides the
  request BODY only — never URLs (never in logs/referrers), same as today's
  per-run flow.
- Worker → Apple / Google: HTTPS to `api.appstoreconnect.apple.com` /
  `androidpublisher.googleapis.com`, as today.
- No app-layer crypto on top of TLS (industry standard); the new surface this
  feature adds is entirely AT REST.

## At rest — envelope encryption (AES-256-GCM, KEK/DEK)

```
plaintext (.p8 / service-account JSON)
  └─ encrypted with DEK: AES-256-GCM, random 96-bit IV, AAD = context
        DEK: fresh random 256-bit key, used for EXACTLY ONE credential version
  └─ DEK wrapped by KEK: AES-256-GCM, its own random IV, SAME AAD
        KEK: 256-bit key in the Worker secret CRED_KEK_V1 (wrangler secret put)
stored in D1 (stored_credentials row): ciphertext, iv, wrapped_dek, dek_iv,
  kek_version, context columns · the KEK is NEVER in D1, code, or the repo
```

Design rules, each mapped to the research:

- **One DEK per credential version** → nonce reuse under a DEK is
  structurally impossible (one encryption per key, ever). Replacing a
  credential mints a fresh DEK. (GCM nonce-reuse is catastrophic; we remove
  the class rather than manage it.)
- **AAD binding** (`v1|user_id|app_id|kind|kek_version`) on BOTH layers → a
  ciphertext or wrapped DEK moved to another row/tenant fails authentication.
  (AWS Encryption SDK pattern.)
- **Separation of stores** (OWASP KM): D1 holds ciphertext; the KEK lives in
  a Worker secret (write-only, separate system). Either alone is useless.
- **Single-purpose keys** (NIST via OWASP): the KEK wraps DEKs and does
  nothing else; it is NOT `SESSION_SECRET` (HMAC signing) and never will be.
- **Key hierarchy + rotation**: rows carry `kek_version`. Rotation = set
  `CRED_KEK_V2`, deploy, then LAZY re-wrap (on each successful use, if the
  row's version < current, re-wrap the DEK under the new KEK and bump the
  version — data is never bulk-decrypted). Old secret is deleted once
  `SELECT COUNT(*) WHERE kek_version < N` hits zero. Only the DEK is ever
  re-wrapped; payload ciphertext is untouched by rotation.
- **Memory hygiene**: plaintext exists only as a local inside the request
  that uses it (JWT minting / Play token exchange); never logged, never in an
  error message, never in a response body, never cached. Workers' isolate
  model keeps no long-lived process memory.

## Write-only custody (the headline invariant)

The API can **save, replace, delete, and USE** a stored credential. It can
NEVER return one — no route reads plaintext (or ciphertext) back to any
client, ever. List endpoints return metadata only: key id, issuer id (both
non-secret identifiers), created/last-used timestamps, kek_version. A test
pins that the list/UI payloads never contain key material — the same
enforcement style as the mobile `credentials.neverPersisted` suite.

## Threat model

| Threat | Outcome | Mitigation |
|---|---|---|
| D1 dump / SQL injection reads table | Ciphertext + wrapped DEKs only | KEK absent from D1; AAD stops cross-row splicing; D1 itself AES-256 at rest underneath (defense in depth) |
| Worker secret (KEK) leaks alone | No data to decrypt | Ciphertext lives only in D1 |
| Both leak (full Worker compromise) | Credentials decryptable | Blast-radius controls: limited-role keys pushed in the UI (Developer, not Admin — the #67 launch-half guide), per-user revoke UX, `last_used_at` visibility, Apple-side revoke is immediate + permanent |
| Ciphertext transplanted between rows/tenants | Decrypt fails | AAD binds user/app/kind/version into the auth tag |
| Credential echoed to a client (bug/XSS) | — | Write-only custody, pinned by tests; plaintext never serialized |
| Credential in logs/errors | — | No body logging (existing posture); error paths tested to carry no key material |
| Stale custody ("I forgot I stored it") | — | Stored-credentials panel lists metadata + last-used; delete is one click and immediate; honest copy: deleting here does NOT revoke at Apple — link to the ASC revoke screen |

## Honest UX rules

- **Opt-in, per credential**: an unchecked-by-default "Save this key for
  scheduled runs" checkbox at the existing credential panels. Unchecked =
  today's behavior, byte-for-byte.
- The consent copy states custody plainly: *"Stored encrypted on our servers
  (envelope encryption; write-only — it can be used and deleted, never
  viewed). Enables scheduled keyed runs. Delete anytime; to kill the key
  itself, revoke it in App Store Connect."*
- Feature availability is honest: if `CRED_KEK_V1` is unset on a deployment,
  the checkbox does not render (no dead toggle) and the API 503s with the
  reason.
- Deleting the stored credential never claims to revoke the key at Apple.

## Phases

1. **[Phase 1 — crypto core + store + API + web opt-in](phase-1-store.md)**:
   `credentialVault.ts` (envelope crypto, pure over WebCrypto),
   `stored_credentials` table, save/list/delete routes, the opt-in checkbox
   on the ASC panel, keyed runs use the stored key when present ("Run with
   saved key" button).
2. **Phase 2 — autonomous keyed sweeps** ✅ SHIPPED: the cron uses a stored ASC
   key to run the full keyed read-and-improve pass on schedule (via the shared
   `keyedAscPass`), still approval-gated — a stored-key read failure degrades to
   the public pass, never stranding the sweep. Play service-account save/use
   parity on the audit route. Mobile management UI (`StoredKeysCard`). The
   stored plaintext is a transient in the sweep, never persisted onto the run.

### KEK rotation runbook
1. `wrangler secret put CRED_KEK_V2` (fresh base64 32 bytes).
2. Deploy. New saves seal under v2; existing rows lazily re-wrap on their next
   USE (`useCredential` re-wraps when `row.kek_version < current`).
3. Force-drain if needed: any authenticated read of each stored credential
   rotates it. Check progress: `SELECT kek_version, COUNT(*) FROM
   stored_credentials GROUP BY kek_version`.
4. Once no rows remain on v1, `wrangler secret delete CRED_KEK_V1`.

## Out of scope

- Client-side/device storage of credentials (mobile invariant unchanged).
- Cross-tenant key escrow, BYO-KMS, HSMs — Workers has no HSM; the design
  keeps a KMS-shaped seam (kek_version + wrap/unwrap module) if that ever
  changes.
