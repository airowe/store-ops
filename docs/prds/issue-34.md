# PRD — Create a draft App Store version + push proposal (NEVER auto-build — live store write)

**Issue:** #34 · **Component:** `cloud` (Cloudflare Worker + D1 + Pages) · **Status:** Post-launch, deferred · **Owner decision required:** YES (see §8)

---

## 1. Problem & context

ShipASO can already read a live App Store listing with the ephemeral `.p8` (#30/#31), generate an improved proposal, gate it behind an explicit approval, and — when `ASC_WRITE_ENABLED` is on — **PATCH** the approved copy straight into the editable App Store version (#11). That write path is implemented end to end:

- `applyAscMetadata()` lists versions → `pickEditableVersion()` → lists localizations → `pickLocalization()` → `PATCH /appStoreVersionLocalizations/{id}` — `cloud/src/engine/ascWrite.ts:217-259`.
- `ascPushRoute()` (`POST /runs/:id/asc/push`) mints the JWT, resolves the app id, and calls `applyAscMetadata` — `cloud/src/api/index.ts:1535-1578`.
- The approval-moment UI (`ascPushCta`) and the advanced `ascVerifyPanel` collect the `.p8`/keyId/issuerId and POST them — `cloud/public/app.js:2016-2106`.

**The gap:** Apple only lets you edit metadata on an *editable* (draft) version. `pickEditableVersion()` (`cloud/src/engine/ascWrite.ts:89-100`) hard-throws when the app has **no** version in an editable state:

```ts
throw new AscWriteError(
  "No editable App Store version found. Create a new version in App Store Connect " +
  "(state PREPARE_FOR_SUBMISSION) before pushing metadata.",
);
```

So for the common case — an app whose only version is `READY_FOR_SALE` (already on the store) — the push **fails with a dead end**. The user must leave ShipASO, open App Store Connect, manually click "+ Version", type a version string, save, and come back. This is exactly what **blocked the Heathen pass** (per the issue). The read path already handles this gracefully via `pickReadableVersion()` (falls back to any version, `cloud/src/engine/ascWrite.ts:109-119`) — but writing has nowhere to land.

**Why it matters:** The whole product promise is "the loop that ships your metadata." Today the loop stops one click short of shipping whenever there's no open draft — which is most of the time for a published app. Closing this makes ShipASO able to take a `READY_FOR_SALE` app from proposal to a saved draft without the user ever opening App Store Connect.

---

## 2. Goal & non-goals

### Goal
From an **approved** run, when the app has no editable version, let the user **explicitly** create a draft `appStoreVersion` (state `PREPARE_FOR_SUBMISSION`) via the ephemeral `.p8`, then push the approved proposal into it (reusing `applyAscMetadata`). Both actions are outward live-store writes and require **per-action approval with a reviewable diff**. Surface ASC errors (version-number conflicts, permission) honestly.

### Non-goals
- **NO build upload, NO `appStoreVersion`→build association, NO submission to review.** "NEVER auto-build." We create *metadata* draft only; the user submits to review themselves.
- No persisting the `.p8` or any Apple credential (carry-over constraint).
- No auto-creation and no auto-push — the agent never initiates an outward write; every write is a discrete human click.
- No changes to the credential-free Fastlane handoff (`cloud/public/app.js:1962-1980`) — it stays the recommended default.
- No new version-number *generation* intelligence beyond a safe default + user override (auto-bumping semver is out of scope; see §8 decision).
- No multi-platform fan-out — scope to the run's platform (iOS); structure the code so adding MAC_OS/TV_OS later is a parameter, not a rewrite.

---

## 3. Proposed approach (grounded in real files)

The shape mirrors the existing write path exactly: **pure builders + thin HTTP glue + a gated route + an explicit approval CTA.**

### 3.1 Engine: a version-create builder + orchestrator (`ascWrite.ts`)

`applyAscMetadata` already proves the pattern (pure builder `buildLocalizationPatch` + orchestrator `applyAscMetadata`). Add the symmetric pair:

- **`buildVersionCreateBody(appId, versionString, platform)`** — pure, returns the JSON:API POST body:
  ```ts
  { data: { type: "appStoreVersions",
    attributes: { platform: "IOS", versionString: "1.2.3" },
    relationships: { app: { data: { type: "apps", id: appId } } } } }
  ```
  No new version is born in PREPARE_FOR_SUBMISSION by an attribute — ASC assigns that state on creation. Validate `versionString` matches `^\d+(\.\d+){0,2}$` and throw `AscWriteError` otherwise (honest, pre-flight, no network).

- **`createAscDraftVersion(fetchFn, { token, appId, versionString, platform })`** — thin orchestrator that:
  1. (defensive) lists versions and, if an editable one already exists, throws a *specific* `AscWriteError` ("a draft already exists — push to it instead") so we never create a duplicate draft. Reuse the `EDITABLE_STATES`/`pickEditableVersion` predicate (`ascWrite.ts:24-30, 89-100`) — extract the find-predicate into a small `hasEditableVersion(versions)` helper so both call sites share it.
  2. `POST ${ASC_BASE}/appStoreVersions` with the built body and `Authorization: Bearer <token>`.
  3. On non-OK, throw via the existing `ascError(res, "create app store version")` (`ascWrite.ts:735-745`) — which already strips the token and surfaces Apple's `errors[0].detail`, so a version-number conflict (`409`/`"The version number ... has already been used"`) reaches the user verbatim and honestly.
  4. Return `{ ok: true, versionId, versionString, appStoreState }`.

This reuses `ASC_BASE`, `FetchLike`, `AscWriteError`, and `ascError` unchanged.

### 3.2 Engine: derive the default version string

The default draft version string should come from real data, never invented. Use `readAscVersionState()` (`ascWrite.ts:340-368`) which already returns `current.versionString` + `all[]`. Add a pure `suggestNextVersionString(state: AscVersionStateResult): string` that bumps the patch segment of the highest existing `versionString` (e.g. `1.4.0` → `1.4.1`), falling back to `1.0` when there are none. The UI shows this **as an editable, pre-filled suggestion** — labeled "suggested", never "required" — so we never present a guessed number as authoritative.

### 3.3 API: a new gated route (`api/index.ts`)

Add **`ascCreateVersionRoute(req, env, userId, runId)`** modeled byte-for-byte on `ascPushRoute` (`api/index.ts:1535-1578`):

- Gate behind the same `isFlagOn(env.ASC_WRITE_ENABLED)` (`api/index.ts:1541-1543, 1580-1583`) → 403 when off.
- `getRun` → `requireOwnedApp` → assert `run.status` is `approved`/`shipped` (same guard as push, `api/index.ts:1547-1549`). Creating a version is an outward write, so it must sit behind approval just like the push.
- Parse `{ p8, keyId, issuerId, versionString?, platform? }`; require the three creds (`api/index.ts:1552-1554`).
- `mintAscJwt` (`ascJwt.ts:65`) — the *only* place the `.p8` is touched; never persisted, never logged, key-free errors.
- `findAscAppId(fetch, token, app.bundle_id)` (`ascWrite.ts:196-215`) then `createAscDraftVersion(...)`, defaulting `versionString` to `suggestNextVersionString(await readAscVersionState(...))` when the body omits it and `platform` to `"IOS"`.
- Catch `AscWriteError` → `{ ok: false, reason }`; rethrow anything else (matches `ascPushRoute:1574-1577`).

Wire it in the router next to the existing asc routes (`api/index.ts:1929-1934`):
```ts
if (seg.length === 4 && seg[2] === "asc" && seg[3] === "create-version" && method === "POST") {
  return json(await ascCreateVersionRoute(req, env, user.id, runId), 200, origin);
}
```

**Optional convenience (decision-gated, §8):** a `?then=push` query or a combined `asc/create-and-push` that creates then immediately calls `applyAscMetadata`. Default recommendation: keep them as **two discrete approved clicks** (create, then the existing push) so each live write is independently consented — more honest, simpler to reason about, matches "per-action approval."

### 3.4 UI: an explicit "create draft version" action with a reviewable summary (`app.js`)

In the gate handoff, the push CTA (`ascPushCta`, `app.js:2016-2045`) is shown after approval (`app.js:1931`). Add a sibling **`ascCreateVersionCta(runId, run, R)`** rendered *above* the push CTA when the run's `ascContext.versionState` (`ascContext.ts:30-31`, surfaced to the client at `api/index.ts:268`) is **not** an editable state — i.e. there's no draft to push into. It must show:

- A short honest explainer: "Your live version is `READY_FOR_SALE`. Pushing edits needs a draft. ShipASO can create one (state PREPARE_FOR_SUBMISSION) — this writes to your live App Store Connect account."
- A **version-string input pre-filled** with the server's suggested next string, labeled "suggested — edit if your release plan differs."
- The same ephemeral `.p8`/keyId/issuerId inputs, reusing `ascCredsMemory` (`app.js:62-67, 2028-2033`) and `p8FileInput` (`app.js:874-895`) so the user doesn't re-type within a session.
- A `var(--warn)` "This writes to your live App Store version" notice (mirroring `app.js:2040-2043`).
- On success, replace the CTA with a confirmation that states **exactly what happened** ("Created draft version 1.4.1 (PREPARE_FOR_SUBMISSION)") and *then* reveal/enable the existing push CTA pointed at the new draft. Never claim the metadata was pushed by the create step.

Add `createAscVersion(runId, creds, versionString, btn, status)` mirroring `pushAsc` (`app.js:2077-2106`): same `API_BASE && liveMode` guard, same 403 handling, same honest success/failure rendering off `out.ok`/`out.reason`.

---

## 4. Exact files to change + new files

**Changed:**
- `cloud/src/engine/ascWrite.ts` — add `buildVersionCreateBody`, `createAscDraftVersion`, `suggestNextVersionString`, `hasEditableVersion` (extracted predicate). Export a `CreateVersionResult` type. No change to existing exports.
- `cloud/src/api/index.ts` — add `ascCreateVersionRoute` (near `ascPushRoute` ~1535); register the `asc/create-version` route (~1929-1934); import the new engine fns.
- `cloud/public/app.js` — add `ascCreateVersionCta` + `createAscVersion`; render the CTA conditionally in the gate handoff (~1931); branch on editable-version state.
- `cloud/public/styles.css` — reuse `.asc-cta` / `.handoff` classes; add only if a new visual state is needed.
- `cloud/wrangler.toml` — no new flag (reuse `ASC_WRITE_ENABLED`); confirm it's documented in `cloud/DEPLOY.md`.

**New:**
- None strictly required — new fns colocate in `ascWrite.ts`. Tests are colocated `*.spec.ts` per repo convention (`ascWrite.spec.ts` already exists).

**New E2E (if a flow file is added):** extend `cloud/tests/e2e/flows.e2e.ts` rather than a new file unless the flow is large.

---

## 5. Test plan (TDD, `*.spec.ts`, strong assertions)

Follow the repo's scaffold-stub → failing-test → implement loop. All unit tests are pure/network-free using the existing `json()` Response helper and a stubbed `FetchLike` (pattern: `ascWrite.spec.ts:1-22`).

### Unit — `cloud/src/engine/ascWrite.spec.ts` (extend)
- **`buildVersionCreateBody`**: produces `type: "appStoreVersions"`, `attributes.platform`/`versionString`, and the `app` relationship with the given id. Parameterize platform over `["IOS","MAC_OS","TV_OS"]`.
- **`buildVersionCreateBody` validation**: throws `AscWriteError` on `""`, `"1.2.3.4"`, `"v1"`, `"1..2"`; accepts `1`, `1.0`, `1.2.3`.
- **`suggestNextVersionString`**: `[1.4.0]`→`1.4.1`; `[1.4.0, 1.4.1]`→`1.4.2`; `[]`→`1.0`; non-semver current → safe `1.0` fallback. Strong equality assertions, no literals unexplained.
- **`hasEditableVersion`**: true for each `EDITABLE_STATES`, false for `READY_FOR_SALE`/`IN_REVIEW`/`[]`.
- **`createAscDraftVersion` happy path**: stub fetch returns `{data:{id:"v9", attributes:{appStoreState:"PREPARE_FOR_SUBMISSION", versionString:"1.4.1"}}}` → result `{ok:true, versionId:"v9", versionString:"1.4.1", appStoreState:"PREPARE_FOR_SUBMISSION"}`. Assert the POST URL is `${ASC_BASE}/appStoreVersions`, method `POST`, `Authorization: Bearer <token>` header present, body equals `buildVersionCreateBody(...)`.
- **`createAscDraftVersion` duplicate guard**: when a versions-list pre-check returns an editable version, throws `AscWriteError` ("draft already exists") and **never** issues the POST (assert fetch call count).
- **`createAscDraftVersion` conflict surfacing**: fetch returns `409` with `{errors:[{detail:"The version number 1.4.1 has already been used."}]}` → throws `AscWriteError` whose message contains the Apple detail **and does not contain the token** (negative assertion on the bearer string — mirrors the existing token-free error posture).
- **`createAscDraftVersion` auth failure**: `403` → `AscWriteError` mentioning the step, token-free.

### Unit — JWT/security (already covered)
Re-assert in a focused test that the create route's error messages and results never include `p8`/token (the `ascJwt.ts` posture is already covered by `ascJwt.spec.ts`; add one assertion that `createAscDraftVersion` never receives or echoes the raw key).

### Integration / API — (where API route tests live; `runSerialize.spec.ts` / `runConfig.spec.ts` show the pattern)
- `ascCreateVersionRoute` returns **403** when `ASC_WRITE_ENABLED` is unset/false.
- Returns **403** when the run is not `approved`/`shipped`.
- Returns **400** when creds are missing.
- Returns **404** for an unknown run / non-owned app (via `requireOwnedApp`).
- Happy path returns the engine result; an `AscWriteError` (e.g. conflict) returns `{ok:false, reason}` with HTTP 200 (matches `ascPushRoute`).

### E2E — `cloud/tests/e2e/flows.e2e.ts` (Playwright, mock mode)
- After approving a run whose `ascContext.versionState` is `READY_FOR_SALE`, the **create-draft CTA renders** (and the push CTA is gated/secondary until a draft exists).
- The version input is pre-filled with the suggestion and is editable.
- Clicking with empty creds shows the inline validation, not a network call.
- On a stubbed success, the confirmation states the created version string + state, and the push CTA becomes available. Assert the success copy never claims metadata was pushed by the create step (honesty assertion).

---

## 6. Honesty & security considerations

- **Never present unseen data as measured.** The suggested version string is derived from `readAscVersionState` (real ASC data) and labeled "suggested." If ASC is unreadable, default to `1.0` and say so — never imply we read a number we didn't.
- **The agent NEVER auto-creates or auto-pushes.** Both the create and the push are discrete, post-approval, human-clicked actions gated by `ASC_WRITE_ENABLED` *and* run approval. The scheduled agent (`cron/scheduled.ts`) must not call either route.
- **`.p8` is ephemeral.** It is parsed/used only inside `mintAscJwt` (`ascJwt.ts`), passed in-request, never written to D1, never logged, never in an error (`ascJwt.ts:1-12`). The create route inherits this exactly from `ascPushRoute`. Add a test asserting the new path persists nothing.
- **Per-action approval with a reviewable diff.** The create CTA shows what will be written (a draft version of string X, state PREPARE_FOR_SUBMISSION); the subsequent push reuses the existing diff (`diffCard`, `app.js:985`). Two consents for two live writes.
- **Honest ASC errors.** Version-number conflicts, permission errors, and "draft already exists" all surface verbatim via `ascError` (`ascWrite.ts:735-745`), token-free. No silent retries, no swallowing.
- **No build, ever.** We create only the metadata version. The route and copy explicitly do not associate a build or submit to review — the irreversible "ship to Apple review" remains the user's manual step.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| Duplicate-draft creation if a draft already exists | Pre-check `hasEditableVersion` and refuse with a clear "push to the existing draft instead" message; covered by a unit test asserting no POST fires. |
| Wrong/duplicate version number → 409 | Surface Apple's detail verbatim; user edits the pre-filled string and retries. No auto-retry. |
| User assumes "create draft" submitted to review | Copy explicitly says PREPARE_FOR_SUBMISSION + "you submit to review yourself"; honesty E2E assertion. |
| Live-account write blast radius | Gate behind `ASC_WRITE_ENABLED` (off by default) + approval + explicit click; ship to a single dogfood account (Heathen) first. |
| Platform mismatch (multi-platform apps) | Scope to IOS for v1; `platform` is a parameter, default IOS, documented as a follow-up. |

**Rollout:** Behind existing `ASC_WRITE_ENABLED` (no new flag). Enable for the owner's account, run the Heathen pass it originally blocked (create draft → push → manually submit), confirm the draft appears in ASC, then leave the flag owner-controlled until broadly enabled.

---

## 8. Effort & decision

**Effort: M.** The engine builder + orchestrator and the gated route are small and pattern-matched to existing code (`applyAscMetadata`/`ascPushRoute`). The weight is in the UI flow (conditional CTA, version-string UX, honest confirmations) and a careful TDD pass on a live-store write. No new infra, no schema change, no new credential.

**Needs a product DECISION from the owner before building — YES, two points:**

1. **Two clicks vs one.** Keep "create draft" and "push" as two separately-approved live writes (recommended — most honest, each outward write independently consented), **or** offer a single "create draft and push" convenience action (less friction, but bundles two live writes behind one consent). This shapes the route surface (`asc/create-version` only vs an additional `asc/create-and-push`).
2. **Default version string policy.** Confirm the auto-suggest rule (patch-bump the highest existing string, fallback `1.0`) and that it is always presented as an editable suggestion. If the owner wants no suggestion at all (force the user to type it), the `suggestNextVersionString` helper and its `readAscVersionState` call are dropped.

Recommendation: ship **two discrete approved clicks** with an **editable, pre-filled suggested version string**.

