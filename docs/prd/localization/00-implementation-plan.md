# Localization — per-locale metadata generation (implementation plan)

Status: **planned, v2** — draft v1 revised per an adversarial review run against
the actual codebase (2 blockers, 5 gaps fixed; noted inline as B*/G*).
Tracks the highest-signal add-on from #78 (direction 1). Items 2 (ASA data) and
3 (screenshot localization) stay out of scope and open on #78.

## Problem

The product already *recommends* markets (`localizationExpansion.ts` — static
locale/category heuristic, surfaced on every keyed run and pointed at by the
`locale_single` status row) — and then abandons the user at the exact gap our
wedge mocks: nothing generates the per-locale copy, nothing carries it into the
handoff, nothing pushes it. Meanwhile the demand signal is concrete (#78:
@kedytcom's whole indie experiment is localization; TryAstro ships it with
DeepL at $9/mo).

What exists today (verified):

- `recommendLocales()` — market recommendations with honest "translate to
  claim it" framing. UI card on the run page.
- `readAscAllLocales()` — reads every live locale's copy on a keyed run.
- `applyAscMetadata({locale})` — can already PATCH a **specific existing**
  localization (B1 from v1 review: it **throws** when the locale is absent on
  the editable version — v1 wrongly assumed pushing to a new market would just
  work; a *create-localization* write is required, see Phase 3).
- `buildFastlaneBundle({locale})` — emits `metadata/<locale>/*.txt` for exactly
  **one** locale per bundle (G1: v1 assumed multi-locale trees existed; they
  don't — Phase 2 makes the bundle multi-locale, which fastlane `deliver`
  natively consumes).
- `validateCopy` — the 30/30/100 char limits are per-locale identical (Apple
  counts characters, not bytes — CJK fits fewer words, same limit).
- `env.AI` reasoner plumbing (`aiReasoner.ts`) — injected, degradable.

## Goal

From an approved run: generate an honest per-locale metadata **draft** for each
recommended (or user-picked) market, let the human review/edit/approve **per
market**, and carry approved locales into the existing handoffs (fastlane
bundle; direct ASC push where enabled). The agent drafts; the human ships —
identical discipline to the en-US loop.

## Non-goals

- Screenshot localization (#78 item 3) and ASA data (#78 item 2).
- Auto-push of any locale, anywhere. Every outward write stays per-action.
- Localizing the **description** in v1 (4000 chars of long-form prose is where
  MT quality risk concentrates; name/subtitle/keywords are the ranking
  surfaces and are short enough to review). G2: v1 scoped description in and
  the review pass cut it — a reviewer can sanity-check 30-char lines in a
  language they half-know; they cannot review 4000 chars.
- Play localization (the Play surface has its own model; separate issue).

## The gating decision (owner input needed before Phase 1 lands)

**Translation source.** Two viable paths, decided by config not architecture
(the `Localizer` interface below admits both):

| | Workers AI (in-stack) | DeepL API |
|---|---|---|
| Cost | ~free at our volume | paid tier, per-char |
| Quality (short marketing copy) | adequate, needs review | industry default (TryAstro uses it) |
| New secret/vendor | none | `DEEPL_API_KEY`, new vendor |
| Keyword-field handling | prompt-controlled | must translate term-by-term ourselves |

Recommendation: **ship Phase 1 on Workers AI** (no new vendor, the human
review gate absorbs quality risk on 30-char surfaces), keep the `Localizer`
interface DeepL-ready, revisit after real usage. B2 from v1 review: v1 baked
Workers AI in with no seam — the interface is now the contract and the choice
is reversible.

## Honesty rules (hard, carried from #78/#65)

- A generated draft is labeled **draft — machine-translated, review before
  shipping** everywhere it appears. Never presented as native-quality copy.
- The brand token in the name is **never translated** (guardrail, tested).
- Char limits enforced at generation (`fitToLimit` per field) AND re-validated
  server-side on save — an over-limit translation is trimmed by the engine,
  never silently shipped over-limit (G3).
- A locale is only claimed "live" after a real read confirms it — generating or
  even pushing a draft never flips any "live in N locales" copy (G4).
- No reasoner binding → the feature is honestly **unavailable** ("translation
  needs the AI binding / DeepL key") — never a deterministic fake translation.
- RLHF/preference capture does NOT extend to localized drafts in v1 (G5 — the
  capture pipeline is en-US-shaped; extending it is its own decision).

## Phases

1. **[Phase 1 — engine + API: per-locale draft generation](phase-1-engine.md)**
   `localizeCopy(localizer, {copy, targetLocale, brandToken})` with guardrails;
   `POST /runs/:id/localize {locale}` returning a validated draft. Stateless.
2. **[Phase 2 — persistence + multi-locale handoff](phase-2-handoff.md)**
   Approved-per-market drafts stored on the run trace
   (`localizedCopy: Record<locale, CopyFields>` via the `updateRunCopy`
   pattern); `buildFastlaneBundle` emits every approved locale;
   the credential-free path is complete here.
3. **[Phase 3 — direct ASC push per market](phase-3-asc-push.md)**
   `createAscLocalization` (the missing write, mirrors #34's
   `createAscVersion` per-action discipline) + per-locale push via the
   existing `applyAscMetadata({locale})`. Flag-gated like all ASC writes.
4. **[Phase 4 — UI: per-market review lane](phase-4-ui.md)**
   The expansion card's recommendations grow a "Generate draft" action;
   each draft renders in the same editable diff surface as en-US (char bars,
   validation mirror), with per-market "Approve for handoff". Mock + e2e.

Each phase merges green on its own; the feature is honest at every
intermediate state (Phase 1 alone = drafts you can copy out by hand).

## Success criteria

- Recommend → generate → review/edit → approve per market → the fastlane
  bundle contains `metadata/<locale>/` for every approved market and nothing
  else (a test pins: no unapproved locale ever reaches a handoff).
- Brand token survives translation in 100% of tests; limits never exceeded.
- With ASC writes enabled: a new market goes live from ShipASO with exactly
  three explicit human actions (approve draft → create localization → push).

## Open questions (do not block Phase 1)

- DeepL upgrade trigger: what review-edit rate on drafts says "MT quality is
  costing us"? (Instrument: store whether a draft was edited before approval.)
- Should `rank_cadence` snapshots extend to localized keywords per market
  (country-parameterized rank checks exist — `country` is already on apps)?
