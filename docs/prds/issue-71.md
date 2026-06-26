# PRD — Issue #71: Findings panel — "show, don't link" suggestions + signal-vs-noise cleanup (B/C remaining)

> Scope note: Section **A (correctness bugs)** of issue #71 is already shipped — A1 (honest pricing label) and A2 (real-locale subtitle/keywords completeness check) in commit `5df2dc9`, and A3 (`age_rating_unconfirmed` instead of false "not declared") in commit `4295beb`. This PRD covers the **B and C** work that remains, plus a small verification/regression-lock pass on A so the trust fixes don't silently regress.

---

## 1. Problem & context

The findings panel ("Listing audit" card) is the product's primary surface: it's where ShipASO turns a live App Store Connect read into prioritized, actionable ASO advice. A live Mangia run (`1986d077`) exposed three classes of defect; A is fixed, B and C remain.

**The findings engine** is a pure, deterministic, network-free function: `auditFindings(input)` in `cloud/src/engine/auditFindings.ts:673`. It turns an already-captured `AscSnapshot` (+ audit + ranks) into a sorted `Finding[]`. Every rule, threshold, severity, and copy string lives in that one file (catalog spec: `docs/prd/asc-findings/05-surface-findings-spec.md`). The `Finding` type today (`auditFindings.ts:34-49`) is: `id, surface, severity, impact, title, detail, fix, evidence?`.

The card renders in `cloud/public/app.js` via `listingAuditCard()` (`app.js:1149`), iterating findings into `.finding` rows (`app.js:1176-1195`). A static `fixLinkFor(id)` map (`app.js:1074-1096`) appends an external link per finding id — almost always a bare `https://appstoreconnect.apple.com` link.

**B — "show suggestions, don't just link."** The product's promise is that the agent *does the work*. Today several findings dead-end at a generic ASC link instead of doing the analysis ShipASO is uniquely positioned to do:

- **`preview_missing`** (`auditFindings.ts:265-278`) — "No app preview video" → `fix: "Add a 15–30s preview…"` + a bare ASC link. No script/shot ideas.
- **`secondary_category_missing`** (`auditFindings.ts:335-347`) — "No secondary category set" → `fix: "Pick your most relevant secondary category in App Store Connect."` ShipASO already reads the primary category and (on keyed runs) the live description, so it can *recommend* the best secondary category (Mangia → Food & Drink primary, so e.g. Health & Fitness / Lifestyle secondary) — but it doesn't.
- **`cpp_none`** (`auditFindings.ts:546-558`) — "No Custom Product Pages" → bare link. No CPP angles.
- **`primary_category_context`** (`auditFindings.ts:349-363`) — "Category: FOOD_AND_DRINK" is a value ShipASO **confirmed** from the ASC read, yet the copy says `fix: "Confirm it matches the keywords you're targeting."` — framing a confirmed read as an unconfirmed to-do. This is mildly self-undermining (the agent doubts data it actually read).

**C — signal vs noise.** Status/context findings sit in the same flat list as real recommended fixes, diluting the signal. Three findings are pure status, not actionable ASO fixes:

- **`version_context`** (`auditFindings.ts:431-442`) — "Live version 1.0.1 (READY_FOR_SALE)" — `fix: "No action — context only."`
- **`version_no_draft`** (`auditFindings.ts:416-429`) — "No draft version" — context about editability, not an ASO lever.
- **`locale_single`** (`auditFindings.ts:582-596`) — "Live in 1 locale" — borderline: it *is* a ranking lever (each locale is a keyword surface) but reads as status. Issue lists it under C. Treat as a judgment call (see §8 DECISION).

Other `*_context` findings (`pricing_context`, `primary_category_context`, `age_rating_context`) and the `cpp_present`/`age_rating_unconfirmed` info rows are also context, not fixes.

**Why it matters.** Findings are the trust surface. The cross-cutting principle from the issue: findings should be (a) only asserted when actually READ, (b) actionable *with a ShipASO-generated suggestion* where possible (not a bare ASC link), (c) separated — real fixes vs context/status. Mixing status with fixes makes a clean listing look noisy and makes the agent look like a linter that defers everything back to the user.

**Hard architectural constraint (the privacy boundary, PRD 02 / `cloud/src/engine/ascContext.ts`).** The raw `AscSnapshot` (pricing, full locale copy, privacy text, asset URLs, IAP ids) NEVER reaches the browser. Only `findings` + the slim `ascContext` cross the boundary (`api/index.ts:1000-1008`). Therefore any "show, don't link" suggestion that draws on snapshot data **must be generated server-side and carried as a field on the `Finding` itself** — it cannot be re-derived in `app.js`, which has no access to category, description, or locale copy.

---

## 2. Goal & non-goals

### Goals
1. **B — suggestions over links.** For `secondary_category_missing`, `cpp_none`, and `preview_missing`, attach a concrete, ShipASO-generated `suggestion` (rendered in the card) derived from data the run already holds — not a bare ASC link.
2. **B — confirmed framing.** Reframe `primary_category_context` as a *confirmed* read, not a "confirm it" to-do.
3. **C — separate signal from noise.** Tag every finding with a `kind` (`"fix" | "context"`), and render `context` findings in a distinct, demoted "Listing status" strip — out of the recommended-fix list.
4. **Lock A against regression.** Add/keep unit tests asserting the honest pricing, locale-completeness, and age-rating behaviors so B/C edits can't silently re-break them.
5. Preserve the engine's hard constraints: pure, deterministic, network-free, graceful degradation, never over-assert, never present unseen data as measured.

### Non-goals
- **Producing the preview video itself** (issue item 4 "Later: our own production — ties to #68-area"). We suggest a *script/shot outline*, not a rendered video.
- **Writing to App Store Connect.** No new ASC writes. The agent NEVER auto-pushes; suggestions are advisory copy only. Secondary-category and CPP suggestions are recommendations, not applied changes.
- **An LLM dependency on the critical path.** Suggestions must work with the deterministic fallback (no `env.AI` binding). LLM-backed enrichment, if added, is strictly optional and behind the existing `reasonerForEnv` guard (`api/aiReasoner.ts:39`).
- **New ASC reads.** The engine derives only from the already-captured snapshot (`auditFindings.ts:16`).
- **Re-architecting the card.** Reuse existing `.finding` / `.reasoning` / `.step` patterns (PRD 03).

---

## 3. Proposed approach (grounded in real files)

### 3.1 Extend the `Finding` type — two new optional fields

In `cloud/src/engine/auditFindings.ts:34-49`, add to `Finding`:

```ts
/** classification for signal-vs-noise grouping in the UI (#71-C).
 *  "fix"     → a real, recommended ASO action (default).
 *  "context" → status/listing context, not an action — rendered in a demoted strip. */
kind?: "fix" | "context" | undefined;
/** a concrete, ShipASO-generated suggestion the agent produced from data it
 *  already read (#71-B) — shown instead of a bare ASC link. Plain text, no PII. */
suggestion?: string | undefined;
```

Update the `mk()` builder (`auditFindings.ts:131-145`) to copy `kind` and `suggestion` only when defined (matching the existing `exactOptionalPropertyTypes` pattern used for `evidence`).

**Why on the Finding (not ascContext):** suggestions need category/description/locale data that lives only in the snapshot, which is server-side. `Finding` already crosses the boundary; `ascContext` is intentionally scalar-only and forbidden from carrying copy. The suggestion text is curated/derived (not raw snapshot fields), so it's safe to serialize — same posture as the existing `detail`/`fix` strings.

### 3.2 C — tag context findings + render a status strip

**Engine side.** Add `kind: "context"` to the three issue-named status findings and the other pure-context rows. Concretely tag as `context`:
- `version_context` (`auditFindings.ts:431`)
- `version_no_draft` (`auditFindings.ts:416`)
- `version_in_review` (`auditFindings.ts:401`) — also status
- `pricing_context` (`auditFindings.ts:476`)
- `primary_category_context` (`auditFindings.ts:349`)
- `age_rating_context` (`auditFindings.ts:522`) and `age_rating_unconfirmed` (`auditFindings.ts:511`)
- `cpp_present` (`auditFindings.ts:560`)

Everything else defaults to `kind: "fix"` (leave `kind` undefined → treated as fix). `locale_single` — see §8 DECISION; default plan keeps it a `fix` (warn/ranking).

Keep these in the same returned array (sort is unchanged: `sortFindings` at `auditFindings.ts:690`); the split is purely a UI concern so the engine stays a single source of truth and `summarizeFindings` (`auditFindings.ts:107`) is unaffected. **Note:** `summarizeFindings` counts by severity, and context findings are all `info`/`good`, so the "N fixes available" summary already mostly reflects fixes — but to make the header honest we should derive the fix count from `kind !== "context"` (see §4, `app.js` summary line at `app.js:1158`).

**UI side (`app.js` `listingAuditCard`, `app.js:1149-1216`).** Partition findings:
```js
var fixes   = findings.filter(function (f) { return f.kind !== "context"; });
var context = findings.filter(function (f) { return f.kind === "context"; });
```
Render `fixes` in the existing `.findings` list. Render `context` in a new demoted `listingStatusStrip(context)` block placed BELOW the fixes list (above the unlock CTA) — compact, neutral, single-line-per-item rows reusing `.faint` styling, with a small "Listing status" header. Empty `context` → strip omitted. When `fixes` is empty but `context` exists, the existing green "great shape" empty-state (`app.js:1166`) still shows for the fixes area, and the status strip renders below it — honest: "no fixes, here's your status."

Add `.listing-status` / `.listing-status-row` styles in `cloud/styles.css` (reuse existing tokens `--dim`/`--faint`).

### 3.3 B — server-side suggestion generators (deterministic, pure)

Create a new pure module `cloud/src/engine/findingSuggestions.ts` with deterministic generators. These take the slim data the engine already has and return a `string | undefined`. Pure + network-free → unit-testable with zero mocking, same as `auditFindings`.

**(a) Secondary category** — `suggestSecondaryCategory(primaryCategoryId, description?)`:
- A static, bundled affinity map from primary category → ranked secondary candidates (e.g. `FOOD_AND_DRINK → ["HEALTH_AND_FITNESS", "LIFESTYLE"]`, `PRODUCTIVITY → ["UTILITIES", "BUSINESS"]`). Mirror the existing static-affinity pattern in `localizationExpansion.ts` (`categoryAffinity`, referenced at `localizationExpansion.ts:20`) — this is the established "bundled heuristic, no live data" convention.
- Optionally sharpen with description keywords when present (keyed runs read `liveDescription`, threaded into the run at `api/index.ts:982`), but the deterministic map is the floor. Output e.g.: `"Based on your Food & Drink category, Health & Fitness is the strongest second ranking surface — it matches meal-planning and recipe intent."`

**(b) CPP angles** — `suggestCppAngles(categoryName, description?)`:
- Return 1–2 concrete CPP angles keyed off category (+ description keywords when present). Deterministic templates per category, e.g. for Food & Drink: `"Try a CPP per use-case: one tuned for 'weekly meal prep', one for 'recipe organization' — each with its own first screenshot + subtitle for the ad set driving it."`

**(c) Preview script/shots** — `suggestPreviewOutline(categoryName, appName, description?)`:
- A 3–4 beat shot outline derived from category + app name. Deterministic template, e.g.: `"15–20s outline: (1) open on your home screen, (2) the one action users come for — show it in 2 taps, (3) the payoff/result, (4) end on your icon + name. Capture on a 6.7\" iPhone."`

All three return `undefined` when they have nothing real to say (e.g. unknown category) so we **never fabricate** a suggestion — graceful degradation matches `auditFindings`'s contract.

**Optional LLM enrichment (guarded, non-blocking).** Because these run inside the engine (which is pure and has no binding), the deterministic generators are the engine's output. If we want richer, app-specific suggestions, generate them in the **API layer** (`runAppWithAsc`, `api/index.ts:917`) AFTER `auditFindings` returns, by post-processing findings with `reasonerForEnv(env.AI)` (`api/aiReasoner.ts:39`) — exactly how keyword reasoning is wired (`api/index.ts:985`). The LLM output overwrites `suggestion` only on success; any failure leaves the deterministic suggestion intact. This keeps the engine pure/testable and the LLM strictly optional. **Recommended: ship deterministic-only first; LLM enrichment is a fast-follow.**

### 3.4 B — wire suggestions into the rules

In `auditFindings.ts`, the suggestion generators need category/description. The engine has the snapshot, so:
- `secondary_category_missing` (`appInfoFindings`, `auditFindings.ts:335`): call `suggestSecondaryCategory(appInfo.primaryCategory?.id, descriptionFromSnapshot)`. Note `appInfoFindings` already reads `appInfo.primaryCategory` at `auditFindings.ts:349`. The live description is on `snapshot.locales[].description` (`LiveListingCopy.description`, `ascWrite.ts:64`) — read the primary locale's description for keyword sharpening.
- `cpp_none` (`cppFindings`, `auditFindings.ts:546`): needs category — pass `input` (not just `snapshot`) so it can reach `appInfo.primaryCategory`. Call `suggestCppAngles(categoryName, description)`.
- `preview_missing` (`previewFindings`, `auditFindings.ts:265`): needs category + appName — change its signature to take `input` instead of `snapshot` (it's called at `auditFindings.ts:676`). Call `suggestPreviewOutline(categoryName, input.appName, description)`.

For each, set `suggestion: <generated>` and, where the suggestion fully replaces the action, simplify the `fix` line accordingly. Keep the ASC link in `fixLinkFor` as a secondary "or edit in App Store Connect" affordance, not the primary CTA.

### 3.5 B — confirmed framing for `primary_category_context`

In `appInfoFindings` (`auditFindings.ts:349-363`), change:
- `fix: "Confirm it matches the keywords you're targeting."` → `fix: "No action — confirmed from your App Store Connect read."` (or drop `fix` and rely on `detail`).
- `detail` → reword to state it's confirmed: `"ShipASO read this directly from App Store Connect. It shapes which charts and searches you rank in."`
- Set `kind: "context"` (it's a confirmed value, not a fix) so it lands in the status strip.

### 3.6 UI rendering of `suggestion` (`app.js`)

In the finding-row builder (`app.js:1183-1190`), after the `fix` row, when `fnd.suggestion` is present, push a distinct `.finding-suggestion` block — visually marked as the agent's own work (e.g. a "✦ ShipASO suggests:" label) to reinforce "the agent did the work." Keep `fixLinkFor(fnd.id)` as the muted secondary link. Add `.finding-suggestion` styling in `styles.css`.

---

## 4. Exact files to change + new files

### Modified
- **`cloud/src/engine/auditFindings.ts`**
  - `Finding` type: add `kind?` and `suggestion?` (`:34-49`).
  - `mk()`: copy `kind`/`suggestion` when defined (`:131-145`).
  - Tag context findings with `kind: "context"`: `version_context`, `version_no_draft`, `version_in_review`, `pricing_context`, `primary_category_context`, `age_rating_context`, `age_rating_unconfirmed`, `cpp_present`.
  - `previewFindings`: take `input` (not `snapshot`); add `suggestion` to `preview_missing` (`:259-311`, call site `:676`).
  - `appInfoFindings`: add `suggestion` to `secondary_category_missing`; reframe `primary_category_context` to confirmed + `kind:"context"` (`:314-384`).
  - `cppFindings`: take `input`; add `suggestion` to `cpp_none` (`:540-574`, call site `:681`).
  - Import the new `findingSuggestions` helpers.
- **`cloud/public/app.js`**
  - `listingAuditCard`: partition fixes vs context; render `listingStatusStrip`; derive header fix-count from `kind !== "context"` (`:1149-1216`, summary line `:1158`).
  - Finding-row builder: render `.finding-suggestion` when `fnd.suggestion` present (`:1183-1190`).
  - New `listingStatusStrip(contextFindings)` function.
  - `fixLinkFor`: demote links to secondary where a suggestion now leads (`:1074-1096`).
- **`cloud/styles.css`** — add `.listing-status`, `.listing-status-row`, `.finding-suggestion`.
- **`cloud/public/mock.js`** — emit `kind` on the context fixtures (`locale_single`/`primary_category_context` at `:336`/`:347`) and add a `suggestion` to at least one fix finding so the card + status strip render in demo/E2E without a key (mirrors PRD 03 mock requirement). Keep `findingsSummary` consistent (`:251-252`).

### New
- **`cloud/src/engine/findingSuggestions.ts`** — pure deterministic generators: `suggestSecondaryCategory`, `suggestCppAngles`, `suggestPreviewOutline`, plus the static category-affinity/template tables.
- **`cloud/src/engine/findingSuggestions.spec.ts`** — colocated unit tests.

### Possibly touched
- **`cloud/src/api/index.ts`** — ONLY if shipping optional LLM enrichment: post-process findings after `auditFindings` in `runAppWithAsc` (`:1000`) via `reasonerForEnv` (guarded, non-blocking). Not required for the deterministic MVP.
- **`cloud/src/engine/ascContext.ts`** — no change; suggestions ride on `Finding`, not `ascContext`. (Confirm no suggestion text leaks into `ascContext` — the `FORBIDDEN_CONTEXT_KEYS` spec at `:42` already guards this.)

---

## 5. Test plan (TDD, `*.spec.ts`, strong assertions)

Follow the repo convention: pure-logic unit tests colocated as `*.spec.ts`; E2E under `cloud/tests/e2e/*.e2e.ts` (Playwright, `playwright.config.ts`). Scaffold stub → failing test → implement.

### Unit — `cloud/src/engine/findingSuggestions.spec.ts` (new)
- `suggestSecondaryCategory("FOOD_AND_DRINK")` returns a non-empty string naming a relevant secondary (parameterized over a table of `[primaryId, expectedSecondaryToken]` pairs — no unexplained literals).
- Unknown/absent primary → `undefined` (never fabricate).
- Description keywords sharpen output when provided (assert the keyword appears) but a missing description still yields the deterministic floor.
- `suggestCppAngles` / `suggestPreviewOutline`: return concrete, category-appropriate text for known categories; `undefined` for unknown; `suggestPreviewOutline` includes the app name when given.
- Determinism: same input → identical output (call twice, `toEqual`).

### Unit — `cloud/src/engine/auditFindings.spec.ts` (extend existing, `:1`)
- **C / kind tagging:** `version_context`, `version_no_draft`, `pricing_context`, `primary_category_context`, `cpp_present`, `age_rating_*` carry `kind: "context"`; `secondary_category_missing`, `screenshots_*`, `preview_missing`, `privacy_policy_missing` carry no `kind` or `kind:"fix"` (parameterized id→kind table).
- **B / suggestions present:** a snapshot with no secondary category produces a `secondary_category_missing` finding whose `suggestion` is a non-empty string; `cpp_none` and `preview_missing` likewise carry `suggestion`.
- **B / confirmed framing:** `primary_category_context.fix` no longer contains "Confirm" and the detail asserts it was read from ASC.
- **Honesty / no fabrication:** when category is unreadable (absent `primaryCategory`), `secondary_category_missing` still fires but `suggestion` is `undefined` (we degrade, never invent).
- **A regression locks (verify already-shipped fixes hold):**
  - null `baseTerritoryPrice` → `pricing_context` reads "unknown price", NEVER "paid" (`auditFindings.ts:474`).
  - a locale WITH subtitle + keywords does NOT emit `locale_incomplete` (`:602`).
  - empty parsed age rating → `age_rating_unconfirmed` (info), never a "not declared" blocker (`:511`).
- Determinism + graceful: undefined snapshot → no throw, no suggestion findings (existing baseline test pattern, `healthySnapshot()` at `:48`).

### E2E — `cloud/tests/e2e/findings.e2e.ts` (new, mirroring `screenshotGallery.e2e.ts`)
- A run renders the "Listing audit" card; recommended fixes appear in the `.findings` list, context findings appear in the `.listing-status` strip and NOT in the fixes list.
- A finding with a `suggestion` renders the `.finding-suggestion` block with the "ShipASO suggests" affordance.
- Header fix-count reflects only fixes (status items excluded).
- `prefers-reduced-motion`: card + status strip render fully, no stuck elements (mirror existing reduced-motion test).
- No raw ASC data in the DOM (privacy-boundary assertion — grep the rendered HTML for forbidden tokens, mirroring the boundary intent of `ascContext` spec).

### Mock — `cloud/public/mock.js`
- Update `runAgentMock` fixtures so the demo/E2E exercises both lanes + at least one `suggestion` (`:251`, `:336`, `:347`).

### Quality gates (per user standard: run before any commit)
- `npm run lint`, `npm run typecheck` (TS strict), `npm test` (vitest), E2E (`playwright`) all green. Confirm exact scripts in `cloud/package.json`.

---

## 6. Honesty & security considerations

This product's core value is **honesty** — these are first-class acceptance criteria, not afterthoughts:

1. **Never present unseen data as measured.** Suggestion generators return `undefined` when they lack real input (unknown category, no description) — the card then shows no suggestion rather than a fabricated one. This is the same `#41`/`#56`/`#65` discipline already in the engine (e.g. `screenshots_unknown` at `:234`, the unseen-field handling in `coverageFieldBreakdown` at `app.js:1250`). A1/A2/A3 already established "unknown ≠ a guessed value"; B must not reintroduce fabrication via plausible-sounding suggestions.
2. **Confirmed vs inferred framing.** `primary_category_context` is reframed to say ShipASO *confirmed* it from the ASC read (because it did). Conversely, secondary-category/CPP/preview suggestions are clearly framed as *recommendations* ("ShipASO suggests"), never as something already set or measured.
3. **The agent NEVER auto-pushes.** Suggestions are advisory copy only. No new ASC write path; secondary-category and CPP suggestions do not apply changes to ASC. The approval gate (`gateCard`, `app.js:1010`) remains the only path to any push, unchanged.
4. **Never persist the `.p8`.** No change to credential handling. The `.p8`/keyId/issuerId arrive in the `run-asc` request, mint an ephemeral JWT, and are never persisted/logged/returned (`api/index.ts:931-933`, comment at `:909-915`). Suggestions are derived from the snapshot read with that ephemeral token; the token itself never reaches the engine or the client.
5. **Privacy boundary intact.** Suggestion text is curated/derived copy carried on `Finding` (which already crosses the boundary). Raw snapshot fields (pricing numbers, full locale copy, description text, privacy text, URLs) stay server-side. `ascContext` is untouched; its `FORBIDDEN_CONTEXT_KEYS` guard (`ascContext.ts:42`) still holds. Add the E2E DOM-leak assertion (§5) to lock this. **Watch item:** description-derived keywords could echo listing copy into a suggestion — keep suggestions to short, generic phrasing (category-template + at most a sanitized keyword), never verbatim description sentences.
6. **Deterministic, no hidden network.** The engine stays pure/network-free (`auditFindings.ts:11`). Optional LLM enrichment lives only in the API layer behind the existing guarded `reasonerForEnv` and can never break or block a run (failure → deterministic fallback), matching the keyword-reasoner posture.

---

## 7. Risks & rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| A generic/stale suggestion reads worse than a clean link ("template smell") | Med | Curate per-category templates; gate behind unit tests asserting they name the real category; ship LLM enrichment as fast-follow for app-specificity. |
| Suggestion fabricates a recommendation for an app it can't read well | Med | Return `undefined` when category unknown; framed as "suggests," not "set/measured"; unit test the unknown→undefined path. |
| Listing-status strip hides a finding the user expected to act on (e.g. `version_no_draft` matters when they want to push) | Low | Strip is visible (demoted, not hidden); `version_no_draft` is genuinely "create a version first," which is contextual to pushing, not an ASO fix. Revisit if users miss it. |
| `locale_single` mis-bucketed (status vs ranking fix) | Med | DECISION in §8; default keeps it a fix. |
| Privacy regression — description text leaks into a client-visible suggestion | Low/High-impact | E2E DOM-leak assertion; keep suggestions short/generic; code review against `FORBIDDEN_CONTEXT_KEYS` intent. |
| Older runs lack `kind`/`suggestion` | Low | Both optional; `kind` absent ⇒ treated as `fix`; card degrades cleanly (same as the `findings_summary ?? null` pattern at `api/index.ts:839`). |

**Rollout.** Single PR off a feature branch (never commit to `main` directly; never push without explicit owner approval, per user workflow standards). Sequence: (1) engine types + `kind` tagging + tests (C); (2) `findingSuggestions` module + wiring + tests (B); (3) `app.js` status strip + suggestion rendering + styles; (4) mock + E2E; (5) optional LLM enrichment as a follow-up PR. No data migration. No feature flag needed — purely additive to the findings payload and additive UI. Verify against the Mangia run that produced the original report before requesting approval.

---

## 8. Effort & DECISION needed

**Effort: M** (Medium).
- C (kind tagging + status strip + UI): **S** — mechanical, additive, well-isolated.
- B deterministic suggestions (new module + wiring + tests + UI): **M** — the work is the category-affinity/template tables and getting the copy right, not the plumbing.
- Optional LLM enrichment: **S** as a separate follow-up.

**Needs a product DECISION from the owner before building:**
1. **`locale_single` — fix or context?** The issue lists "Live in 1 locale" under C (noise), but it's a genuine ranking lever (each localization is a new keyword surface). Default plan: keep it a `fix` (warn/ranking). Owner should confirm whether to demote it to the status strip. *(This is the only true ambiguity; the rest of A/B/C is unambiguous.)*
2. **Suggestion depth at launch — deterministic-only vs LLM-enriched.** Recommend shipping deterministic templates first (honest, testable, no binding dependency) and adding LLM enrichment as a guarded fast-follow. Owner should confirm that ordering, and confirm the bundled secondary-category affinity map (esp. the Food & Drink → Health & Fitness / Lifestyle mapping the issue calls out) reflects how they want ShipASO to advise.
3. **CPP angle voice.** CPP suggestions imply a paid-acquisition mental model ("a CPP per ad set"). Confirm that framing matches the product's intended audience before baking it into templates.

Everything else (A regression locks, B confirmed-framing, the suggestion fields, the status strip) is unambiguous and implementation-ready as specified above.
