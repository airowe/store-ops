# PRD — Issue #45: ASC findings → scored, actionable audit findings (UI)

> **Status correction (read first).** This issue was scoped as a from-scratch build of the 6-PRD ASC-findings suite (`docs/prd/asc-findings/`). On inspection of the actual codebase, **PRDs 01–04 are already implemented, merged, and green.** The engine, run integration, serialization, the "Listing audit" run-page card, the dashboard finding badge, and the ASC-unlock CTA all exist and ship. `npx tsc --noEmit` is clean; the findings unit/serialization/context suites pass (86 tests); the PRD 03/04 E2E specs exist and assert the card, critical treatment, reduced-motion, the green "great shape" state, the dashboard badge, and the unlock CTA.
>
> Therefore this PRD is **not** "build the feature." It is a **verification + gap-closure PRD**: confirm the shipped behavior against the original intent, close the one real correctness gap found (a mock/production divergence in the summary `label`), and decide the disposition of the deferred ("fast-follow") catalog and the missing PRD 05 reference doc. Everything below is grounded in the files as they exist on `main` today.

---

## 1. Problem & context

### 1a. Original problem (now mostly solved)
The agent reads 8 App Store Connect surfaces and stores them on the run (`result.ascSnapshot`), but historically only screenshots reached the UI. The other 7 surfaces (previews, appInfo/category, version state, pricing/IAPs, age rating, custom product pages, all locales) were captured but invisible. The fix — a pure `auditFindings()` engine that turns the snapshot into scored, prioritized, instructive findings, serialized findings-only to the client and rendered as a "Listing audit" card — has been built:

- **Engine (PRD 01)** — `cloud/src/engine/auditFindings.ts:673` (`auditFindings`), pure/deterministic/network-free, per-surface rule sets at lines 177–661, scoring at `auditFindings.ts:102` (`scoreFinding`) and `auditFindings.ts:107` (`summarizeFindings`). 65 unit tests in `cloud/src/engine/auditFindings.spec.ts`.
- **Run integration + serialization (PRD 02)** — no-key path `runApp` computes the thin set at `cloud/src/api/index.ts:882`; ASC path `runAppWithAsc` computes the full set at `index.ts:1000` and builds the slim context via `buildAscContext` (`index.ts:1007`, engine at `cloud/src/engine/ascContext.ts`). `runView` serializes findings/summary/context at `index.ts:251–268` and explicitly never serializes the raw `ascSnapshot`. Trace persistence at `cloud/src/d1.ts:104–133, 448–452`. Negative-test privacy boundary in `cloud/src/api/runSerialize.spec.ts` (15 tests).
- **Run-page card (PRD 03)** — `listingAuditCard` at `cloud/public/app.js:1149`, wired into `viewRun` (`app.js:952`) above the diff card. Severity/impact metadata, fix lines, fix links, the green empty state (`app.js:1164`), and the reduced-motion-safe reveal. CSS in `cloud/public/styles.css`.
- **Dashboard badge + unlock CTA (PRD 04)** — `findingBadge` at `app.js:564`; the app-list `findings_summary` data hook at `index.ts:829–850`; `ascUnlockCta` at `app.js:1049` and `isNoKeyRun` at `app.js:1140`.
- **E2E (PRD 03/04)** — `cloud/tests/e2e/flows.e2e.ts:408` ("Listing audit card"), `:683` ("finding-count badge"), `:744` ("ASC unlock CTA").

### 1b. What's still broken / missing
Three concrete items remain:

1. **Correctness gap — summary `label` exists only in the mock (production divergence).**
   The UI reads `summary.label` for the audit-card header (`app.js:1158`) and the demo mock produces it (`cloud/public/mock.js:368`, `summarizeFindings` sets `c.label = "3 fixes available · 1 critical"`). But the **production** engine `summarizeFindings` (`auditFindings.ts:107`) returns `{ critical, warn, good, info, total, topImpact }` with **no `label`**. So `runView` (`index.ts:267`, `findingsSummary: summarizeFindings(findings)`) ships a summary with `label === undefined`. On a real run the header silently falls back to the plain `"N findings"` string (`app.js:1158`), never the richer "N fixes available · 1 critical" copy the PRD specifies. **The E2E never catches this because E2E renders the mock, which has the label.** This is a classic mock-truth-vs-product-truth divergence: the demo looks better than the product.

2. **Missing reference doc — `docs/prd/asc-findings/05-surface-findings-spec.md`.**
   PRD 00 (`00-overview.md`) and the engine header comment (`auditFindings.ts:6`) both cite `05-surface-findings-spec.md` as the canonical per-surface catalog (every id/severity/impact/copy, each marked `launch | fast-follow`). **The file does not exist.** The engine implements 24 finding ids, but the catalog of record they're supposed to trace to is absent — a documentation drift that makes future rule changes ungrounded.

3. **Fast-follow catalog disposition is undecided (a product decision, not a code task).**
   The "launch slice" in the issue is fully shipped. The deferred fast-follow findings (the lower-signal pricing/age-rating/CPP rows, plus any catalog rows in PRD 05 marked fast-follow that aren't yet implemented) need an explicit decision: ship now, defer, or drop. Several low-signal `info` findings are *already* emitted today (`pricing_context`, `age_rating_context`, `cpp_none`, `iap_not_promoted`) — so the line between "launch" and "fast-follow" has drifted from the issue's stated slice and should be reconciled.

### Why it matters
The product's core promise is **honesty + actionability**. (1) means paying ASC-connected users get a worse-looking header than the unauthenticated demo — the exact inversion of the "ASC is the unlock/reward" framing. (2) means the rule surface has no source of truth, so the next person editing thresholds is guessing. (3) is a scope-hygiene decision that should be made by the owner, not silently by whoever last touched the engine.

---

## 2. Goal & non-goals

### Goals
1. **Verify** the shipped PRD 01–04 behavior end-to-end on a *real* (non-mock) run path and document any divergence between mock and production payloads.
2. **Close the `label` gap**: make production `summarizeFindings` emit the same `label` the mock does, so the run-page header and dashboard badge read identically in demo and production. Guard it with a unit test on the engine and a serialization assertion.
3. **Author the missing `05-surface-findings-spec.md`** as the catalog of record, generated from / reconciled against the 24 ids the engine actually emits, each tagged `launch | fast-follow`.
4. **Surface the fast-follow decision** to the owner with a concrete recommendation (see §8) rather than implementing it unilaterally.

### Non-goals
- Re-architecting the engine, scoring, or sort (they work and are tested).
- New ASC reads or any new outward write. Findings derive from the already-captured snapshot only.
- Billing/checkout/paywall changes (the unlock CTA points at the existing ASC run flow, per PRD 04).
- Building the optional flag-gated `/preview` teaser (PRD 04 §3 — explicitly deferred there; leave deferred).
- Adding new finding *rules* beyond reconciling the catalog, unless the owner approves the fast-follow set in §8.

---

## 3. Proposed approach (grounded in real files)

### 3.1 Close the `label` gap (the one real bug)
Move the label logic out of the mock and into the engine so both paths share one definition.

- In `cloud/src/engine/auditFindings.ts`, extend `FindingsSummary` (`auditFindings.ts:68`) with `label: string`, and have `summarizeFindings` (`auditFindings.ts:107`) compute it with the **same rule the mock uses** (`mock.js:368–376`): `fixes = critical + warn`; `parts = ["{fixes} fixes available", "{critical} critical" (if any)]`; `label = parts.join(" · ") || "No fixes found"`. Keep it pure (no `Date.now`/random — it already is).
- Delete the bespoke label computation in `cloud/public/mock.js` and instead have the mock's `summarizeFindings` (`mock.js:368`) mirror the engine output shape, OR — cleaner — keep the mock's local copy but make it *byte-identical* to the engine's so there's a single canonical string format. (Mock is vanilla JS with no import of the TS engine, so a mirrored copy is the pragmatic choice; add a comment pointing at `auditFindings.ts` as the source of truth.)
- `runView` (`index.ts:267`) needs no change — it already calls `summarizeFindings(findings)`; it will now carry `label` for free.
- The app-list badge path (`index.ts:839`, `findings_summary = trace.findingsSummary`) also gets the label for free, so `findingBadge` (`app.js:564`) can optionally consume `fs.label` instead of re-deriving counts — leave `findingBadge`'s count logic as-is (it's badge-specific copy "✓ Looking good"), but the *header* summary (`app.js:1158`) will now show the real label on production runs.

### 3.2 Author `05-surface-findings-spec.md`
Generate the catalog from the engine's emitted ids (24, enumerated in §1b list / confirmed via grep of `auditFindings.ts`): for each — `id`, `surface`, `severity`, `impact`, the exact `title`/`detail`/`fix` copy, the trigger condition, and a `launch | fast-follow` tag. Cross-link from `00-overview.md` (the table row already references it) and from the `auditFindings.ts:6` header comment (which already cites it — so the citation becomes valid).

### 3.3 Verification pass
Run the existing suites (already green) plus a manual/`mock`-vs-real diff:
- Assert the `runView` payload `findingsSummary.label` is a non-empty string on a seeded ASC run (currently it's `undefined`).
- Confirm the run-page header on a *real* run shows the label, not the count fallback.

---

## 4. Exact files to change + new files

### Change
- **`cloud/src/engine/auditFindings.ts`** — add `label: string` to `FindingsSummary` type (`:68`); compute it in `summarizeFindings` (`:107`). ~6 lines.
- **`cloud/src/engine/auditFindings.spec.ts`** — add cases: label for `{critical:1, warn:2}` → `"3 fixes available · 1 critical"`; label for all-`info`/`good` → `"No fixes found"`; label for `0` findings → `"No fixes found"`.
- **`cloud/public/mock.js`** — reconcile `summarizeFindings` (`:368`) to the engine's exact format; comment it as a mirror of `auditFindings.ts`.
- **`cloud/src/api/runSerialize.spec.ts`** — add an assertion that `result.findingsSummary.label` is a non-empty string (extends the existing `findingsSummary` test at `:131`).
- **`cloud/public/app.js`** — no logic change required (`:1158` already reads `summary.label` with a count fallback); optionally drop the fallback once production always provides a label, but keep it as a defensive default for legacy traces (`runView` defaults old traces to `[]` at `index.ts:253`, whose summary will be `"No fixes found"`).
- **`docs/prd/asc-findings/00-overview.md`** — no change needed (the `05` table row already exists); verify the link resolves once the file is created.

### New
- **`docs/prd/asc-findings/05-surface-findings-spec.md`** — the per-surface catalog of record (24 ids today), each tagged `launch | fast-follow`. Reference doc, not code.

### Explicitly NOT changed
- `cloud/src/api/index.ts` run paths (`runApp`/`runAppWithAsc`/`runView`) — already correct.
- `cloud/src/d1.ts` trace shape — already carries `findings`/`ascContext`/`findingsSummary`.
- `cloud/src/engine/ascContext.ts` — the privacy boundary is already correct and tested.

---

## 5. Test plan (TDD, `*.spec.ts` / `*.e2e.ts` conventions)

### Unit (Vitest, colocated `*.spec.ts`)
- **`auditFindings.spec.ts`** (extend the existing 65-test suite):
  - `summarizeFindings` returns `label === "3 fixes available · 1 critical"` for a `{critical:1, warn:2}` finding set.
  - `label === "1 fix available"` for a single non-critical actionable finding (singular).
  - `label === "No fixes found"` for an empty array and for an all-`info`/`good` set.
  - Determinism preserved: same input → deep-equal summary including `label`.
- **`runSerialize.spec.ts`** (extend the existing 15-test suite): on a seeded ASC run, `result.findingsSummary.label` is present and non-empty; the privacy negative-tests (no raw pricing/locale/policy/snapshot) continue to pass unchanged.

### E2E (Playwright, `tests/e2e/flows.e2e.ts`)
- **Tighten the existing audit-card test (`flows.e2e.ts:408`)** to assert the header summary text matches the `/(\d+ fixes? available|No fixes found)/` pattern — i.e. the *label*, not just presence of a finding count. This is the test that would have caught the gap had it asserted on the label format.
- Keep the existing critical-treatment (`:451`), fix-link (`:466`), reduced-motion (`:479`), green-state (`:502`), badge (`:683`), and unlock-CTA (`:744`) tests green.

### Manual verification
- Run `npx tsc --noEmit` (must stay clean), `npx vitest run`, and `npx playwright test` (per `cloud/playwright.config.ts`).
- Seed a no-key run and an ASC run; confirm the header label renders identically in both the mock-served demo and a real run payload.

### TDD order (per user/repo convention: stub → failing test → implement)
1. Add the failing `summarizeFindings` label unit tests.
2. Add the failing `runSerialize` label assertion.
3. Implement the `FindingsSummary.label` + `summarizeFindings` change.
4. Reconcile `mock.js`; tighten the E2E label assertion.

---

## 6. Honesty & security considerations (the product's core value)

- **Never present unseen data as measured.** The change is purely a *summary label* over already-curated findings — it introduces no new assertion about ASC data. The engine's existing honesty guards stay intact: the `unknown` price three-state (`auditFindings.ts:474`), the age-rating "unconfirmed, not declared-missing" treatment (`auditFindings.ts:504–521`, #71-A3), and the screenshot `"?"`/`screenshots_unknown` honest-empty path (`auditFindings.ts:234`). Do not touch these.
- **Findings-only to the client.** Unchanged. `runView` serializes `findings`/`findingsSummary`/`ascContext` and never the raw `ascSnapshot` (`index.ts:251–268`, guarded by `runSerialize.spec.ts` negative tests). The new `label` is derived from counts, not from raw ASC text, so it cannot leak pricing/locale/policy data. Add no new fields to `ascContext`.
- **`.p8` ephemeral / no new ASC calls.** Unchanged. The label is computed from the in-memory `Finding[]`; this PRD issues zero new reads and zero writes. The agent still **never auto-pushes** — the audit card sits above the approval gate (`app.js` `viewRun` ordering), which this PRD does not alter.
- **Don't over-assert.** The label only ever counts `critical + warn` as "fixes." The low-signal `info` rows (pricing/age-rating/CPP context) are correctly excluded from the "fixes available" count, so the header never inflates urgency. Preserve this when reconciling the mock.
- **Mock honesty.** Closing the mock/production divergence is itself an honesty fix: the demo must not promise UI polish the real product doesn't deliver.

---

## 7. Risks & rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| Label format drift re-appears between `mock.js` and the engine | Medium | Single canonical format in `auditFindings.ts`; mock comment cites it as source of truth; E2E asserts the format pattern, not a hardcoded count. |
| Legacy traces (pre-PRD-02) have no findings | Low | `runView` already defaults to `[]` (`index.ts:253`); `summarizeFindings([])` will yield `label: "No fixes found"`, and `findingBadge` already returns `null` on no summary. |
| E2E still green but production still wrong (the original failure mode) | Low | The verification pass explicitly diffs a *real* run payload's `findingsSummary.label`, plus a `runSerialize` unit assertion that runs against production code, not the mock. |
| Catalog (`05`) drifts from the engine again | Medium | Generate `05` from the engine's emitted ids; add a note that any new finding id must be added to `05` in the same PR. |

**Rollout.** No migration, no flag, no schema change. `FindingsSummary` gains an optional-in-practice field; old persisted `findingsSummary` rows on traces simply lack `label` and the UI falls back gracefully (`app.js:1158`). Ship behind the normal deploy; no staged rollout needed. Per the user's workflow rules: run all quality gates (tsc, vitest, playwright) before any commit, and **do not commit without explicit owner approval**.

---

## 8. Effort estimate & required decision

**Effort: S** (small). The feature is already built. Remaining work is one ~6-line engine change + tests, one reconciliation in `mock.js`, one tightened E2E assertion, and one reference doc. Estimate ~0.5 day including the verification pass.

**Decision needed from the owner before building — YES, one product decision:**

> **Fast-follow catalog disposition.** The issue's "launch slice" is shipped, but several lower-signal `info` findings are *already* live (`pricing_context`, `age_rating_context`, `cpp_none`/`cpp_present`, `iap_not_promoted`, `preview_thin_coverage`, `appinfo_name_mismatch`, `version_context`), which goes beyond the issue's stated launch list. The owner should decide one of:
> 1. **Ratify current state** — accept the 24 emitted ids as "launch," mark only genuinely-unbuilt PRD-05 rows as fast-follow. *(Recommended — it matches what's deployed and tested, and the extra `info` rows are honest, non-alarming context.)*
> 2. **Trim to the literal launch slice** — gate the extra `info` findings behind a flag until fast-follow. (More work; reduces the audit card's richness for no clear honesty gain.)
>
> The `label` fix and the `05` catalog authoring do **not** require a decision and can proceed immediately. The fast-follow disposition only affects whether any rows get *removed*, so it gates step §8 option-2 work only.

The `label` correctness fix is unambiguous and should be treated as a bug fix, not a feature — proceed once the owner approves the commit per workflow rules.

