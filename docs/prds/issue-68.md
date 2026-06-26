# PRD — Flag duplicate / near-duplicate screenshots (issue #68)

**Status:** Draft for owner review · **Effort:** S–M (small-to-medium) · **Launch-criticality:** Post-launch (not launch-blocking) · **Needs a product DECISION before building:** YES — one decision (see §9).

---

## 1. Problem & context

### What we observed
From a live Mangia review: the app ships **15 screenshots**, but several are **near-duplicates** — multiple "Weekly Market Haul" / grocery-list variants and repeated pantry views. Apple emphasizes the first 3–5 slots; each shown slot should sell a **distinct** value prop. Repeats burn scarce conversion slots and cost installs.

### What's broken / missing
The screenshot auditor scores only **structural** properties and is blind to duplication:

- `cloud/src/engine/screenshotScore.ts` (`score()`, lines 104–202) awards points for **count** (up to +50, the biggest lever), **iPad presence** (+15), **aspect ratio** (+20), and a neutral caption credit (+8). It never compares shots to each other.
- Consequence: a listing with **15 near-identical** shots scores **identically** to 15 distinct ones. The count lever even *rewards* the padding (`pts += n >= 6 ? 50 : 40`, line 147). The grade is therefore **misleading** for the exact case that hurts conversion.

### Why it matters
Screenshots are the single biggest conversion lever in the audit's point budget, and the audit's whole promise (PRD 01 findings engine, `cloud/src/engine/auditFindings.ts`) is to tell an owner the *real* wins. "You have 15 shots, grade A" while five are repeats is the kind of false comfort this product exists to eliminate.

### Why we can do this honestly now
We already read the two signals needed for a **real, substantiable** duplicate call from App Store Connect — we're just throwing them away before scoring:

- `cloud/src/engine/ascRead.ts` `mapScreenshot()` (lines 114–126) captures **`fileName`** (`a.fileName`, line 124) and the **`imageTemplate`** URL (`a.imageAsset.templateUrl`, line 116) per asset. These are persisted on the `AscScreenshot` type (lines 41–51).
- But the bridge into the scorer, `ascScreenshotsToListing()` (lines 639–659), maps each shot to **only its `imageTemplate`** (line 653) and **discards `fileName` and the asset identity**. So today the duplicate signal never reaches the audit.

The raw `AscScreenshotSet` *does* survive on `snapshot.screenshots` (`AscSnapshot`, line 589) and is already passed into `auditFindings` via `input.snapshot`. That is the honest, ASC-only place to compute duplicates.

---

## 2. Goal & non-goals

### Goal
When (and **only when**) we have trustworthy ASC asset metadata, detect screenshots that are duplicates/near-duplicates **we can substantiate** — by matching **filenames** and/or **image-asset identity** — and surface a single, honest **informational** finding: *"N of your M screenshots appear to be near-duplicates — distinct shots in each slot convert better."* It is a **conversion lever**, not a ranking claim.

### Non-goals
- **No score penalty.** Start as an *informational* finding only (`severity: "info"`). We do not subtract from the `screenshotScore` grade on a heuristic. (Tighten later once the signal is proven reliable — issue follow-up, not this PRD.)
- **No perceptual hashing / byte fetching in this issue.** Pixel-level pHash is explicitly out of scope for v1 (it's the "heavier, optional" path in the issue). We do not fetch image bytes; we reason only over metadata we already have. A future issue can add pHash *if grounded*.
- **No duplicate detection on the public-iTunes path.** The public `itunes/lookup` results consumed in `cloud/src/engine/agent.ts` `audit()` (lines 150–182) carry **no `fileName` and no stable asset id** — only CDN URLs that differ per asset even for identical images. We cannot substantiate duplicates there, so we say **nothing** (honesty guardrail, §6).
- **No OCR / caption-text comparison.** Out of scope.
- **No auto-fix / auto-push.** We surface the finding and a fix hint only. The agent never edits or pushes screenshots.

---

## 3. Proposed approach (grounded in real files)

### 3.1 Where the detection lives
Add a **pure, deterministic, network-free** detector and wire it into the existing findings engine — the same shape and constraints as every other rule in `auditFindings.ts` (no fetch, no `Date.now`, graceful on undefined; lines 10–17).

The detector consumes the **raw ASC snapshot** (which has `fileName` + asset identity), not the flattened `Listing` (which has lost them). The natural input is `snapshot.screenshots` (`AscScreenshotSet`) inside `screenshotFindings()`.

### 3.2 The honest signals (in priority order)

Operate on **one representative device set** to avoid the cross-size inflation already handled in `ascScreenshotsToListing` (see the `#70` comment, lines 643–654): the same logical shot is stored once per display size (`APP_IPHONE_65`/`_67`/`_55`…), so comparing across sizes would report every shot as a "duplicate" of its other-size twin. We dedup **within the most-complete single device set** (the family's best slot usage), mirroring the existing `representative()` reducer (lines 650–654).

Within that set, two shots are flagged as a substantiated duplicate when **either**:

1. **Identical filename** — `a.fileName === b.fileName` (case-insensitive, trimmed), both present and non-empty. STRONG, real signal (issue calls this out explicitly). Apple does not force unique filenames, so reused source files (`haul.png` uploaded to slots 3 and 7) are a genuine, common duplicate pattern.
2. **Identical image-asset identity** — the stable part of `imageTemplate`. The `templateUrl` looks like `…/PurpleSource…/v4/<a>/<b>/<c>/<source-file>.png/{w}x{h}bb.{f}`. The same underlying asset reused across slots yields the **same source path** (the `<a>/<b>/<c>/<file>` segment) with only the `{w}x{h}` token differing. We compare a **normalized asset key** = the `imageTemplate` with the trailing `{w}x{h}…{f}` size token stripped. (We already have a size-token regex to reuse/adapt: `aspectFromUrl`, `screenshotScore.ts` lines 81–84.) Identical normalized key ⇒ same asset ⇒ a real duplicate.

A pair is a duplicate if it matches **(1) OR (2)**. Both are exact-match, substantiated signals — no fuzzy thresholds, no invented precision.

> **"Near-duplicate" scope for v1:** we deliberately interpret "near-duplicate" as *substantiated reuse of the same source file/asset across multiple slots* (the Mangia case), not pixel-similarity of two different files. This keeps every claim backed by data. The finding copy must therefore say "appear to be the **same** image reused" rather than implying we measured visual similarity (see §6).

### 3.3 What we compute and report
- Group the representative set's shots into **duplicate clusters** (union-find or a `Map<key, count>` keyed by `fileName ?? assetKey`).
- `duplicateCount` = (sum of cluster sizes for clusters of size ≥ 2) − (number of such clusters) = the number of shots that are **redundant** (i.e., "N slots wasted"). Example: 5 distinct + a 3-of-a-kind + a 2-of-a-kind across 10 shots ⇒ redundant = (3−1)+(2−1) = 3.
- `totalShots` = representative set length (M).
- Emit the finding **only when `duplicateCount ≥ 1`**.

### 3.4 The finding (modeled on existing screenshot findings)
Add to `screenshotFindings()` in `auditFindings.ts` (the rule set lives at lines 176–249), using the existing `mk()` factory (lines 131–145):

```
id:       "screenshots_duplicate"
surface:  "screenshots"
severity: "info"               // never penalizes; informational only (non-goal §2)
impact:   "conversion"         // same lane as the other screenshot findings
title:    `${dupCount} of your ${total} screenshots look like reused images`
detail:   "Some slots appear to repeat the same source image. Apple emphasizes the first 3–5 slots — each distinct shot can sell a different value prop, so repeats leave installs on the table."
fix:      "Replace the repeated slots with screenshots that each highlight a distinct feature or benefit."
evidence: `${dupCount} of ${total} appear to reuse a screenshot already in the set`
```

**Gating (honesty):** fire **only** when `input.hasAscKey === true` **and** `snapshot.screenshots?.dataReliable === true` (the type pins this to `true` for ASC reads, `ascRead.ts` lines 70–71). On the no-key / public-iTunes path, `screenshotFindings` already produces `screenshots_unknown`; the duplicate rule simply returns nothing there.

### 3.5 Why not also surface it via `screenshotScore.findings[]`?
`screenshotScore.score()` consumes the flattened `Listing` (no `fileName`/asset id) and is also called on the unreliable iTunes path (`agent.ts:163`). Putting dedup there would either be impossible (no signal) or risk firing on unreliable data. Keeping it in `auditFindings` (which has the raw, ASC-gated snapshot) is the clean, honest seam. The `Listing` type and `score()` stay **unchanged**.

---

## 4. Exact files to change + new files

### New files
| File | Purpose |
|---|---|
| `cloud/src/engine/screenshotDuplicates.ts` | Pure detector: `findDuplicateScreenshots(set: AscScreenshotSet): { totalShots: number; duplicateCount: number; clusters: …[] }`. Exports a `normalizeAssetKey(imageTemplate)` helper (strips the size token) and a `representative(sets)` selector (or reuse/extract the one in `ascRead.ts`). No imports beyond types; no I/O. |
| `cloud/src/engine/screenshotDuplicates.spec.ts` | Colocated unit tests (`*.spec.ts`, TDD-first — see §5). |

### Changed files
| File | Change |
|---|---|
| `cloud/src/engine/auditFindings.ts` | In `screenshotFindings()` (lines 176–249): import + call `findDuplicateScreenshots(input.snapshot?.screenshots)`, gate on `hasAscKey && dataReliable === true`, push the `screenshots_duplicate` finding when `duplicateCount ≥ 1`. No change to sort/scoring (lines 102–104 already weight `info` correctly). |
| `cloud/src/engine/auditFindings.spec.ts` | Add a `describe("screenshots_duplicate")` block; extend the `healthySnapshot()`/`shot()` fixtures (lines 17–74) with screenshot rows carrying `fileName`/`imageTemplate` so duplicate and non-duplicate cases are exercised. |
| `cloud/src/engine/screenshotDuplicates.spec.ts` | (new, above) |

### Files explicitly NOT changed
- `cloud/src/engine/screenshotScore.ts` — scorer + `Listing` type untouched (no penalty; §2).
- `cloud/src/engine/ascRead.ts` — `ascScreenshotsToListing` stays as-is; we read duplicates off the **raw snapshot**, not the flattened listing. (Optional: a one-line doc comment noting the raw set is the dedup source. No behavior change.)
- `cloud/src/engine/agent.ts` — public-iTunes audit path stays silent on duplicates (no signal there).
- `cloud/public/app.js` — **no change required**. Findings render through the existing generic list (the audit findings card, ~lines 1013–1076); a new `info`/`conversion` finding renders automatically with the existing impact chip. (Optional polish — a tiny visual marker on duplicated thumbnails in the gallery, ~line 1032 — is a separate follow-up, not in scope.)

---

## 5. Test plan (TDD, `*.spec.ts`, strong assertions, parameterized)

Follow the repo's TDD order: scaffold the detector stub → write failing specs → implement. Run `npm test` (vitest) and `npm run typecheck`/lint as the quality gate before any commit.

### 5.1 Unit — `screenshotDuplicates.spec.ts` (pure, zero mocking)
- **Filename match:** two shots with the same `fileName` → `duplicateCount === 1`; assert the cluster groups exactly those two ids.
- **Filename match is case/space-insensitive:** `"Haul.png"` vs `" haul.png "` → flagged.
- **Asset-identity match:** two shots, same source path, **different size tokens** (`…/abc/def.png/1290x2796bb.png` vs `…/abc/def.png/1242x2688bb.png`) → flagged via `normalizeAssetKey` (proves we strip the size token, not naive string-equality).
- **`normalizeAssetKey`:** parameterized table — templated `{w}x{h}bb.{f}` form, resolved `1290x2796bb.png` form, and `{c}` crop form all normalize to the **same** key for the same source; different sources → different keys.
- **No false positives:** M distinct filenames + distinct asset keys → `duplicateCount === 0`.
- **Redundant-count math:** parameterized — a 3-of-a-kind + a 2-of-a-kind among 10 shots → `duplicateCount === 3`; a single 2-of-a-kind → `1`.
- **Cross-size inflation guard:** an `AscScreenshotSet` with the *same* logical shots replicated across `APP_IPHONE_65/_67/_55` device sets → detector uses **one representative set** and reports `0` duplicates (the replication across sizes is NOT a duplicate). This is the load-bearing honesty test mirroring `#70`.
- **Missing data is silent:** shots with `fileName` undefined **and** no usable `imageTemplate` contribute no false match; an empty set → `0`.
- **Determinism:** same input twice → identical output (matches the engine's determinism contract, `auditFindings.spec.ts:613`).

### 5.2 Unit — `auditFindings.spec.ts`
- **Fires on ASC duplicates:** input with a reliable snapshot whose representative set has a reused filename → `ids(input)` contains `"screenshots_duplicate"`; assert `severity === "info"`, `impact === "conversion"`, and the title/evidence contain the real `dupCount`/`total` (strong assertion on the substantiated numbers — never a hard-coded literal unrelated to the fixture).
- **Honesty gate — no key:** `input({ hasAscKey: false, snapshot: undefined })` → does **not** contain `"screenshots_duplicate"` (it already yields `screenshots_unknown`).
- **Honesty gate — unreliable data:** a snapshot where `screenshots.dataReliable` is not `true` (simulating the public path) → no duplicate finding.
- **No duplicates → no finding:** healthy snapshot with distinct shots → `"screenshots_duplicate"` absent.
- **Coexists with grade findings:** a thin *and* duplicated set still emits both `screenshots_thin` and `screenshots_duplicate`, and the sort order (lines 691+) keeps `info` below `warn`/`critical` — assert relative order.

### 5.3 E2E (Playwright, `cloud/tests`, `playwright.config.ts`)
Only if an existing run-page E2E already asserts on findings copy. If so, add a fixture/assertion that a run with a known duplicated ASC set renders the duplicate finding text in the audit card. If no comparable finding E2E exists, **skip E2E** for this issue — the logic is fully covered by deterministic unit tests (the engine's design intent, `auditFindings.ts` lines 5–8) and adding browser coverage for a pure rule is low-value.

---

## 6. Honesty & security considerations

This product's core value is **honesty — never present unseen data as measured.** Concretely:

- **Substantiation only.** We flag a duplicate **only** when `fileName` or normalized asset identity **exactly matches** — both signals are read directly from ASC, never inferred. No fuzzy threshold, no invented similarity score.
- **Say nothing when we can't tell.** On the no-key / public-iTunes path there is no `fileName` and no stable asset id, so we emit **no** duplicate finding and **no** count — exactly the discipline the issue calls out (same as #65/#66, and consistent with the existing `dataReliable === false` → `"?"` handling in `screenshotScore.ts` lines 117–133). We never invent a duplicate count.
- **Wording must not overclaim.** Because v1 substantiates *reuse of the same source/asset* (not pixel similarity), copy says "look like reused images" / "appear to repeat the same source image" — not "we detected visually similar screenshots." We do not claim a measurement we didn't make.
- **Informational, not punitive.** `severity: "info"`, no score change. We don't let a heuristic degrade a grade until the signal is proven (issue's explicit instruction).
- **No `.p8` persistence.** This feature reads the already-captured `AscSnapshot`; it issues **no new ASC calls** and never touches credentials. The signing key (`.p8`) and ASC token are never read, logged, returned, or persisted by this code — the detector is pure over in-memory snapshot data (the snapshot itself is server-side only; only the resulting `Finding` crosses the client boundary, per the PRD 02 privacy boundary noted at `api/index.ts` ~lines 996–1008).
- **Agent never auto-pushes.** The finding's `fix` is advice only. No screenshot is edited, uploaded, or pushed; nothing is staged for ASC/Play. Consistent with `buildPushCommands` producing **non-executed** handoff commands (`agent.ts:184`).
- **Privacy boundary preserved.** Only the `Finding` (title/detail/fix/evidence strings + the two integers) reaches the client. Raw filenames/asset URLs stay server-side; `evidence` carries only the **counts** (`N of M`), never the filenames themselves — avoids leaking source-file naming.

---

## 7. Risks & rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cross-size replication misread as duplicates | Med if naive | Dedup within **one representative device set** (mirrors `ascScreenshotsToListing`'s `#70` fix); explicit guard test (§5.1). |
| Filename collision that isn't a real visual dup (two genuinely different shots both named `final.png`) | Low–Med | Accept as v1 limitation; finding is `info` ("look like"), reversible by the owner, no penalty. Tighten later with the optional pHash path. |
| ASC stops returning `fileName` for some assets | Low | Asset-identity (normalized `imageTemplate`) is an independent fallback signal; if both absent, that shot is simply not comparable (silent). |
| Over-firing annoyance | Low | Single finding, `info` severity, only when `dupCount ≥ 1`; sorts below real problems. |

**Rollout:** Pure additive logic behind the ASC-key gate. Ships dark to no-key users (never fires). No migration, no schema change (`cloud/schema.sql` untouched), no new env/config. No feature flag needed given `info`-only severity; if desired, a one-line constant `ENABLE_DUP_FINDING` could gate it, but it's not warranted. Verify against the real Mangia listing post-merge (expect it to flag the repeated "Weekly Market Haul" shots) as the acceptance check.

---

## 8. Effort estimate

**S–M.** One small pure module (~60–90 LOC incl. types) + its spec, plus ~15 LOC and a `describe` block in the existing findings engine/spec. No UI, no API surface, no schema, no new network calls. Most of the work is the test matrix (§5), not the implementation. Estimate: **~0.5–1 day** including TDD and the Mangia acceptance check.

## 9. Product DECISION needed before building

One decision for the owner:

> **Q: For v1, is "duplicate" = substantiated reuse of the same source file / image asset across slots (filename + asset-identity exact match), with NO pixel-similarity (pHash) and NO score penalty — surfaced as an `info` finding only?**

This PRD assumes **yes** (the honest, no-false-precision reading of the issue, and the issue itself says "do NOT penalize the score on a weak guess; start as an informational finding"). If the owner instead wants pixel-level near-duplicate detection in v1, that requires fetching image bytes + a pHash library and is a materially larger (L) effort with its own honesty review — out of scope here and best as a follow-up issue once this exact-match signal is proven reliable.

Everything else in this PRD is implementation-ready and needs no further input.

