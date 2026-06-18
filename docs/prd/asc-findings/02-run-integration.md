# PRD 02 — Run integration + serialization

> Wire `auditFindings` (PRD 01) into the run paths and expose the result to the
> client — **findings only, never raw ASC data**. Depends on PRD 01.

## Scope

### Compute findings on every run
- **`runAppWithAsc`** (`src/api/index.ts`): after the snapshot read + screenshot
  re-score, call `auditFindings({ snapshot, audit: result.audit, ranks: result.ranks,
  appName, hasAscKey: true })` and attach `result.findings`.
- **`runApp` (the no-key `/run` path)**: also compute findings with
  `hasAscKey: false` (no snapshot) — yields the public-only set + the
  `asc_unlock` finding. So EVERY run carries findings, ASC or not.
- Persist `findings` on the run trace (`ReasoningTrace` in `d1.ts`).

### Serialize to the client (the privacy boundary)
In `runView` (`src/api/index.ts` ~line 225), add to the `result` block:
- `findings: trace.findings` — the sorted `Finding[]` (safe; it's curated copy).
- `findingsSummary` — from `summarizeFindings` (counts for the header/badge).
- **A slim, PII-safe `ascContext`** — ONLY the few context values the UI shows,
  e.g. `{ category, secondaryCategory, ageRating, versionState, localeCount,
  previewDeviceCount }`. Explicitly NOT: raw pricing numbers, full locale text,
  privacy policy text, screenshot URLs.
- Do **NOT** serialize the full `ascSnapshot`. It stays in the DB trace,
  server-side, for future use.

## Why a separate `ascContext` (not the raw snapshot)
The snapshot contains pricing, every locale's full copy, privacy-policy text, and
asset URLs. None of that should reach the browser — it's bulky and some is
sensitive. The findings already encode the actionable conclusions; `ascContext`
carries only the handful of display values a finding references ("Category:
Weather"). Minimal surface, no leak.

## TDD
- A Mode-A run persists + returns a non-empty `findings` array and an
  `ascContext` with the expected keys (and NONE of the forbidden ones).
- A no-key run returns the thin set incl. `asc_unlock`.
- `runView` response shape: assert `findings`/`findingsSummary`/`ascContext`
  present; assert raw pricing/locale/policy text ABSENT (a negative test that
  guards the privacy boundary).
- mock.js (`runAgentMock`) emits a representative `findings` + `ascContext` so the
  funnel/E2E render the card (handled jointly with PRD 03's mock needs).

## Acceptance
- Every run (ASC or not) carries findings end-to-end (compute → persist → serialize).
- The client receives findings + summary + slim context; never raw snapshot data
  (guarded by a negative test).
- tsc clean; unit + the serialization negative test green.

## Out of scope
- Rendering → PRD 03/04. This PRD stops at "the API returns the right JSON."
