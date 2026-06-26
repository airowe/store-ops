# PRD — Issue #61: Locked-field upgrade surface

**Title:** Pattern: locked-field upgrade surface — every field we can't audit becomes an honest "unlock to see + improve" lock

**Status:** Draft for owner review · Post-launch · Depends on #60 (closed/shipped)
**Author:** Product Engineering · **Effort:** M · **Needs product DECISION before build:** Yes (see §8)

---

## 1. Problem & context

On a no-key run (the most common first-time path — #56/#57), ShipASO can read only what the public iTunes API exposes (app name, public-thumbnail screenshots), and is blind to the App Store Connect-only surfaces: the live **subtitle**, the **keyword field**, the **real screenshot grade**, **app preview video**, **privacy policy / category**, and **per-locale keyword surfaces**.

Today the product handles this blindness in **two disconnected ways**, and neither one surfaces the lock *where the user is looking*:

1. **One generic CTA card.** The `asc_unlock` finding (`cloud/src/engine/auditFindings.ts:629-642`) renders as a single bordered "Unlock your full audit" card below the findings list, built by `ascUnlockCta()` (`cloud/public/app.js:1053-1069`) from a static `UNLOCK_SURFACES` array (`cloud/public/app.js:1042-1047`). It is one lump at the bottom; it does not tell the user *which field* is gated *where*.
2. **The coverage card already does the right thing — but only there.** Per #60, the metadata-coverage field breakdown (`coverageFieldBreakdown()`, `cloud/public/app.js:1239-1275`) renders subtitle & keywords as an honest **"unseen"** tag with a hollow dashed bar (`.cov-bar.unseen` / `.cov-field-val.unseen`, `cloud/public/styles.css:786,790`) instead of a false `0/30`. The engine backs this with the `seen` flag on `FieldFill` (`cloud/src/engine/metadataCoverage.ts:47-57,157-164`), which is `false` when a field's input was `undefined` (never read) vs `""` (read-and-empty).

The owner's insight (#61): **#60's coverage card is the first instance of a general pattern.** Every blind spot should render as an honest inline 🔒 **lock** on its own field/section, where upgrading (connecting ASC) is the thing that removes the lock — turning each audit blind-spot into its own, in-context upgrade reason. The paywall and the value prop become the same surface.

**Why it matters:** the no-key run's biggest weakness (limited visibility) becomes its clearest, most honest upsell — consistent on every gated surface instead of one generic catch-all. It also fixes a residual UX gap: a user reading the screenshot section or a (future) preview/privacy section on a no-key run gets no inline signal that those readings are *unavailable, not bad*.

---

## 2. Goal & non-goals

### Goal
A reusable **locked-field pattern**: a small presentational primitive (`fieldLock()`) plus a per-surface data contract (`locks[]` on the run result) so that, on a no-key run, each unreadable surface renders an inline, honest 🔒 lock that:
- States **"we can't see this without access"** (capability gap), never a deficiency.
- Frames **opportunity** ("connect to read + improve"), never diagnosis or urgency.
- Routes to the **existing** primary ASC run panel (`go("#/apps/:id?asc=1")`, the same target as `ascUnlockCta`, `cloud/public/app.js:1055-1057`) — no new credential surface.
- Is visually and semantically **distinct** from the existing approval-gate lock (`commandsLocked()`, `cloud/public/app.js:1955-1957`), which gates an *action*, not a *reading*.

### Non-goals
- **Not** removing the existing `asc_unlock` summary CTA in this PRD's first slice — the coverage card and a single bottom CTA can coexist; the bottom CTA may be slimmed once enough inline locks exist (a later decision, §7).
- **Not** locking public/readable fields for *reading*. App name and public screenshots are read on every run; any lock there would be on the AI **optimization action**, copy-distinguished — out of scope for slice 1.
- **Not** new ASC reads, new endpoints, or any change to the credential/`.p8` flow.
- **Not** building every per-surface lock at once. Ship the **pattern + 1–2 instances**, then roll out per-surface (the issue's own staging).

---

## 3. Proposed approach (grounded in real files)

The pattern has two halves: a **data contract** (engine decides what is unseen) and a **presentational primitive** (UI renders the lock identically everywhere). This mirrors how #60 already split `seen`-flag computation (engine) from `cov-field-val unseen` rendering (UI).

### 3a. Data contract — `result.locks[]`

Today the no-key vs keyed distinction is implicit: `isNoKeyRun(R)` in the UI (`cloud/public/app.js:1143-1147`) infers it from "has `asc_unlock` finding AND no `ascContext`", and the coverage `seen` flags are computed independently in the engine. Per #61 we make the blind-spots **explicit and engine-owned**, so the UI never re-derives "is this surface readable."

Add a pure helper alongside `auditFindings` (same file, same network-free contract, `cloud/src/engine/auditFindings.ts`):

```ts
export type SurfaceLock = {
  surface: "subtitle" | "keywords" | "screenshots" | "previews"
    | "privacy" | "category" | "locales";
  /** honest one-liner: "we can't SEE this without access" — never a deficiency */
  label: string;
  /** opportunity framing behind the lock: "unlock to read + improve" */
  unlockCopy: string;
};

/** Surfaces a run could NOT read. Empty on a keyed run. Pure + deterministic. */
export function surfaceLocks(input: AuditFindingsInput): SurfaceLock[];
```

`surfaceLocks` returns `[]` when `input.hasAscKey === true`, and otherwise the canonical no-key blind-spot list (subtitle, keywords, screenshots, previews, privacy, category, locales) with honest copy. It reuses the exact `hasAscKey` boolean already threaded into both run paths (`cloud/src/api/index.ts:886` no-key, `:1005` keyed). This is the same single source of truth `asc_unlock` already keys off — no new signal invented.

In the API, attach it next to the existing `result.findings` / `result.coverage` assignments in **both** run composition paths:
- No-key path `runApp` — after `result.coverage = coverageForRun(...)` at `cloud/src/api/index.ts:894`.
- Keyed path `runAppWithAsc` — after `cloud/src/api/index.ts:1015` (returns `[]`, keeping the serializer symmetric).

This is the same privacy boundary the code already documents (`cloud/src/api/index.ts:996-1000`): only curated findings/coverage/locks cross to the client; the raw ASC snapshot stays server-side.

### 3b. Presentational primitive — `fieldLock()`

Add one renderer in `cloud/public/app.js` near `ascUnlockCta` (`:1053`) and the existing `commandsLocked()` (`:1955`):

```js
// An inline, honest 🔒 lock for a surface we couldn't READ on a no-key run.
// "We can't see this without access" — never a deficiency, never urgency.
// Routes to the SAME primary ASC run panel as the unlock CTA (no new surface).
function fieldLock(lock, appId) { /* returns a .field-lock node */ }
```

It renders the 🔒 glyph, `lock.label`, `lock.unlockCopy`, and a single "Connect to unlock →" link wired to `go("#/apps/" + appId + "?asc=1")` — reusing the existing flash-on-arrival behavior (`viewApp` honors `?asc=1`, `cloud/public/app.js:636-641`). It must NOT reuse the `.locked`/`commandsLocked` class (that lock means "approve to reveal a generated push command" — an action gate, `cloud/public/app.js:1955-1957`); a new `.field-lock` class keeps the two semantics visually distinct per the issue's "clearly distinguished" rule.

### 3c. First instances (slice 1)

1. **Coverage card subtitle/keywords (already partly done — formalize it):** the `unseen` rows in `coverageFieldBreakdown` (`cloud/public/app.js:1261-1262`) gain the 🔒 affordance + inline "Connect to unlock" link, so the existing "unseen" tag *also* reads as the upgrade lever, consistent with the new pattern. This is the lowest-risk instance because #60 already proved the honesty model here.
2. **Screenshot section:** today the no-key "couldn't read screenshots" case produces the `screenshots_unknown` finding (`cloud/src/engine/auditFindings.ts:237-245`) and the gallery returns `null` for the `?` grade (`screenshotGallery`, `cloud/public/app.js:1106-1111`), leaving an unexplained gap. Render a `fieldLock({surface:"screenshots"})` in that empty slot so the "?" grade reads as **locked-not-bad** next to `gradeChip`'s neutral "Shots: ?" (`cloud/public/app.js:1035-1037`).

Remaining surfaces (previews, privacy, category, locales) roll out per-surface in follow-ups once slice 1 ships, exactly as the issue stages it.

---

## 4. Exact files to change + new files

### Engine (data contract)
- **`cloud/src/engine/auditFindings.ts`** — add `SurfaceLock` type + `surfaceLocks(input)` pure function. Keep the same deterministic, network-free constraints documented at the top of the file (`:10-17`). Honest copy lives here (the catalog), not in the UI.
- **`cloud/src/engine/auditFindings.spec.ts`** — new `describe("surfaceLocks")` block (see §5).

### API (wiring, both run paths)
- **`cloud/src/api/index.ts`** — `import { surfaceLocks }` (extend the existing import at `:139`); set `result.locks = surfaceLocks({...})` after `:894` (no-key) and after `:1015` (keyed → `[]`). If runs are serialized through a whitelist, add `locks` there (verify against the run-serialize path — `cloud/src/engine/runSerialize.ts` / `runSerialize.spec.ts` exist; add a field assertion there if it whitelists).

### UI (presentational primitive + instances)
- **`cloud/public/app.js`** — add `fieldLock(lock, appId)`; render the screenshot-section lock in `listingAuditCard` near the gallery (`:1202-1203`); add the 🔒 affordance + unlock link to the `unseen` rows in `coverageFieldBreakdown` (`:1261-1262`). Read locks from `R.locks` (fall back gracefully to `isNoKeyRun(R)` for older stored runs, mirroring the `fieldFill` legacy fallback at `:1241-1248`).
- **`cloud/public/styles.css`** — add `.field-lock` (and `.field-lock-ico`, `.field-lock-link`) styled distinctly from `.asc-unlock` (`:444-457`) and `.locked` (the action gate). Reuse the existing dashed/`--signal` visual language so it reads as the same family as the coverage `unseen` bar (`:786-791`).
- **`cloud/public/mock.js`** — ensure the mock run payload carries `locks` for no-key runs (the E2E suite drives everything through `STORE_OPS_MOCK.handle`, e.g. `cloud/tests/e2e/flows.e2e.ts:751-755`), so the new E2E assertions have data.

### Tests
- **`cloud/src/engine/auditFindings.spec.ts`** (unit, above).
- **`cloud/tests/e2e/flows.e2e.ts`** — extend the existing `"run page — ASC unlock CTA on a no-key run"` and `"no-key honesty nits (#56)"` describes (`:744`, `:794`).
- **`cloud/tests/e2e/funnel.e2e.ts`** — extend the keyed-run coverage test (`:232`) to assert **no** locks render on a keyed run.

No new runtime files are strictly required; the pattern is a function + a renderer + a CSS class. (Optional: a short `docs/prd/asc-findings/` note documenting the pattern — only if the owner wants it tracked there alongside #60; do **not** create docs proactively.)

---

## 5. Test plan (TDD, `*.spec.ts` + Playwright E2E)

Follow the repo's TDD order: scaffold the stub → write the failing test → implement.

### Unit — `cloud/src/engine/auditFindings.spec.ts` (pure, zero HTTP mocking, matching the file's existing style)
- `surfaceLocks({ hasAscKey: true, ... })` → **`[]`** (a keyed run locks nothing).
- `surfaceLocks({ hasAscKey: false, ... })` → contains a lock for **each** canonical blind-spot surface; assert the exact `surface` ids (parameterized over the surface list — no unexplained literals, per user testing standards).
- **Honesty assertions (strong):** every `label`/`unlockCopy` matches an opportunity frame and matches **none** of a forbidden-phrase set (`/\b0\/(30|100)\b/`, `/empty|missing|bad|costing you|losing|urgent/i`) — encoding the §6 rules as a test, the same way #56's E2E guards `not.toContainText(/excellent/i)`.
- **Determinism:** same input → deep-equal output (the file already enforces this contract for `auditFindings`).

### E2E — `cloud/tests/e2e/flows.e2e.ts` (reuse `seedNoKeyRun`, `:797-808`)
- No-key run renders a `.field-lock` on the **screenshot** section, and the locked subtitle/keyword coverage rows now carry an unlock link; clicking any "Connect to unlock" routes to `#/apps/...` and flashes `.asc-run-panel` (mirror the existing assertion at `:769-774`).
- **Honesty:** the locked screenshot section does **not** contain a grade letter or `/empty|missing|0\/30/i` — only the lock + opportunity copy.
- The action-gate lock and the field lock are distinguishable: `.field-lock` and `.locked` are separate selectors with separate copy (extends the "exactly once" discipline at `:856-863`).

### E2E — `cloud/tests/e2e/funnel.e2e.ts` (keyed run, `:232`)
- A keyed (Mode-A) run renders **zero** `.field-lock` nodes (parallel to the existing `await expect(covCard.locator(".cov-field-val.unseen")).toHaveCount(0)` at `:267`).

### Quality gates (per user standards)
Run lint + typecheck + `vitest` + Playwright before any commit; commit only on explicit owner approval.

---

## 6. Honesty / security considerations (core product value)

- **A lock means "can't see," not "empty/bad."** `surfaceLocks` emits capability statements only. The unit test's forbidden-phrase guard makes "never assert a deficiency in an unseen field" a CI invariant — the same class of bug #56 closed (false `0/30`, "Excellent" on unseen fields).
- **No false precision.** Locked subtitle/keywords keep the #60 `seen:false` → "unseen" rendering (`cloud/public/app.js:1261-1262`); the lock decorates it, it does not replace it with a measured `0/limit`.
- **Opportunity, not urgency.** Copy frames "unlock to read + improve." No "costing you rank," no countdowns, no implied loss (issue's non-negotiable).
- **Public/readable fields are not reading-locked.** Name + public screenshots still render their real readings; the screenshot lock appears **only** in the unreadable `?`-grade slot where the gallery is already `null` (`cloud/public/app.js:1106-1111`).
- **Never persist the `.p8`.** This PRD touches **no** credential path. The `.p8`/keyId/issuerId remain request-scoped in `runAppWithAsc` (`cloud/src/api/index.ts:917-962`), minted into an ephemeral JWT and discarded — unchanged.
- **The agent never auto-pushes.** Locks route to the existing ASC run panel for the human to connect; nothing about this surface initiates a read or a write. The approval-gate lock (`commandsLocked`) is untouched.
- **Privacy boundary preserved.** Only curated `locks[]` (static copy, no ASC data) crosses to the client, alongside the already-curated `findings`/`coverage` (`cloud/src/api/index.ts:996-1000`).

---

## 7. Risks & rollout

| Risk | Mitigation |
| --- | --- |
| **Lock fatigue** — 5–7 inline locks read as a paywall wall and feel nag-y. | Ship the pattern + 1–2 instances (coverage + screenshots) first; measure before rolling out the rest (issue's own staging). Keep copy quiet/secondary, not alarm-styled. |
| **Two lock meanings confused** (reading lock vs approval-action lock). | Distinct `.field-lock` class + copy; E2E asserts they are separate selectors. |
| **Redundancy with the bottom `asc_unlock` CTA.** | Slice 1 keeps both. Decision deferred (§8): once inline locks cover the surfaces, slim or drop the catch-all CTA. |
| **Legacy stored runs** lack `result.locks`. | UI falls back to `isNoKeyRun(R)` (`cloud/public/app.js:1143-1147`), mirroring the `fieldFill` legacy fallback (`:1241-1248`). |
| **Serializer drops the new field.** | Add a `locks` assertion in `runSerialize.spec.ts` and whitelist if needed. |

**Rollout:** pure additive, no migration, no flag strictly required. Optionally gate the screenshot-section lock behind a small client const for a staged turn-on. Verify in the mock harness before deploy (the E2E suite runs fully against `STORE_OPS_MOCK`).

---

## 8. Effort & decision

**Effort: M.** Engine helper + tests (S), UI primitive + CSS + two instances (S–M), E2E (S). Concentrated in three files already well-factored for it (`auditFindings.ts`, `app.js`, `styles.css`).

**Needs a product DECISION before build — yes, two:**
1. **Coexistence vs replacement.** Does the inline locked-field pattern *augment* the bottom `asc_unlock` CTA (recommended for slice 1), or *replace* it? This changes whether we keep `ascUnlockCta` (`cloud/public/app.js:1053-1069`) and the `asc_unlock` finding long-term.
2. **Which surfaces ship in slice 1.** Recommend **coverage subtitle/keywords + screenshots** only (lowest honesty risk, proven model). Owner confirms the rollout order for previews / privacy / category / locales.

Both align with the issue's stated scope ("design pattern; #60 is the first instance… roll out per-surface after the coverage card proves it"). Recommend the owner sign off on (1) and (2) before implementation begins.

