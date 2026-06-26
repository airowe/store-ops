# PRD — Studio premium tier: AI-generated App Store screenshots

**Issue:** #26 — Post-launch: "Studio" premium tier — AI-generated App Store screenshots tied to the audit grade
**Status:** PARKED (post-launch, post-revenue). This PRD is a build-ready spec for when the gate lifts. It is NOT a directive to build now.
**Owner DECISION required before building:** YES (see §10).

---

## 1. Problem & context

ShipASO already **grades** an app's screenshots but then **abandons the user at the problem** — which is exactly the failure our wedge mocks ("every ASO tool tells you what to do and abandons you").

Concretely, the grade exists end to end today:

- `cloud/src/engine/screenshotScore.ts:104` `score()` returns a `ShotScore` with `grade: "A"|"B"|"C"|"D"|"F"|"?"`, structural `findings`, and the real `screenshotUrls` / `ipadScreenshotUrls` it graded.
- It's surfaced on the dashboard: `cloud/public/app.js:1031` `gradeChip()` renders "Shots: B", and `cloud/public/app.js:1106` `screenshotGallery()` renders the live shots.
- It's the lead grade on portfolio/app cards: `cloud/src/api/index.ts:689` and `:819` (`auditGrade: result.audit.screenshots?.grade`).

But the "fix path" for a low grade is an **external dead end** — `cloud/public/app.js:1074` `fixLinkFor()` maps `screenshots_grade_low` / `screenshots_thin` to a third-party MIT GitHub repo (`github.com/ParthJadhav/app-store-screenshots`) and "edit in App Store Connect." We grade the screenshots, then send the user away to fix them with someone else's tool.

This matters because:
- **The screenshot half of the loop is open.** Our loop is *audit → fix → push → prove rank moved* (`cloud/src/engine/agent.ts:5`). For copy (name/subtitle/keywords) we close it: `cloud/src/engine/optimize.ts:237` `optimizeCopy()` generates the fix, and `cloud/src/engine/fastlane.ts:20` `buildFastlaneBundle()` ships it. For screenshots we generate **nothing** — there is no screenshot equivalent of `optimizeCopy`.
- **Screenshots are a conversion lever, not a ranking one** (`cloud/public/app.js:1135`). Improving them is the single highest-leverage thing most listings can do, and we currently quantify the gap (grade) without offering the close.
- **We already own every primitive** to close it (see §3) — server-side SVG→PNG, ASO copywriting to exact limits, and the grade. Studio is *deepening the existing loop*, not widening surface area.

**Why Screen Studio / shots.so are the wrong path (from the issue, retained as a non-goal rationale):** Screen Studio is a Mac GUI with no API — reselling it is an affiliate link, not a product, and it makes demo *videos*, not 1290×2796 captioned App Store frames. We generate the assets ourselves.

---

## 2. Goal & non-goals

### Goal
A paid **"Studio" tier** that, for an app whose screenshot grade is below A, generates a **proposed App Store screenshot deck**: per-slot **caption copy** (reusing the copy engine), a recommended **frame order / feature emphasis** (derived from the keyword reasoning we already compute), and **server-side-rendered captioned device frames** at App Store spec (1290×2796 + iPad), delivered through the **existing approval + handoff posture** (the agent never pushes). The before→after grade delta feeds the proof story.

### Success criteria
- A Studio user with a sub-A grade can generate a full proposed deck (one captioned frame per used slot) without leaving ShipASO.
- The deck renders deterministically server-side as SVG (rasterized to PNG client-side or via the existing share-card pattern), self-contained (no external fonts/refs), at 1290×2796.
- Captions are authored from the same keyword/copy engine, within a hard caption char budget, and are **clearly labeled as a proposal** — never asserted as the live listing.
- The deck is gated behind the Studio tier; non-Studio users see an honest, in-context upsell (the existing `asc-unlock`-style CTA pattern).
- A predicted "after" grade is shown as a **projection, explicitly labeled** — never as a measured result (§6).

### Non-goals
- **No video / app-preview generation.** Screenshots only.
- **No pixel-perfect creative design tool**, no drag-and-drop editor, no brand-asset upload pipeline in v1. We render templated device frames with captions; v1 is "good defaults," not Figma.
- **No use of the user's real in-app UI screens captured live.** v1 frames the app's **existing public App Store screenshots** (which we already hold via `screenshotScore` → `screenshotUrls`) into captioned device mockups, or renders caption-forward template frames. We do **not** screen-scrape or auto-capture the running app.
- **No auto-push to App Store Connect.** Studio produces an artifact (PNG deck + a Fastlane `screenshots/` handoff); the human approves and ships it on their own credentialed box, identical to the copy path.
- **No new credential surface.** Studio never needs or persists the `.p8`.
- **No AI image *generation* of fabricated UI** (no diffusion model inventing fake app screens — that would be dishonest, see §6). "AI-generated" here means AI-authored captions + AI-recommended ordering + deterministic frame rendering.

---

## 3. Proposed approach (grounded in real files)

Studio is a new engine module that composes three primitives we already own:

**Primitive A — server-side SVG rendering (the share-card pattern).**
`cloud/src/shareCard.ts:79` `renderShareCardSvg()` already emits a self-contained, branded SVG string at fixed dimensions (1200×630 / 1080×1080) with **no external fonts or refs** (`cloud/src/shareCard.ts:52-54`), served via `cloud/src/api/index.ts:1258` `shareCardRoute()` with `content-type: image/svg+xml` and rasterized to PNG client-side (`:1255`). Studio reuses this exact mechanism at App Store spec: `SHOT_NATIVE_W=1290`, `SHOT_NATIVE_H=2796` are already defined in `cloud/src/engine/screenshotScore.ts:69-70`.

**Primitive B — ASO copywriting to exact char limits.**
`cloud/src/engine/optimize.ts:187` `composeSubtitle()` already composes a natural phrase from ordered candidate terms within a hard budget (`CHAR_LIMITS.subtitle`), de-duping by word and never emitting over-limit. Studio's caption author reuses this composition logic with a Studio-specific caption budget, drawing terms from the run's scored keywords.

**Primitive C — keyword reasoning for feature emphasis / order.**
`cloud/src/engine/keywordReasoner.ts:29` `KeywordReasoning` gives `{ brand, target, dropped }` (the substantiated search intents). The genre→intent seeds (`keywordReasoner.ts:50`) tell us the app's feature themes. Studio derives the **frame order** (most-valuable target intent first, mirroring how the first screenshots "carry most installs" — `screenshotScore.ts:141`) and the **per-slot caption theme** from these targets.

### Flow
1. A **Studio run** (gated) runs the normal agent (`cloud/src/engine/agent.ts`), producing `audit.screenshots` (the grade + real shot URLs) and the scored keywords / `KeywordReasoning`.
2. New engine `buildScreenshotDeck()` takes `{ shotScore, scoredKeywords, reasoning, appName }` and returns a `ScreenshotDeck`: an ordered list of slots, each with `{ index, captionText, theme, sourceShotUrl? }`, plus `predictedGrade` and the `beforeGrade`.
3. New renderer `renderScreenshotFrameSvg(slot, opts)` (sibling to `renderShareCardSvg`) emits a 1290×2796 self-contained SVG per slot — caption band + device frame (optionally compositing `sourceShotUrl` when we hold a real shot, else a clean template panel). Honest by construction: if no real shot URL, the frame is visibly a **caption template**, never a fabricated UI.
4. A new owner-scoped route serves each frame as SVG (mirroring `shareCardRoute`), and a deck route returns the slot manifest. The dashboard rasterizes to PNG and offers download + a Fastlane `screenshots/` handoff.
5. Output flows through the **existing approval gate** — nothing is pushed. The Fastlane handoff (`cloud/src/engine/fastlane.ts`) is extended to optionally include a `screenshots/<locale>/` tree, matching `deliver`'s layout, with the same "we produce the artifact, never hold credentials, never push" guarantee (`fastlane.ts:13-14`).

### Tiering
`cloud/src/billing.ts:15` defines `Tier = "free"|"launch"|"autopilot"|"fleet"` (`cloud/src/d1.ts:30`). Studio is either a **new tier** or an **add-on entitlement**. Recommendation (a DECISION, §10): a **new `studio` tier** so it's a clean Stripe price and a clean gate function `canUseStudio(tier)` alongside `canRunCron()` (`billing.ts:40`). The `users.tier` CHECK constraint in `cloud/schema.sql:28` must be migrated to include `'studio'`.

---

## 4. Exact files to change + new files

### New files
- `cloud/src/engine/screenshotDeck.ts` — pure builder. `buildScreenshotDeck()`, types `ScreenshotDeck`, `ScreenshotSlot`. Derives slot order + caption themes from `scoredKeywords` + `KeywordReasoning`; reuses `composeSubtitle`-style logic from `optimize.ts` for caption text (extract a shared `composePhrase(terms, limit, opts)` helper if needed). Predicts the "after" grade by re-running `screenshotScore.score()` against a synthetic listing reflecting the proposed deck (count/aspect deterministically known) — **labeled as a projection**.
- `cloud/src/engine/screenshotDeck.spec.ts` — pure unit tests (TDD; see §5).
- `cloud/src/screenshotFrame.ts` — pure SVG renderer `renderScreenshotFrameSvg(slot, opts)` at 1290×2796 (+ iPad variant `2048×2732`), self-contained per the `shareCard.ts` contract.
- `cloud/src/screenshotFrame.spec.ts` — pure renderer tests.

### Changed files
- `cloud/src/billing.ts` — add `studio` to a tier handling; add `canUseStudio(tier): boolean`; add `STRIPE_PRICE_STUDIO` to `StripePriceEnv` and `TIER_CONFIG`; extend `tierForPriceId` / `stripeCheckoutParams`. Decide `appLimitForTier('studio')`.
- `cloud/src/d1.ts:30` — extend `Tier` union with `"studio"`.
- `cloud/schema.sql:28` — extend the `tier` CHECK constraint to include `'studio'`; provide an `ALTER`-style migration note (the file already documents that pattern at `:39`).
- `cloud/src/api/index.ts` — add routes under `/apps/:id/...`:
  - `GET /apps/:id/screenshot-deck` → manifest (Studio-gated; `402` for non-Studio, mirroring `cloud/src/api/index.ts:675` portfolio gate).
  - `GET /apps/:id/screenshot-frame/:slot.svg` → one frame SVG (mirror `shareCardRoute` at `:1258`; owner-scoped via `requireOwnedApp`).
  - Wire both into the dispatcher (`cloud/src/api/index.ts:1894-1911` `seg`-based router, next to `share-card.svg` at `:1909`).
- `cloud/src/engine/fastlane.ts:20` — extend `buildFastlaneBundle` to optionally accept a deck and emit `fastlane/screenshots/<locale>/<NN>.png` entries (or a manifest + README explaining the user drops the rendered PNGs in). Keep the empty-field guard discipline (`fastlane.ts:31`).
- `cloud/public/app.js` — replace the third-party dead-end link in `fixLinkFor()` (`cloud/public/app.js:1078-1086`) for `screenshots_grade_low` / `screenshots_thin` with an **in-product "Generate a better deck (Studio)"** CTA. For non-Studio users render the existing `asc-unlock`-style upsell card pattern (`cloud/public/app.js:1053` `ascUnlockCta` is the template). Add a deck preview/download surface near `screenshotGallery()` (`:1106`) — clearly labeled "Proposed — not your live listing."
- `commercial/OFFER.md` — add the Studio tier copy/positioning (tiers are documented there; `cloud/src/billing.ts:9` references it).

---

## 5. Test plan (TDD, `*.spec.ts`, colocated)

Follow the repo's pattern: pure builders/renderers tested with **no DOM and no network** (the `shareCard.spec.ts:5` contract), strong assertions, parameterized inputs.

**Unit — `cloud/src/engine/screenshotDeck.spec.ts`** (write failing tests first):
- Slot **order** puts the highest-value `target` intent first; brand-only inputs degrade gracefully (no fabricated themes).
- Caption text is **within the caption char budget**, never over (parameterize budgets), de-dupes by word (mirror `composeSubtitle` tests in `optimize.spec.ts`).
- When `shotScore.grade === "?"` (unreadable, `screenshotScore.ts:117`) the builder returns **no deck** (honest: we don't propose against unknown data) — assert empty/`null`.
- `predictedGrade` is computed via the real `score()` against the synthetic deck and is returned **as a labeled projection** (a `predicted: true` flag on the field), never merged into the measured `grade`.
- Empty/zero scored keywords → no captions invented (parameterized).

**Unit — `cloud/src/screenshotFrame.spec.ts`:**
- SVG is **self-contained**: assert no external `href`/`url(`/`@import`/remote font (same check style as the share-card "no external fonts/refs" guarantee).
- Dimensions are exactly `1290×2796` (and the iPad variant), `viewBox` matches.
- Caption text is XML-escaped (reuse/escape parity with `shareCard.ts:43` `escapeXml`).
- With no `sourceShotUrl`, the frame renders a **template panel**, not a fake screenshot reference (assert no `<image>` pointing at a fabricated asset).

**Unit — `cloud/src/billing.spec.ts`** (extend existing, `cloud/src/billing.spec.ts`):
- `canUseStudio('studio') === true`; `false` for `free`/`launch`/`autopilot`/`fleet` (decide whether fleet inherits — a DECISION).
- `stripeCheckoutParams('studio', …)` resolves `STRIPE_PRICE_STUDIO`; `tierForPriceId` round-trips.

**E2E — Playwright (`cloud/tests/`, the repo uses `playwright.config.ts`):**
- A Studio user opens an app with a sub-A grade → "Generate deck" → deck preview renders, frames are downloadable, copy is labeled "proposed."
- A non-Studio user sees the upsell CTA (402 from the deck route), **not** a frame.
- Approval/handoff: generating a deck does **not** push anything to ASC (assert no push side-effect; the run stays at the approval gate).

Run all quality gates (lint, typecheck, `vitest`, Playwright) before any commit; never commit without explicit approval (user workflow standard).

---

## 6. Honesty & security considerations (core product value)

This product's value is honesty — these are hard constraints, not nice-to-haves:

1. **Never present unseen or projected data as measured.** The "after" grade is a **prediction** computed deterministically from the proposed deck's structural properties (count/aspect — the only things `screenshotScore` actually measures, `screenshotScore.ts:9-13`). It MUST be rendered with a distinct label (e.g. "projected B → A") and a separate field/flag, never written into `audit.screenshots.grade`. This mirrors the existing `"?" = unknown` honesty branch (`screenshotScore.ts:32`, `:117`) and the no-key "unseen vs empty" discipline (`cloud/src/api/index.ts:970-984`, `cloud/public/app.js:1143` `isNoKeyRun`).
2. **Captions are a proposal, never the live listing.** Every Studio surface labels the deck "Proposed — not your live listing," consistent with how `screenshotGallery` labels the real shots "what your store visitors see" (`cloud/public/app.js:1135`).
3. **No fabricated UI.** v1 frames either the app's **real existing** App Store shots (which we already hold) or honest caption-template panels. We do **not** synthesize fake app screens and present them as the app — that would be the dishonest version of "AI-generated screenshots" and is an explicit non-goal (§2).
4. **Never persist the `.p8`.** Studio needs no new credential. If a Studio run reuses the ASC-read path (`runAppWithAsc`, `cloud/src/api/index.ts:917`) to get real shots, the existing ephemeral-credential posture stands (`cloud/src/api/index.ts:912-913`: minted JWT, never persisted) — Studio adds nothing that stores the key.
5. **The agent NEVER auto-pushes.** Output is an artifact behind the human approval gate (`cloud/src/api/index.ts:1301` `decideRun`, `:1337` "approved is NOT shipped — nothing has reached App Store Connect"). The Fastlane `screenshots/` handoff inherits the same "we produce the artifact; never hold credentials; never push" guarantee (`cloud/src/engine/fastlane.ts:13-14`).
6. **Route-level isolation.** Frame/deck routes are owner-scoped via `requireOwnedApp` (the `shareCardRoute` pattern, `cloud/src/api/index.ts:1265`); SVGs are served `no-store` and self-contained so rasterization can't taint a canvas (the share-card rationale, `shareCard.ts:52-53`). Caption text is XML-escaped.

---

## 7. Risks & rollout

- **Quality/credibility risk:** auto-captioned templated frames may look generic vs hand-designed decks; a weak deck on a paid tier is worse than no deck. *Mitigation:* ship v1 to a small cohort of paying users; treat "projected grade improvement" as the honest, narrow promise rather than "beautiful screenshots."
- **Scope creep toward a creative editor:** the issue explicitly warns this is a pre-PMF distraction. *Mitigation:* keep v1 to deterministic templates + captions; no editor, no asset uploads.
- **Caption budget mismatch with App Store reality:** caption space depends on the chosen template; pick a conservative budget and parameterize it (tested).
- **Tier/billing migration:** adding `studio` touches the `tier` CHECK constraint (`schema.sql:28`) and Stripe price config; a bad migration could break existing gates. *Mitigation:* additive `ALTER`, new price env, `canUseStudio` defaults closed.
- **Rollout:** (1) merge engine + renderer + tests dark (no route exposure); (2) add Studio tier + gated routes behind a feature flag / unsold price; (3) enable for an invited paying cohort; (4) measure whether the before→after grade delta drives the proof story before general availability. Per the issue, **do not start any of this until post-launch with first paying users showing real demand** for asset generation.

---

## 8. Effort estimate

**L (large).** Three new pure modules with full test suites are individually S–M and clean (they mirror existing patterns closely), but the surface spans engine + renderer + API routes + billing/tier + schema migration + Fastlane extension + frontend CTA/preview + Stripe price wiring + E2E. The honesty constraints (projection labeling, no fabricated UI) add design care, not just code. Realistically a multi-PR effort:
- PR1 (M): `screenshotDeck.ts` + `screenshotFrame.ts` + specs (pure, dark).
- PR2 (M): billing/tier + schema migration + gated routes + Fastlane handoff.
- PR3 (S–M): frontend CTA + deck preview + E2E.

---

## 9. Open product questions (need owner answers)

1. **New `studio` tier vs add-on entitlement** on an existing tier? (Recommendation: new tier.) → drives the billing/schema shape.
2. **Price + mode** (one-time like `launch` $49, or recurring like `autopilot` $19/mo)? → drives `TIER_CONFIG`.
3. Does **fleet** inherit Studio, or is it strictly its own tier?
4. v1 frame source: **frame the existing real App Store shots** with caption bands, or **caption-template panels**, or both? (Affects the honesty story and the renderer.)
5. Locales: v1 English-only, or honor the per-locale Fastlane layout from the start?

---

## 10. Does this need a DECISION before building?

**Yes — two:**
- **Gating decision:** the issue itself parks this until *post-launch, post-revenue, with signal that asset generation is a real ask*. Do not start until the owner confirms that gate is lifted.
- **Product-shape decision:** the five questions in §9 (especially tier/price and v1 frame source) must be answered by the owner before PR1, because they change the engine output, the billing schema, and the honesty surface.
