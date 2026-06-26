# PRD — Screenshot improvement panel: quantified "C→B→A" levers next to the gallery

**Issue:** #55
**Owner:** product engineer
**Status:** Ready to build (one product DECISION flagged in §8)
**Effort:** **S–M** (pure-logic core S; UI + wiring M)

---

## 1. Problem & context

### What exists today
The screenshot grade is a deterministic **structural** score computed by `score()` in `cloud/src/engine/screenshotScore.ts:117-201`. It awards points across four levers:

- **count** — `screenshotScore.ts:135-152`: `0 → +0`, `<GOOD_MIN(4) → +20`, `4–5 → +40`, `≥6 → +50`
- **iPad** — `screenshotScore.ts:154-161`: present `→ +15`, none `→ +5`
- **aspect** — `screenshotScore.ts:163-184`: tall (h/w ≥ `TALL_RATIO` 2.0) `→ +20`, other `→ +10`, no dims `→ +10`
- **caption** — `screenshotScore.ts:186-192`: always the neutral `+8` (we don't fetch images here)

Grade thresholds are in `gradeFor()` at `screenshotScore.ts:95-101`: `A≥85 B≥70 C≥50 D≥30 else F`. Constants live in `cloud/src/engine/constants.ts:35-40` (`SCREENSHOT.{MAX_SLOTS, GOOD_MIN, KEY_SLOTS, TALL_RATIO}`).

The Mangia example from the issue (5 iPhone, 0 iPad, ratio 1.78): `40 + 5 + 10 + 8 = 63 → C`.

Issue #47 already ships the **gallery** — `screenshotGallery()` in `cloud/public/app.js:1106-1138` renders the real shots inside the listing-audit card (`listingAuditCard()` at `app.js:1149-1216`, gallery pushed at `app.js:1202-1203`), next to the grade chip (`gradeChip()` at `app.js:1031-1038`).

### What's missing
The grade tells the user **"C"** but not **"here is exactly how to get to B, and what it costs."** The score object already *knows* every deficit and the precise point delta to fix it — but that knowledge is thrown away. The only fix path today is the generic, non-quantified `fixLinkFor("screenshots_grade_low")` / `"screenshots_thin"` linkouts (`app.js:1074-1096`) to the ParthJadhav/app-store-screenshots skill. The user sees a grade and two static "build more screenshots →" links, with no sense of priority, magnitude, or the resulting grade.

### Why it matters
This is the actionable follow-on to the gallery. The product's value is **the loop that ships your metadata and proves the rank moved** — and the screenshot grade is currently a dead-end number. Converting it into prioritized, quantified levers ("Add a 6th screenshot → +10 → C becomes B") turns a passive score into a concrete worklist, while staying honest (CONVERSION framing, no fabricated measurements).

---

## 2. Goal & non-goals

### Goal
Render an **improvement panel** next to the existing gallery that converts the `ShotScore` into **prioritized, quantified, grade-aware levers**:

- Each lever shows: a plain-language action, the **point delta**, and the **resulting grade** (e.g. `"Add a 6th screenshot → +10 pts (C → B)"`).
- Levers are **sorted by point delta desc** (biggest win first), so the user sees the highest-leverage move at the top.
- The panel wires the existing ParthJadhav/app-store-screenshots skill linkout as the "make-it" tool ("Generate the missing shots with this skill").

### Non-goals
- **No new scoring dimensions.** Levers are derived from the *existing* four-lever budget; we do not add OCR/design/copy judgment.
- **No backend re-architecture.** The `ShotScore` already rides to the client on `R.audit.screenshots` (`app.js:1032`); the lever derivation is pure and can live engine-side or client-side (§8 DECISION).
- **No auto-generation of screenshots.** We link to the skill; the agent never generates or pushes assets.
- **No change to the gallery, grade chip, or the "?" unreadable path.**
- **No ranking claims.** Conversion framing only.

---

## 3. Proposed approach (grounded in real files)

### 3a. Pure-logic core: `shotLevers(score: ShotScore): Lever[]`
New exported function in `cloud/src/engine/screenshotScore.ts`, alongside `score()`. It re-derives, for each lever the score already computed, the **delta to the next tier** and the **grade after applying it**:

```ts
export type Lever = {
  id: "count" | "ipad" | "aspect";
  label: string;       // "Add a 6th screenshot"
  detail: string;      // honest caveat / why
  delta: number;       // point gain, e.g. 10
  fromGrade: Grade;    // current
  toGrade: Grade;      // grade if THIS lever alone is applied
  skill?: boolean;     // true → offer the app-store-screenshots skill linkout
};

export function shotLevers(s: ShotScore): Lever[];
```

Rules (each only emitted when there is real headroom — never a no-op lever):

- **count** — if `iphoneCount < 6`: delta is the jump to the next count tier.
  - `<4` shots → going to 4–5 is `+20`, then 6+ is another `+10`; surface the **largest single realistic next step**. Recommend: if `0` → "Add 4+ screenshots → +40"; if `1–3` → "Fill up to 4–5 slots → +N" then the 6+ lever; if `4–5` → "Add a 6th screenshot → +10". This directly addresses the issue's "don't over-congratulate '5 shots (good)'" note.
- **ipad** — if `ipadCount === 0`: "Add iPad screenshots → +10" (present is +15 vs none +5). Mark `skill: false` for now? — see §8: the issue lists this as a +10 lever; keep it but keep the ASC linkout, not the skill (skill targets iPhone decks). **Gate** on whether the app actually ships iPad where we can tell (mirror `shipsIpadButEmpty()` at `auditFindings.ts:251-256`) — otherwise frame as conditional ("if you ship iPad").
- **aspect** — if first shot's ratio `< TALL_RATIO` AND dims are known: "Use modern tall-phone aspect (1290×2796) instead of 16:9 → +10". **Honesty caveat (issue requirement):** the `392×696` size is the iTunes *thumbnail*, not the true upload resolution — the *ratio* is reliable, the pixel size is not. The lever copy must assert the ratio, not the literal pixels. Only emit when `aspectFromUrl()` (`screenshotScore.ts:90-93`) returned dims; if no dims, emit nothing (we can't claim a deficit we can't see).

`toGrade` is computed via the existing `gradeFor()` — which must be **exported** (currently module-private at `screenshotScore.ts:95`). Apply `Math.min(100, score + delta)` then `gradeFor(...)`.

**Honesty gates baked into the function:**
- If `s.grade === "?"` or `s.score === null` → return `[]` (no panel in the unreadable case, per #41).
- Never emit a lever whose `delta <= 0`.
- Sort by `delta` desc; stable for ties (count > aspect > ipad as a sensible default order).

### 3b. Wire the skill linkout (reuse, don't reinvent)
The skill URL already exists at `app.js:1076` (`SHOTS_SKILL = "https://github.com/ParthJadhav/app-store-screenshots"`). The panel's count/aspect levers reuse it as the "make-it" CTA. Hoist `SHOTS_SKILL` to a module-level const if not already reachable from the new render function.

### 3c. UI: `improvementPanel(sc)` in `app.js`
New render function modeled on `screenshotGallery()` (`app.js:1106-1138`). Returns `null` when `shotLevers` yields `[]` (covers the "?" case and the already-A case — an A-grade listing has no headroom and gets no panel, which is honest). Pushed into `listingAuditCard` children right after the gallery (`app.js:1203`), so the panel sits visually beside/under the gallery and grade chip.

Each lever row renders: action label, a delta badge (`+10 pts`), the `C → B` grade transition, the detail/caveat line, and (when `skill`) the "Generate the missing shots with this skill →" linkout. Conversion-framed footer note, mirroring the gallery's note (`app.js:1134-1136`).

**Where the lever data comes from (§8 DECISION):** either (a) `app.js` calls a tiny client-side port of `shotLevers` over `R.audit.screenshots`, or (b) the engine attaches `levers` to the `ShotScore`/audit so the client just renders. Recommendation: compute engine-side and attach, so the TDD'd pure logic is the single source of truth and the client stays a dumb renderer (consistent with how `findings`/`aspectHint` already ride on the score object).

---

## 4. Exact files to change + new files

### Changed
| File | Change |
|---|---|
| `cloud/src/engine/screenshotScore.ts` | Export `gradeFor` (currently private, line 95). Add `Lever` type + `shotLevers(score)` pure function. Optionally attach `levers: Lever[]` to the `ShotScore` return at `screenshotScore.ts:194-201` (engine-side option). |
| `cloud/src/engine/index.ts` | Re-export `shotLevers` + `Lever` type (alongside existing screenshot exports at `index.ts:31-38`). |
| `cloud/public/app.js` | Add `improvementPanel(sc)` (model on `screenshotGallery` at 1106). Hoist `SHOTS_SKILL` to module scope. Push panel in `listingAuditCard` after the gallery (after line 1203). Add CSS classes (`.shot-levers`, `.lever-row`, `.lever-delta`, `.lever-grade`, `.lever-note`) — add styles wherever the `.shots-gallery` styles live (grep the stylesheet for `shots-gallery`). |
| `cloud/src/engine/constants.ts` | (If needed) add a `TALL_TARGET` dims constant `{ w: 1290, h: 2796 }` for the aspect lever copy, near `SCREENSHOT` (line 35) — reuses the existing `SHOT_NATIVE_W/H` values at `screenshotScore.ts:78-79`; prefer importing/reusing those rather than duplicating. |

### New
| File | Purpose |
|---|---|
| *(none required for backend if `shotLevers` lives in `screenshotScore.ts`)* | Keep the lever logic colocated with the scorer (the deficits and the budget are defined there). |
| `cloud/tests/e2e/screenshotImprovementPanel.e2e.ts` | New E2E mirroring `screenshotGallery.e2e.ts` conventions (see §5). |

Tests are colocated `*.spec.ts` per repo convention — the unit tests go in the **existing** `cloud/src/engine/screenshotScore.spec.ts` (do not create a parallel spec file).

---

## 5. Test plan (TDD, repo conventions)

Follow the repo's TDD order: scaffold `shotLevers` stub → write failing tests → implement. Unit specs are `*.spec.ts` colocated with source (Vitest); E2E are `*.e2e.ts` in `cloud/tests/e2e/` (Playwright against the mock dashboard).

### Unit — add to `cloud/src/engine/screenshotScore.spec.ts`
New `describe("shot levers (#55)")` block. Parameterize inputs (no unexplained literals); use the existing `TALL`/`WIDE`/`listing()` helpers at the top of the spec.

- **Mangia case → C with a count lever and an aspect lever, sorted by delta.** `listing(5, 0, WIDE)` → grade `C`; assert a `count` lever (`+10`, `C → B`) and an `aspect` lever (`+10`) are present.
- **`toGrade` is correct** — applying a lever's delta lands on the asserted grade via `gradeFor`. Assert the boundary: a C at 63 + a +10 count lever crosses 70 → `B`.
- **Biggest lever first** — levers sorted by `delta` desc.
- **No no-op levers** — a full tall iPad-backed set (`listing(8, 4, TALL)`, grade A) → `shotLevers` returns `[]` (no headroom).
- **Honesty: "?" / null → `[]`** — `score("x", { screenshotUrls: [], dataReliable: false })` → `shotLevers` returns `[]`.
- **Aspect lever asserts RATIO not pixels** — lever copy for the wide case must mention the tall *ratio*/target `1290×2796` as the GOAL but must NOT assert the user's current pixel size as measured (issue caveat). Assert the detail string does not claim the thumbnail dims are the true upload size.
- **Aspect lever suppressed when dims unknown** — a shot URL with no size token (no `aspectFromUrl` match) → no aspect lever (we can't claim an unseen deficit).
- **count tiers** — parameterize `[0→"add 4+"], [2→fill slots], [5→add a 6th]`; assert the right action + delta per tier.
- **iPad lever gating** — `ipadCount === 0` emits the iPad lever; present → none.

### E2E — new `cloud/tests/e2e/screenshotImprovementPanel.e2e.ts`
Mirror `screenshotGallery.e2e.ts` (same `gotoMockDashboard` / `seedAppWithRun` / `latestRunId` helpers).

- **Panel renders next to the gallery for a readable, sub-A listing** — seed an app whose mock returns a sub-A set; assert `.audit-card .shot-levers` visible, ≥1 `.lever-row`, a `.lever-delta` containing `+`, a grade-transition element (`C → B`-style), and the skill linkout `href` = the ParthJadhav repo.
- **Conversion framing** — `.lever-note` contains `/conversion/i`, never `/rank/i`.
- **No panel in the "?" unreadable case** — reuse the `com.ghost.unreadable` bundle from the gallery E2E; assert `.shot-levers` has count 0 (honesty gate #41).
- **No panel for an A-grade listing** — seed a full tall iPad-backed set; assert no `.shot-levers` (no headroom → no over-selling).

---

## 6. Honesty & security considerations
This product's core value is **honesty** — the design enforces it structurally:

- **Never present unseen data as measured.** The aspect lever must caveat that `392×696` is the iTunes *thumbnail* — the **ratio** is reliable, the pixel size is not (issue requirement). Lever copy asserts the *target* ratio (1290×2796), not the user's current literal pixels.
- **Gate on real shots (#41).** `shotLevers` returns `[]` when `grade === "?"` / `score === null`; the UI renders no panel — the existing "couldn't read — connect App Store Connect" state stands alone. The E2E locks this in.
- **No fabricated levers.** Only emit a lever with real, computed headroom (`delta > 0`). An A-grade listing gets no panel.
- **Don't over-congratulate.** Per the issue, "5 shots (good)" undersells that 6+ scores higher — the count lever explicitly surfaces the "add a 6th → +10" headroom rather than implying the slots are done.
- **CONVERSION, not ranking.** Framing consistent with the gallery note (`app.js:1135`) and the impact chips. No lever may imply a rank change.
- **No `.p8` persistence.** N/A — this feature touches only the already-fetched public/ASC screenshot URLs on `R.audit.screenshots`; it reads no credentials and persists nothing.
- **Agent never auto-pushes.** The "make-it" path is a *linkout* to the ParthJadhav skill for the human to act on. The agent does not generate assets, write to App Store Connect, or push anything.

---

## 7. Risks & rollout

| Risk | Mitigation |
|---|---|
| Lever deltas drift from the scorer if the budget changes | Keep `shotLevers` colocated with `score()` in `screenshotScore.ts` and derive from the same `SCREENSHOT` constants; the unit spec asserts `toGrade` via the real `gradeFor`, so a budget change that breaks the mapping fails CI. |
| Aspect lever over-claiming pixel size | Caveat baked into the function + asserted by a unit test; copy asserts ratio/target only. |
| iPad lever shown for an iPhone-only app | Frame conditionally ("if you ship iPad") and/or gate on `shipsIpadButEmpty()`-style signal where the snapshot is available; default to the conditional copy when we can't tell. |
| Panel clutters the audit card | Render only when there's headroom (sub-A, readable); A-grade and "?" render nothing. Sorted, capped at the three real levers. |
| Client/engine duplication of lever logic | Resolve via §8 DECISION — prefer engine-side compute + attach to `ShotScore`, client renders only. |

**Rollout:** Pure-logic + UI, no schema/migration, no new credentials, no cron. Ships behind the normal deploy. Reversible by not rendering the panel (delete the one `children.push` in `listingAuditCard`). No feature flag needed; the honesty gates make the worst case "panel doesn't show."

---

## 8. Effort & product DECISION

**Effort: S–M.**
- `shotLevers` pure function + unit specs: **S** (well-bounded, the budget already exists).
- `improvementPanel` UI + CSS + E2E + wiring: **M** (new render surface, modeled closely on the existing `screenshotGallery`).

**Needs a product DECISION from the owner before building — two small calls:**

1. **Where lever logic lives.** Engine-side (attach `levers` to `ShotScore`, client renders) vs client-side port in `app.js`. Recommendation: **engine-side** — single TDD'd source of truth, consistent with `findings`/`aspectHint` already riding on the score object. This is the only real architectural fork.
2. **iPad lever's CTA + gating.** The skill (ParthJadhav/app-store-screenshots) is iPhone-deck oriented; the iPad lever likely points to App Store Connect (matching `screenshots_no_ipad` at `app.js:1087`) rather than the skill, and should be gated/conditional on shipping iPad. Confirm the owner wants the iPad lever in the panel at all vs. leaving it in the findings list.

Everything else (delta math, grade transitions, honesty gates, sorting, conversion framing) is determined by the existing scorer and the issue's stated rules — implementation-ready once the two calls above are made.

