# Phase 3 — Credential flows PRD (ShipASO mobile)

Parent: `00-implementation-plan.md`. Depends on: Phase 2. **Security-sensitive.**

## Objective
Let an owner run the credentialed passes from the phone — App Store Connect
read-and-improve (`.p8`) and Google Play own-app audit (service-account JSON) —
upholding the web's exact contract: the credential is **used once and never
stored on device** (only the session token is persisted).

## Scope
- **In:** a reusable `CredentialSheet` (paste OR document-picker), ASC run
  trigger, Play verify + Play own-app audit, honest result rendering, in-memory
  (session-only) reuse at most.
- **Out:** any persistence of credentials; direct store push (server stays
  read/handoff-only).

## Files
- `mobile/src/components/CredentialSheet.tsx` (variants: `asc` | `play`)
- `mobile/app/(app)/apps/[id].tsx` (mount the ASC + Play panels, parallel to web)
- `mobile/src/api/endpoints.ts` (+ `runAsc`, `verifyPlay`, `auditPlay`)
- `mobile/src/lib/credentials.ts` (read file → string; **no persistence**)
- tests: `CredentialSheet.test.tsx`, `credentials.neverPersisted.test.ts`,
  `playAudit.test.tsx`

## Contracts / reuse
- `POST /apps/:id/run-asc { p8, keyId, issuerId, locale? }` → ASC read-and-improve
  run (routes to a run detail). `.p8` used once.
- `POST /play/verify { serviceAccount, packageName? }` → `{ ok, reason?, appAccessible? }`.
- `POST /apps/:id/audit-play { serviceAccount, packageName, language?, targets?, brand? }`
  → `PlayAudit` (listing w/ short description, `reliable:true`, no locks).
- Server already enforces read-only (Play never commits), `token_uri` SSRF guard,
  key never leaves the Worker, key-free errors.

## Acceptance criteria
- Credential entered via paste or `expo-document-picker` (`.p8` / `.json`); read
  into a component-local var via `expo-file-system`; sent once over HTTPS Bearer.
- **The credential is NEVER written** to `expo-secure-store`, AsyncStorage, files,
  logs, or analytics. At most kept in memory for the session; dropped on navigate.
- ASC run lands on the resulting run detail (subtitle/keywords improved).
- Play verify shows `{ok}`/reason; Play audit renders the connected-tier audit
  (short description present, `reliable:true`, no capability locks).
- Honest errors surfaced verbatim (key-free) from the server.

## Tests
- `credentials.neverPersisted.test.ts` — spies on SecureStore/FileSystem/AsyncStorage
  assert the credential value is never passed to any persistence API (the binding
  security invariant).
- `CredentialSheet.test.tsx` — paste + picker fill the in-memory value; validation
  (missing fields) blocks submit.
- `playAudit.test.tsx` — renders the audit; verify ok/err paths.

## Dependencies / external gates
- None server-side (routes shipped in PRs #117–#121). Device: document-picker +
  file-system permissions.

## Definition of done
Owner can run ASC + Play credentialed audits from the phone; the
never-persisted invariant is test-enforced; nothing pushes to a live store.
