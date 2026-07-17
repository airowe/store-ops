# Mobile Polish Pass — Design

**Date:** 2026-07-17
**Status:** Approved (design), ready for planning

## Goal

Three mobile UI improvements surfaced while capturing App Store screenshots, done
as one cohesive polish pass so the captured screens (and the shipped app) look
right:

1. **Safe-area insets (bug)** — header-less screens render content under the
   status bar; the title collides with the clock.
2. **Font sizing** — type reads too small across the app.
3. **Richer audit visualization** — the free-audit result (the screenshot hero)
   shows only a bare keyword/rank list; add a top-10 progress ring + per-keyword
   rank bars (mockup option C).

Surface: `mobile/` (React Native + Expo). No web changes.

## Honesty invariant (binds Part 3)

Every visual must map to a real number the API returned. An unmeasured/null rank
shows explicitly as "—", never a fabricated bar or interpolated value. Bar length
is derived **only** from the real rank Apple returned. This is ShipASO's core
principle and Part 3 must not violate it.

---

## Part 1 — Safe-area insets

**Problem:** `Screen` (`mobile/src/components/primitives.tsx`) uses a plain
`ScrollView` with no safe-area inset, and there is no `SafeAreaProvider` at the
app root (`mobile/app/_layout.tsx`). The `(public)` stack sets
`headerShown: false` (`app/(public)/_layout.tsx`), so login / preview / proof
render their content under the status bar. `(app)` screens use
`headerShown: true` (native nav bar already insets them).

**Fix:**
- Wrap the root tree in `app/_layout.tsx` with `<SafeAreaProvider>` from
  `react-native-safe-area-context` (already a dependency, `~5.7.0`). It goes
  outside `ThemeProvider`/`GestureHandlerRootView`'s inner content as the
  outermost app provider (or just inside `GestureHandlerRootView`), so
  `useSafeAreaInsets()` resolves anywhere below it.
- In `Screen`, read `const insets = useSafeAreaInsets()` and add the top/bottom
  insets to the scroll content padding: `paddingTop: gutter + insets.top`,
  `paddingBottom: gutter + insets.bottom`. Keep the horizontal `gutter`.
- Because `(app)` screens sit under a native header, their content region's
  `insets.top` is already ~0 (the header consumes the unsafe area), so adding
  `insets.top` there is a no-op / harmless. Verify in-sim that header screens
  don't gain a double gap; if they do, gate the top inset to header-less use via
  a `topInset` prop defaulting to true and set false on `(app)` screens — but
  prefer the no-prop version if the double-gap doesn't occur.

**Test (`primitives`/`screen` spec):** mock `useSafeAreaInsets` to return a known
top inset; assert the `screen-content` view's resolved `paddingTop` includes it.

---

## Part 2 — Font scale bump

**Problem:** "Font size too small everywhere." Body at 15pt is under the iOS
17pt content default; micro/small (11/13) read cramped on the audit rows.

**Fix:** bump the whole scale in `mobile/src/theme/tokens.ts`, preserving rhythm
so no per-screen edits are needed (all components read `fontSize.*`):

| token   | now | new |
|---------|-----|-----|
| micro   | 11  | 12  |
| small   | 13  | 14  |
| body    | 15  | 17  |
| lead    | 18  | 20  |
| title   | 24  | 28  |
| display | 34  | 40  |

**Test:** update any token/snapshot test asserting old values; add an assertion
pinning `fontSize.body >= 16` so it can't silently regress to cramped.

**Risk:** a few tight layouts may wrap differently — verify key screens in the
simulator after; no code changes expected beyond the token file.

---

## Part 3 — Richer audit visualization (mockup option C)

**Problem:** `mobile/app/(public)/preview.tsx`'s result card shows a bare
keyword→rank list. The authed app-detail screen already has a `RankTrendChart`
(react-native-graph/Skia) + `RankMovementRow`; the public audit result — the
screenshot hero — has none.

**Design (option C — ring + bars):** On the preview result card:
- **Header:** keep the grade pill (shipped). Add a compact **top-10 progress
  ring** next to it / below the app name, showing `inTop10` / `keywordsChecked`
  (both already returned by the API). A simple SVG-or-Skia ring with the
  fraction label (e.g. "4/6").
- **Per-keyword rows:** replace the bare `keyword … rank` rows with rows that
  include a **horizontal rank bar** whose fill length encodes rank strength
  (rank #1 → full, deeper ranks → shorter; a sensible monotonic mapping such as
  `max(0, 1 - (rank-1)/CAP)` with **`CAP = 50`** (ranks beyond 50 render a
  minimal sliver, not zero, so a measured-but-deep rank stays visibly distinct
  from unmeasured). The rank number stays on the right.
- **Unmeasured:** a null rank renders **no bar** and the explicit "—" (optionally
  "— unmeasured"), never a zero-length bar that implies a bad rank.

**Reuse / consistency:** match the existing chart aesthetic (Skia /
react-native-graph tokens, `palette.signal`/`signalGlow`, the grid-line +
grade-pill work already merged). Do **not** add a new charting library. A small
self-contained ring component + a bar cell in the row are sufficient; consider
extracting `RankBar` and `TopTenRing` as small components with unit tests.

**Test:**
- The bar-length mapping is a pure function — unit-test it: rank 1 → full, a mid
  rank → partial, and **null → no bar / unmeasured** (the honesty case).
- The preview result still exposes `preview-grade`, `preview-sample`,
  `preview-grade-pill`, `preview-row-<keyword>` testIDs; add `preview-topten-ring`
  and a per-row bar testID.
- Existing `preview.test.tsx` stays green.

**Scope boundary:** only the preview result card. Do NOT redesign the app-detail
rank surfaces, the competitors card, or add trend history to preview (preview
returns a point-in-time audit, not a series — no line chart here).

---

## Testing summary

| Part | Automated | Manual |
|------|-----------|--------|
| 1 safe-area | Screen inset test (mocked insets) | sim: no status-bar overlap on public screens; no double gap on `(app)` |
| 2 fonts | token test (`body >= 16`) | sim: key screens don't break layout |
| 3 charts | pure bar-map unit test (incl. null→no bar); preview.test green | sim: ring + bars render on Calm audit |

## Global constraints

- Honesty invariant (above) binds Part 3 absolutely.
- Reuse existing theme tokens + chart stack (Skia/react-native-graph); no new
  design tokens, no new charting library.
- Preserve all existing testIDs; add only the new ring/bar ones.
- Keep native conventions; changes confined to: `app/_layout.tsx`,
  `src/components/primitives.tsx`, `src/theme/tokens.ts`,
  `app/(public)/preview.tsx`, plus any new small chart components + their tests.
- Screenshots are captured AFTER this pass merges + the sim rebuilds.
