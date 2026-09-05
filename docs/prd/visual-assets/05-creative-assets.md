# PRD 05 — App Store creative assets + Asset Library (Phase A now, Phase C gated)

> Apple is adding **creative assets** (product page headers, search-results
> assets) and **Asset Library** (upload + pre-approve, decoupled from a version)
> — [announced Aug 5, 2026](https://developer.apple.com/news/?id=kug6m2ea),
> **"coming this fall."** This plans what we ship *before* the API exists (an
> ASO-aware brief, and a correction to a claim we currently get wrong) and what
> stays parked until Apple publishes the endpoints. Tracking: #436.

## What Apple announced (and what is verifiable today)

| Piece | Where it appears | Status |
|---|---|---|
| **Creative assets** | Product page header, **search results**, CPP/PPO, In-App Events, Apple Ads | Fall |
| **Asset Library** | Upload, manage, **approve in advance**, decoupled from version submission | Fall |
| **Product Page Preview Tool** | Visualize header + metadata + search asset pre-publish | Fall |
| [Best practices + Figma/PS/Pixelmator templates](https://developer.apple.com/app-store/asset-best-practices/) | — | **Shipped Aug 5** |

**Unverifiable as of this PRD — do not design against it:**
- **No published API surface.** Apple's marketing says Asset Library is
  automatable via the ASC API; the `uploading-assets-to-app-store-connect` doc
  page returns no body. No endpoint paths, no resource type names, no
  `creativeAssets` schema.
- **No `asc` support.** `asc 3.3.0` has zero asset / creative / video-preview /
  product-page commands. Gated on Rork — outside our control.
- **No dimensions or formats** for headers or search-results assets. The only
  stated ratios (In-App Events 16:9 card / 9:16 detail) are pre-existing.

Re-verify all three before writing a line of Phase C code.

## The correctness problem we ship today

`KEY_SLOTS = 3` encoded *"the first N are what most users see"* and drove
user-facing copy — **"the first 3 carry most installs"** — in **seven** sites
across both sides of the mirror:

| File | Sites |
|---|---|
| `lib/aso_screenshot_score.py` | constant comment + finding copy |
| `cloud/src/engine/constants.ts` | `KEY_SLOTS` comment |
| `cloud/src/engine/screenshotScore.ts` | 4 copy sites |
| `cloud/src/engine/auditFindings.ts` | the `screenshots_grade_low` fix string |
| `docs/prd/asc-findings/05-surface-findings-spec.md` | the spec governing that finding |

A dedicated **search-results creative asset displaces screenshots 1–3 in
search**. For an app that has one, that sentence is false. This is a
measured-or-nothing violation, not a copy nit: we assert a conversion claim
about a surface that may no longer be the surface.

**Out of scope:** `cloud/src/engine/play/playFindings.ts` carries the same
sentence, but it is Google Play — Apple's creative assets do not touch it, so
the claim holds there and must not be "fixed" by a future sweep.

**Constraint:** `KEY_SLOTS` is mirrored Python ↔ TypeScript by design
(`AGENTS.md`, and the `lib/` ↔ `cloud/src/engine/` mirror). Any change lands on
both sides or explicitly breaks the mirror with a comment saying so.

## Phase A — ship now (no API dependency)

### A1. Qualify the claim — ✅ DONE
The causal claim is replaced by a positional one in all seven sites:

> "the first 3 **carry most installs**" → "the first 3 **are what search shows
> today**"

The new form states what is on screen (verifiable now, and true until Apple
ships the search-results asset) instead of asserting a conversion outcome we
cannot measure. Both `KEY_SLOTS` definitions carry a comment explaining why it
is positional, naming the fall change, and pointing at the other side of the
mirror.

Gates: 200 Python tests, 2361 TS tests, `tsc --noEmit` clean.

**Still open for Phase C** — once Asset Library is readable, the copy should
branch on whether a search-results asset actually exists, and show `—` when
unknown rather than assuming absence from an unread field.

### A2. The creative-asset brief (the differentiator)
Direct sibling of PRD 02's `screenshotBrief` — same fusion, new surfaces.
`cloud/src/engine/creativeAssetBrief.ts`, pure:

```ts
export type CreativeSurface = "productPageHeader" | "searchResult";

export type CreativeAssetPlan = {
  surface: CreativeSurface;
  medium: "image" | "video";     // headers accept either; say which and why
  focus: string;                 // what this asset must communicate
  keyword?: string;              // the opportunity it reinforces, if any
  rationale: string;             // the ASO logic — why this, this surface
  specsKnown: boolean;           // false until Apple publishes dimensions
};

export type CreativeAssetBrief = {
  assets: CreativeAssetPlan[];
  note: string;                  // honesty frame incl. "specs unpublished"
};

export function creativeAssetBrief(input: {
  opportunities?: Opportunity[];
  audit: Audit;
  copy?: { name?: string; subtitle?: string; description?: string };
  competitors?: CompetitorListing[];
  brandPalette?: BrandPalette;
}): CreativeAssetBrief;
```

- **Search-results asset** leads with the top winnable keyword — it is the
  first thing a searcher sees, so it inherits shot 1's job from PRD 02.
- **Header** carries brand / seasonal / what's new — the thing screenshots
  can't do, per Apple's "go beyond in-use visuals."
- `specsKnown: false` until dimensions are published. The brief describes
  *content*, never a pixel size we'd be inventing.

### A3. Findings — ✅ BUILT (one of the two)
`creative_asset_plan` (`cloud/src/engine/auditFindings.ts`, catalogued in
`docs/prd/asc-findings/05-surface-findings-spec.md`): rides
`screenshots_grade_low` — the weaker the deck, the more the asset that
replaces it in search matters. Its fix is the brief's search-results focus
(A2), so the top MEASURED keyword reaches the user through a surface that
already exists; unscored opportunities never lead. `info` severity: counted in
neither the critical/warn tally nor the label, and `context` is unset so it
still reads as a prompt. `opportunities` now flow into `auditFindings` from all
three call sites (api runApp, api ASC run, MCP `app_findings`).

**Deliberately not built:** "no creative assets planned" and "search-results
asset absent." Both assert an absence we cannot read — Asset Library has no API
yet — and a finding that fires on an unread field is the measured-or-nothing
violation A1 removed. They move to Phase C with the read.

## Phase C — gated on Apple publishing the API

Not scheduled. Each item starts with re-verifying the doc page.

1. **Read** — Asset Library into `AscSnapshot` alongside `previews`
   (`cloud/src/engine/ascRead.ts`), behind `tryRead()` so a failure never
   aborts the audit. Unlocks measured findings + the real `KEY_SLOTS` fix.
2. **Upload** — `cloud/src/engine/ascUpload.ts` already implements Apple's
   3-step reservation (POST → PUT slices → PATCH `uploaded:true` + MD5
   `sourceFileChecksum`). It *likely* extends to creative assets; that is a
   hypothesis to test, not a design.
3. **`asc` wiring** — only once the commands exist.
4. **Video** — headers accept video, which pressures
   `docs/prds/issue-26.md:43` ("No video / app-preview generation. Screenshots
   only") and the unused `asc video-previews`. Reopen deliberately, not by
   drift.

## The approval question (decide before Phase C)

Asset Library adds **store-side pre-approval**. We already have human-side
approval: `awaiting_approval → approved` (`cloud/schema.sql:13-17`) and the
`review_gate` in `.asc/workflow.json` ("The STOP … DO NOT upload").

Two gates now exist in sequence. **Approval is still the terminus** — but the
sentence gets harder, and the invariant must survive it: ShipASO "approved"
means *approved to submit to Apple's asset review*. Submitting to Asset Library
is **not shipping**; Apple can still reject, and an approved-in-advance asset is
not a live asset. No copy anywhere may imply otherwise.

## Honesty
- Conversion lane, labeled — creative assets drive installs-from-views. The
  **search-results asset is conversion-adjacent at a ranking surface**; say
  "more people choose you from search," never "you rank higher."
- Never state a dimension, format, or duration Apple hasn't published.
- The brief is a starting point, not a guarantee (carries PRD 02's frame).

## TDD
Pure and testable without the API:
- `creativeAssetBrief` puts the top opportunity keyword on the search-results
  asset; header plan is brand/seasonal, not keyword-stuffed.
- `specsKnown === false` for every plan while specs are unpublished, and no
  output string contains a pixel dimension or duration.
- No over-promise language (reuses PRD 02 / `aso-review-risk` claim lint).
- Degrades without opportunities/ASC to a sound best-practice structure.
- **Mirror test — ✅ BUILT.** `cloud/src/engine/screenshotClaimParity.spec.ts`
  (6 tests) pins the two sides together. It reads `lib/aso_screenshot_score.py`
  as source text rather than hardcoding its values — `constants.spec.ts:41`
  asserts `KEY_SLOTS: 3` against a literal, so it catches a TS refactor but
  never a Python one. Three drift modes are covered, each verified by
  deliberately breaking it:
  1. `KEY_SLOTS` diverging between the two languages.
  2. The causal `"carry most installs"` phrasing being reintroduced on either
     side (a regression guard, not just a one-time fix).
  3. The copy being silently reworded — caught by asserting the *rendered*
     finding from `score()`, not only the source text.

  Google Play (`playFindings.ts`) is deliberately excluded, documented in the
  spec's header so a future sweep doesn't "fix" a claim that is still true there.

## Acceptance
- ✅ The "first 3 carry most installs" claim no longer asserts something a
  search-results asset can falsify — corrected in all **seven** sites, both
  sides of the mirror, with Google Play deliberately left alone.
- `creativeAssetBrief` produces per-surface plans with rationale tied to real
  ASO data, and never invents a spec.
- Phase C is documented as blocked with the exact unblock condition (Apple
  publishes the endpoints; `asc` adds commands) — not silently deferred.
