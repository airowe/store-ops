# PRD 05 — Google Play (Android) support

**Status:** Proposed
**Priority:** P2 (large; post-launch unless market signal justifies it)
**Closes gap:** Appeeky covers **iOS and Google Play**. We're iOS-only.

---

## Problem

Half the mobile market is Android. Appeeky audits both stores; we resolve and
audit only the App Store. For a buyer with a cross-platform app, we cover half
their surface. This is a genuine breadth gap — and the positioning doc warns that
breadth is *their* game, so this is a deliberate, costed expansion, not a reflex.

## Goals

1. Resolve a Google Play app (by package name / Play URL) the way `resolveApp.ts`
   resolves an App Store app.
2. Audit the Play listing: title, short/long description, keywords-in-text,
   screenshots by form factor, ratings/reviews.
3. Reuse as much engine logic as possible behind a store-abstraction so the
   audit/keyword/screenshot engines work for both stores.

## Non-goals

- **No Play Store push/publish at this stage.** Like iOS #34, any write to a live
  store is human-gated and out of scope here. This PRD is read/audit only.
- Not full rank tracking on Android at launch (Play rank data sourcing differs and
  is harder) — listing audit first, rank later.
- Not fastlane-for-Android automation in v1.

## Proposed design

- Introduce a `Store` abstraction: `cloud/src/engine/store/` with `ios.ts` (wraps
  existing iTunes resolution) and `android.ts` (Play resolution). Existing engine
  modules take a `store` param or a resolved `Listing`-like shape so they're
  store-agnostic where the logic is the same (coverage, screenshot scoring,
  intent grounding).
- Android data source: Google Play has no clean public Lookup like iTunes —
  resolution likely needs a scrape or a third-party Play data API. Document the
  source and its terms-of-service constraints (use the project's stealth crawler
  skill only where ToS permits; prefer an API).
- Honesty: Android keyword model differs (Play indexes the long description). Don't
  port iOS keyword-field assumptions blindly — model Play's actual ranking inputs.

## Success criteria

- A user can paste a Play URL / package name and get a listing audit comparable to
  the iOS audit.
- Shared engine modules (coverage, screenshot scoring) run unmodified for both
  stores via the abstraction.
- No fabricated Android metrics — same #78 discipline; "unmeasured" where unmeasured.

## Open questions

- Play data sourcing & ToS — this is the crux. API vs scrape vs partner dataset.
- Is Android demand real for *our* buyer segment (indie iOS-first devs), or is
  this chasing Appeeky's breadth at a cost we shouldn't pay yet? **Validate demand
  before committing.**

## Rough size

**L** — new data source + store abstraction touching most engine modules. The
data-sourcing question gates everything; resolve it first.
