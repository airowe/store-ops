# Mobile Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three mobile UI improvements as one pass — fix safe-area insets (status-bar overlap), bump the font scale, and enrich the free-audit result with a top-10 progress ring + per-keyword rank bars (mockup option C) — so App Store screenshots (and the app) look right.

**Architecture:** React Native + Expo. Safe-area via `react-native-safe-area-context` (installed). Fonts are a token-scale change. Charts reuse `react-native-svg` (installed, `15.15.4`) for a lightweight ring + bars, matching the existing Skia/react-native-graph aesthetic — no new charting lib. All visuals honor the honesty invariant: an unmeasured/null rank shows explicitly as "—", never a fabricated bar.

**Tech Stack:** React Native, Expo, jest + @testing-library/react-native, react-native-safe-area-context, react-native-svg.

## Global Constraints

- **Honesty invariant (binds Task 3/4):** every visual maps to a real returned number; null rank → no bar + explicit "—"; bar length derived only from the real rank.
- Reuse existing theme tokens + `react-native-svg`; no new design tokens, no new charting library.
- Preserve all existing testIDs (`preview-grade`, `preview-grade-pill`, `preview-sample`, `preview-row-<keyword>`, `preview-summary`, `preview-result`, `preview-signin`, `preview-query`, `preview-search`, `preview-note`); add only new ring/bar testIDs.
- Changes confined to: `mobile/app/_layout.tsx`, `mobile/src/components/primitives.tsx`, `mobile/src/theme/tokens.ts`, `mobile/app/(public)/preview.tsx`, plus new small chart components + tests.
- Commands (from repo root `/Users/adamrowe/Projects/store-ops`): test a file `cd mobile && npx jest '<path>'` (fallback `./node_modules/.bin/jest '<path>'` if `npx` is intercepted); typecheck `cd mobile && ./node_modules/.bin/tsc --noEmit`.

---

### Task 1: Safe-area insets

**Files:**
- Modify: `mobile/app/_layout.tsx` (add `SafeAreaProvider`)
- Modify: `mobile/src/components/primitives.tsx` (`Screen` — apply insets)
- Test: `mobile/src/components/screen.responsive.test.tsx` (add an inset assertion; or a new `screen.safearea.test.tsx`)

**Interfaces:**
- Consumes: `react-native-safe-area-context` — `SafeAreaProvider`, `useSafeAreaInsets`.
- Produces: `Screen` renders content padded below the status bar.

**Why:** `(public)` screens (login/preview/proof) set `headerShown: false`, so `Screen`'s content renders under the status bar (title collides with clock). No `SafeAreaProvider` exists at root.

- [ ] **Step 1: Add SafeAreaProvider at the root**

In `mobile/app/_layout.tsx`, import and wrap. Add to imports:

```tsx
import { SafeAreaProvider } from "react-native-safe-area-context";
```

Wrap the tree so `SafeAreaProvider` is just inside `GestureHandlerRootView` (outermost app provider below the gesture root):

```tsx
  return (
    // GestureHandlerRootView is required for react-native-graph's pan-scrubber.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <NotificationsBridge />
              <AppShell />
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
```

- [ ] **Step 2: Write the failing test**

In `mobile/src/components/screen.responsive.test.tsx` (read it first to match its mocking style), add a test that mocks `useSafeAreaInsets` to a known inset and asserts `screen-content`'s resolved style includes that top padding. Mock:

```tsx
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual("react-native-safe-area-context"),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
```

Assertion (flatten the style array like the existing preview tests do):

```tsx
const content = screen.getByTestId("screen-content");
const flat = Object.assign({}, ...[].concat(content.props.style as never));
// gutter (from useLayout) + top inset. Assert the inset is included.
expect(flat.paddingTop).toBeGreaterThanOrEqual(47);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npx jest src/components/screen.responsive.test.tsx -t "inset"`
Expected: FAIL — current `Screen` uses `padding: gutter` with no inset.

- [ ] **Step 4: Apply insets in Screen**

In `mobile/src/components/primitives.tsx`, add the import:

```tsx
import { useSafeAreaInsets } from "react-native-safe-area-context";
```

In `Screen`, read insets and replace the single `padding: gutter` with explicit sides so top/bottom include the inset:

```tsx
  const palette = usePalette();
  const { contentMaxWidth, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.screenOuter}>
      <View
        testID="screen-content"
        style={[
          {
            paddingTop: gutter + insets.top,
            paddingBottom: gutter + insets.bottom,
            paddingLeft: gutter,
            paddingRight: gutter,
            gap: gutter,
          },
          !wide && { maxWidth: contentMaxWidth, width: "100%", alignSelf: "center" },
          style,
        ]}
      >
        {children}
      </View>
    </ScrollView>
  );
```

Note: `(app)` screens sit under a native header, so their content region's `insets.top` is ~0 (header consumes the unsafe area) — adding it is a no-op there. If the simulator shows a double gap on `(app)` screens during manual verification, revisit by gating the top inset; do NOT add the gate pre-emptively (YAGNI).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npx jest src/components/screen.responsive.test.tsx && ./node_modules/.bin/tsc --noEmit`
Expected: all screen tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/_layout.tsx mobile/src/components/primitives.tsx mobile/src/components/screen.responsive.test.tsx
git commit -m "fix(mobile): inset Screen content below the status bar (SafeAreaProvider)"
```

---

### Task 2: Font scale bump

**Files:**
- Modify: `mobile/src/theme/tokens.ts` (the `fontSize` object)
- Test: whichever test asserts font sizes (search first); add a `body >= 16` pin

**Interfaces:**
- Produces: larger `fontSize.*` values consumed by `AppText` and all screens.

**Why:** "Font size too small everywhere." Body 15pt is under iOS's 17pt content default.

- [ ] **Step 1: Find any test asserting font sizes**

Run: `cd mobile && grep -rn "fontSize" src/ app/ --include=*.test.tsx --include=*.spec.tsx`
Note any test that hard-codes the old numbers (11/13/15/18/24/34) — you'll update them in Step 4.

- [ ] **Step 2: Write/adjust the failing pin test**

Add (or place in an existing theme/tokens test — create `mobile/src/theme/tokens.spec.ts` if none exists):

```ts
import { describe, it, expect } from "@jest/globals";
import { fontSize } from "./tokens.js";

describe("fontSize scale", () => {
  it("body is at least 16 (iOS-readable, never cramped)", () => {
    expect(fontSize.body).toBeGreaterThanOrEqual(16);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mobile && npx jest src/theme/tokens.spec.ts`
Expected: FAIL — `fontSize.body` is currently 15.

- [ ] **Step 4: Bump the scale**

In `mobile/src/theme/tokens.ts`, change the `fontSize` object to:

```ts
export const fontSize = {
  micro: 12,
  small: 14,
  body: 17,
  lead: 20,
  title: 28,
  display: 40,
} as const;
```

Update any other test found in Step 1 that hard-coded the old values to the new ones.

- [ ] **Step 5: Run tests to verify pass**

Run: `cd mobile && npx jest src/theme && ./node_modules/.bin/tsc --noEmit`
Expected: PASS; typecheck exits 0. Then run the full suite once to catch any snapshot that pinned old sizes: `cd mobile && npx jest` — update snapshots only if the diff is purely the intended font-size change (`npx jest -u` for those).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/theme/tokens.ts mobile/src/theme/tokens.spec.ts
# plus any test files updated in step 4
git commit -m "feat(mobile): bump the type scale (body 15->17) for readability"
```

---

### Task 3: Rank-bar mapping + RankBar/TopTenRing components

**Files:**
- Create: `mobile/src/lib/rankBar.ts` (pure mapping fn)
- Create: `mobile/src/lib/rankBar.spec.ts`
- Create: `mobile/src/components/RankBar.tsx` (the per-keyword bar cell)
- Create: `mobile/src/components/TopTenRing.tsx` (the progress ring, react-native-svg)

**Interfaces:**
- Produces:
  - `rankFill(rank: number | null, cap?: number): number` — returns a fill fraction in `[0,1]`, or `null`-signal handled by the component. Spec: `rank == null → 0` AND the component renders no bar; a measured rank → `max(0.02, 1 - (rank - 1) / cap)` with `cap = 50` default (min 0.02 sliver so a deep-but-measured rank stays visibly distinct from unmeasured/no-bar).
  - `RankBar({ rank }: { rank: number | null })` — renders a track+fill for a measured rank, or nothing (caller shows "—") for null.
  - `TopTenRing({ inTop10, total }: { inTop10: number; total: number })` — an SVG ring showing `inTop10/total`.

**Why:** The honesty-critical mapping and the reusable visuals, unit-tested in isolation before wiring into the screen.

- [ ] **Step 1: Write the failing mapping test**

Create `mobile/src/lib/rankBar.spec.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { rankFill } from "./rankBar.js";

describe("rankFill", () => {
  it("rank #1 fills the bar", () => {
    expect(rankFill(1)).toBe(1);
  });
  it("a mid rank is partially filled and monotonic", () => {
    const r10 = rankFill(10);
    const r25 = rankFill(25);
    expect(r10).toBeGreaterThan(r25);
    expect(r10).toBeGreaterThan(0);
    expect(r10).toBeLessThan(1);
  });
  it("a deep-but-measured rank keeps a minimal sliver (never zero)", () => {
    expect(rankFill(200)).toBeGreaterThanOrEqual(0.02);
  });
  it("HONESTY: an unmeasured (null) rank returns 0 — the component renders no bar", () => {
    expect(rankFill(null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest src/lib/rankBar.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping**

Create `mobile/src/lib/rankBar.ts`:

```ts
/**
 * rankFill — fraction [0,1] for a rank bar. Honest by construction: a null
 * (unmeasured) rank returns 0 and the RankBar renders NOTHING (the row shows
 * "—"); a measured rank maps monotonically with a floor sliver so even a deep
 * measured rank stays visibly distinct from "no data". cap=50: ranks past 50
 * hit the 0.02 floor.
 */
export function rankFill(rank: number | null, cap = 50): number {
  if (rank == null) return 0;
  if (rank <= 1) return 1;
  return Math.max(0.02, 1 - (rank - 1) / cap);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd mobile && npx jest src/lib/rankBar.spec.ts`
Expected: PASS.

- [ ] **Step 5: Create RankBar (renders nothing for null)**

Create `mobile/src/components/RankBar.tsx`:

```tsx
/**
 * RankBar — a horizontal rank-strength bar. Length = rankFill(rank). A null
 * (unmeasured) rank renders NOTHING — the caller shows an explicit "—", never a
 * zero-length bar implying a bad rank (honesty invariant).
 */
import React from "react";
import { View } from "react-native";
import { palette } from "../theme/index.js";
import { rankFill } from "../lib/rankBar.js";

export function RankBar({ rank }: { rank: number | null }) {
  if (rank == null) return null;
  const pct = `${Math.round(rankFill(rank) * 100)}%` as const;
  return (
    <View
      testID="rank-bar"
      style={{ height: 7, borderRadius: 4, backgroundColor: palette.line, overflow: "hidden" }}
    >
      <View style={{ height: "100%", width: pct, borderRadius: 4, backgroundColor: palette.signal }} />
    </View>
  );
}
```

- [ ] **Step 6: Create TopTenRing (react-native-svg)**

Create `mobile/src/components/TopTenRing.tsx`:

```tsx
/**
 * TopTenRing — a small SVG progress ring for "inTop10 / total" tracked keywords.
 * Real counts only; total<=0 renders nothing.
 */
import React from "react";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import { palette } from "../theme/index.js";

export function TopTenRing({ inTop10, total, size = 64 }: { inTop10: number; total: number; size?: number }) {
  if (total <= 0) return null;
  const r = 15.9155; // circumference ~= 100 for easy dasharray math
  const frac = Math.max(0, Math.min(1, inTop10 / total));
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" testID="preview-topten-ring">
      <Circle cx={18} cy={18} r={r} fill="none" stroke={palette.line} strokeWidth={4} />
      <Circle
        cx={18} cy={18} r={r} fill="none" stroke={palette.signal} strokeWidth={4}
        strokeLinecap="round" strokeDasharray={`${frac * 100} 100`}
        transform="rotate(-90 18 18)"
      />
      <SvgText x={18} y={21} textAnchor="middle" fill={palette.ink} fontSize={9} fontWeight="700">
        {inTop10}/{total}
      </SvgText>
    </Svg>
  );
}
```

- [ ] **Step 7: Verify components typecheck + the mapping test passes**

Run: `cd mobile && npx jest src/lib/rankBar.spec.ts && ./node_modules/.bin/tsc --noEmit`
Expected: mapping PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/lib/rankBar.ts mobile/src/lib/rankBar.spec.ts mobile/src/components/RankBar.tsx mobile/src/components/TopTenRing.tsx
git commit -m "feat(mobile): rank-bar mapping + RankBar/TopTenRing (honesty-safe)"
```

---

### Task 4: Wire ring + bars into the preview result card

**Files:**
- Modify: `mobile/app/(public)/preview.tsx` (result card header + sample rows)
- Test: `mobile/app/(public)/preview.test.tsx` (extend the existing "REAL grade" test)

**Interfaces:**
- Consumes: `TopTenRing`, `RankBar` (Task 3); `result.inTop10`, `result.keywordsChecked`, `result.sample[].rank`.

**Why:** Put the option-C visuals on the screenshot hero. Preserve all existing testIDs + the honesty behavior.

- [ ] **Step 1: Add the failing test assertions**

In `mobile/app/(public)/preview.test.tsx`, inside the first test ("audits a query and shows the REAL grade…", which returns `inTop10: 2, keywordsChecked: 12` and a 2-row sample `recipes #7`, `pantry null`), after the existing sample assertions add:

```tsx
    // Option C: a top-10 progress ring reflects the real counts.
    expect(screen.getByTestId("preview-topten-ring")).toBeTruthy();
    // A measured row shows a rank bar; the unmeasured row shows NO bar (honesty).
    const measuredRow = screen.getByTestId("preview-row-recipes");
    const unmeasuredRow = screen.getByTestId("preview-row-pantry");
    expect(within(measuredRow).queryByTestId("rank-bar")).toBeTruthy();
    expect(within(unmeasuredRow).queryByTestId("rank-bar")).toBeNull();
```

Add `within` to the testing-library import at the top of the file:

```tsx
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";
```

(Remove the placeholder `expect(measuredRow.findAllByProps ...)` line — it's a no-op; the real assertions are the `within(...)` ones.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest 'app/(public)/preview.test.tsx' -t "REAL grade"`
Expected: FAIL — no `preview-topten-ring`, no `rank-bar`.

- [ ] **Step 3: Wire the ring into the result header**

In `mobile/app/(public)/preview.tsx`, add imports:

```tsx
import { RankBar } from "../../src/components/RankBar.js";
import { TopTenRing } from "../../src/components/TopTenRing.js";
```

In the result card, after the app-name/grade-pill header row and before the `preview-summary` text, add the ring alongside the summary. Replace the summary block:

```tsx
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xs }}>
            {result.keywordsChecked > 0 ? (
              <TopTenRing inTop10={result.inTop10} total={result.keywordsChecked} />
            ) : null}
            <AppText kind="body" testID="preview-summary" style={{ flex: 1 }}>
              {result.leadKeyword && result.leadRank != null
                ? `Ranks #${result.leadRank} for “${result.leadKeyword}” · ${result.inTop10} of ${result.keywordsChecked} tracked keywords in the top 10.`
                : `Checked ${result.keywordsChecked} keywords — none ranking yet.`}
            </AppText>
          </View>
```

- [ ] **Step 4: Add the bar to each sample row**

Replace the sample-row inner content (keep the row `View` + its testID + hairline styling from #256) so the row is `keyword | bar | rank`:

```tsx
                <View
                  key={s.keyword}
                  testID={`preview-row-${s.keyword}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderBottomWidth: i === result.sample.length - 1 ? 0 : 1,
                    borderBottomColor: palette.line,
                  }}
                >
                  <AppText kind="micro" style={{ width: 96 }}>{s.keyword}</AppText>
                  <View style={{ flex: 1 }}>
                    {/* null rank → RankBar renders nothing; the "—" on the right carries it. */}
                    <RankBar rank={s.rank} />
                  </View>
                  {/* An unmeasured rank is "—", never a fabricated number. */}
                  <AppText kind="mono">{s.rank == null ? "—" : `#${s.rank}`}</AppText>
                </View>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npx jest 'app/(public)/preview.test.tsx' && ./node_modules/.bin/tsc --noEmit`
Expected: all preview tests PASS (ring present, measured row has a bar, unmeasured row has none); typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(public\)/preview.tsx mobile/app/\(public\)/preview.test.tsx
git commit -m "feat(mobile): top-10 ring + rank bars on the free-audit result (option C)"
```

---

## Post-implementation (not plan tasks)

1. Merge, rebuild the simulator (`./node_modules/.bin/expo run:ios --configuration Release --device "iPhone 17 Pro Max"`), and manually verify in-sim: no status-bar overlap, readable fonts, ring + bars on a real audit, no double gap on `(app)` screens.
2. Resume App Store screenshot capture from the polished app.

## Self-Review

- **Spec coverage:** Part 1 → Task 1; Part 2 → Task 2; Part 3 → Tasks 3 (mapping + components) + 4 (wire-in). Honesty invariant → `rankFill(null)===0` test + RankBar null-render + preserved "—".
- **Placeholder scan:** clean — all steps carry real code/commands. No TBD/TODO.
- **Type/name consistency:** `rankFill`, `RankBar`, `TopTenRing`, `cap=50` consistent across Task 3 and 4. `inTop10`/`keywordsChecked`/`sample[].rank` match the API type used in `preview.tsx`. testIDs (`preview-topten-ring`, `rank-bar`) consistent between component and test.
- **Scope:** four files + two small new components/libs; charts limited to the preview card; no line chart (preview is point-in-time).
