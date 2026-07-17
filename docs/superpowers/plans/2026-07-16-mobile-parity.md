# Mobile Parity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring mobile to parity with the web — fix the website's horizontal-overflow bug on mobile, add the web's hairline grid-line separators to the mobile audit rows, and give the mobile preview screen the web's grade-pill + spacing feel.

**Architecture:** Two surfaces, three independent changes. Part 1 is pure CSS in `cloud/web/src/app.css` (defensive guard + shrink/wrap fixes). Parts 2 and 3 are React Native style changes in `mobile/app/(public)/preview.tsx`, reusing existing theme tokens. No new tokens, no behavior changes, all existing `testID`s preserved.

**Tech Stack:** React 19 + Vite (web), React Native + Expo (mobile), vitest (web tests), jest + @testing-library/react-native (mobile tests).

## Global Constraints

- Reuse existing theme tokens on both surfaces; introduce **no** new design tokens.
- Web CSS changes are additive/defensive — no behavior or DOM changes.
- Keep native conventions on mobile (do not clone web layout wholesale).
- Preserve all existing `testID`s: `preview-grade`, `preview-sample`, `preview-query`, `preview-search`, `preview-result`, `preview-signin`, `preview-note`.
- The web overflow symptom is verified by the **user on a real device**, not by CI. CSS is not exercisable by unit tests — the automated gate for Part 1 is "web build + existing public tests stay green."
- Mobile: `cd mobile && npx jest <path>` runs a test; `cd mobile && npx tsc --noEmit` typechecks.
- Web: `cd cloud/web && npx vitest run <path>` runs a test; `cd cloud/web && npx vite build` builds.

---

### Task 1: Web horizontal-overflow fix (defensive guard + culprits)

**Files:**
- Modify: `cloud/web/src/app.css` (the `body` rule at line 4; `.txt` at line 82; `.move-row` at line 124; `.appcard .bundle` at line 105 / `.mono` at line 110)

**Interfaces:**
- Consumes: existing CSS custom properties (`--line-soft`, etc.) — unchanged.
- Produces: nothing consumed by later tasks (independent).

**Why:** `body` has no `overflow-x`/`max-width` guard, so any over-wide child slides the whole page. The likely culprits are (a) `.move-row`'s `grid-template-columns: 1fr auto auto` — a `1fr` track has implicit `min-width:auto`, so a long unbroken keyword in `.kw` widens the page; (b) `.txt`'s `flex: 1` with implicit `min-width:auto` refusing to shrink; (c) long bundle-id/mono strings. Belt (guard) + suspenders (culprit fixes) per the approved design.

- [ ] **Step 1: Add the defensive guard immediately after the `body` rule**

The `body` rule ends at `cloud/web/src/app.css:10` (`}`). Insert directly after it:

```css
/* Defensive guard: nothing may make the page scroll horizontally on mobile.
   Paired with the shrink/wrap fixes below so this net isn't merely masking a
   real layout break. Verified on a real device, not by CI. */
html, body { max-width: 100%; overflow-x: hidden; }
```

- [ ] **Step 2: Let the `.move-row` 1fr grid track shrink**

At `.move-row` (`app.css:124`), append `min-width: 0;` to the rule, and add a rule for `.kw`. The existing block is:

```css
.move-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-soft); }
.move-row:last-child { border-bottom: 0; }
.move-row .kw { color: var(--ink); font-weight: 600; }
```

Change to:

```css
.move-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-soft); min-width: 0; }
.move-row:last-child { border-bottom: 0; }
.move-row .kw { color: var(--ink); font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
```

- [ ] **Step 3: Let the flex input shrink**

At `.txt` (`app.css:82`), add `min-width: 0;`. The existing rule:

```css
.txt { flex: 1; background: var(--bg-2); border: 1px solid var(--line); color: var(--ink); border-radius: 10px; padding: 9px 11px; font: inherit; }
```

Change to:

```css
.txt { flex: 1; min-width: 0; background: var(--bg-2); border: 1px solid var(--line); color: var(--ink); border-radius: 10px; padding: 9px 11px; font: inherit; }
```

- [ ] **Step 4: Wrap long mono / bundle-id strings**

At `.appcard .bundle` (`app.css:105`) and `.mono` (`app.css:110`), add `overflow-wrap: anywhere;`. Existing:

```css
.appcard .bundle { color: var(--faint); font-size: 12px; font-family: var(--mono); margin-top: 2px; }
.mono { font-family: var(--mono); }
```

Change to:

```css
.appcard .bundle { color: var(--faint); font-size: 12px; font-family: var(--mono); margin-top: 2px; overflow-wrap: anywhere; }
.mono { font-family: var(--mono); overflow-wrap: anywhere; }
```

- [ ] **Step 5: Verify the web build succeeds**

Run: `cd cloud/web && npx vite build`
Expected: build completes with no errors (exit 0).

- [ ] **Step 6: Verify existing public tests stay green**

Run: `cd cloud/web && npx vitest run src/features/public`
Expected: all public-feature tests PASS (no behavior/DOM change was made).

- [ ] **Step 7: Commit**

```bash
git add cloud/web/src/app.css
git commit -m "fix(web): stop horizontal overflow on mobile (guard + grid/flex shrink + wrap)"
```

---

### Task 2: Mobile audit-row grid-line parity

**Files:**
- Modify: `mobile/app/(public)/preview.tsx` (the `preview-sample` block, currently lines ~143–153)
- Test: `mobile/app/(public)/preview.test.tsx` (add one assertion; existing tests must stay green)

**Interfaces:**
- Consumes: `palette` — already imported at `preview.tsx:21` (`import { palette, spacing } from "../../src/theme/index.js";`). `palette.line` is the border token `Card` uses.
- Produces: nothing consumed by later tasks.

**Why:** The web's `.move-row` draws a `border-bottom: 1px solid var(--line-soft)` between audit rows (none after the last). The mobile sample rows currently render with `gap: spacing.xs` and no separators. Add a hairline between rows (last row omitted), mirroring the web.

**Current code (`preview.tsx:143–153`):**

```tsx
          {result.sample.length ? (
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }} testID="preview-sample">
              {result.sample.map((s) => (
                <View key={s.keyword} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText kind="micro">{s.keyword}</AppText>
                  {/* An unmeasured rank is "—", never a fabricated number. */}
                  <AppText kind="mono">{s.rank == null ? "—" : `#${s.rank}`}</AppText>
                </View>
              ))}
            </View>
          ) : null}
```

- [ ] **Step 1: Add the failing test**

In `mobile/app/(public)/preview.test.tsx`, inside the first test ("audits a query and shows the REAL grade…", which already returns a 2-row sample), after the existing `expect(screen.getByTestId("preview-sample")).toBeTruthy();` (line ~60), add an assertion that the non-last sample row carries a bottom hairline. Rows are keyed by keyword; add `testID={`preview-row-${s.keyword}`}` in the implementation (Step 3) and assert here:

```tsx
    // Grid-line parity with the web's .move-row: a hairline separates rows,
    // and the LAST row drops it (mirrors .move-row:last-child { border-bottom: 0 }).
    const firstRow = screen.getByTestId("preview-row-recipes"); // non-last
    const lastRow = screen.getByTestId("preview-row-pantry");   // last of 2
    const flat = (s: unknown) => Object.assign({}, ...[].concat(s as never));
    expect(flat(firstRow.props.style).borderBottomWidth).toBe(1);
    expect(flat(lastRow.props.style).borderBottomWidth).toBe(0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx -t "REAL grade"`
Expected: FAIL — `getByTestId("preview-row-recipes")` throws (testID not yet present).

- [ ] **Step 3: Implement the hairline rows**

Replace the `preview-sample` block (`preview.tsx:143–153`) with:

```tsx
          {result.sample.length ? (
            <View style={{ marginTop: spacing.sm }} testID="preview-sample">
              {result.sample.map((s, i) => (
                <View
                  key={s.keyword}
                  testID={`preview-row-${s.keyword}`}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: spacing.xs,
                    // Hairline between rows; the last row drops it — mirrors the
                    // web .move-row:last-child { border-bottom: 0 }.
                    borderBottomWidth: i === result.sample.length - 1 ? 0 : 1,
                    borderBottomColor: palette.line,
                  }}
                >
                  <AppText kind="micro">{s.keyword}</AppText>
                  {/* An unmeasured rank is "—", never a fabricated number. */}
                  <AppText kind="mono">{s.rank == null ? "—" : `#${s.rank}`}</AppText>
                </View>
              ))}
            </View>
          ) : null}
```

Note: the outer `gap: spacing.xs` is removed because per-row `paddingVertical` now provides the rhythm (so the hairline sits between rows, matching the web's `padding: 8px 0`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx -t "REAL grade"`
Expected: PASS.

- [ ] **Step 5: Run the full preview test file + typecheck**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx && npx tsc --noEmit`
Expected: all 4 preview tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(public\)/preview.tsx mobile/app/\(public\)/preview.test.tsx
git commit -m "feat(mobile): hairline separators on preview audit rows (grid-line parity with web)"
```

---

### Task 3: Mobile grade pill + spacing parity

**Files:**
- Modify: `mobile/app/(public)/preview.tsx` (the grade render, currently lines ~130–134)
- Test: `mobile/app/(public)/preview.test.tsx` (existing `preview-grade` assertion must stay green; add a pill-style assertion)

**Interfaces:**
- Consumes: `palette.signalGlow` and `palette.signal` — both present in `mobile/src/theme/tokens.ts` (dark: `signal #34d399`, `signalGlow rgba(52,211,153,.18)`; light: `signal #0f9d63`, `signalGlow rgba(15,157,99,.14)`). `palette` is already imported at `preview.tsx:21`.
- Produces: nothing consumed by later tasks.

**Why:** The web renders the grade as `.grade` (`app.css:153`) — an `inline-flex` pill: `min-width:30px; height:30px; border-radius:8px; padding:0 6px`, mono/700, `background: var(--signal-glow); color: var(--signal)`. Mobile currently renders it as plain colored mono text. Give it the pill treatment, mapping 1:1 onto the web rule. The existing test asserts `getByTestId("preview-grade")` has text content — so the grade text node MUST keep `testID="preview-grade"`.

**Current code (`preview.tsx:128–135`):**

```tsx
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText kind="lead">{result.appName || "Audit preview"}</AppText>
            {result.auditGrade ? (
              <AppText kind="mono" testID="preview-grade" style={{ color: palette.signal }}>
                {result.auditGrade}
              </AppText>
            ) : null}
          </View>
```

- [ ] **Step 1: Add the failing test**

In `preview.test.tsx`, inside the first test ("audits a query and shows the REAL grade…"), after the existing `expect(screen.getByTestId("preview-grade")).toHaveTextContent("C");` (line ~50), add:

```tsx
    // Grade-pill parity with the web .grade: the grade text sits inside a pill
    // View with the signal-glow background and rounded corners.
    const pill = screen.getByTestId("preview-grade-pill");
    const flatPill = Object.assign({}, ...[].concat(pill.props.style as never));
    expect(flatPill.borderRadius).toBe(8);
    expect(flatPill.backgroundColor).toBe(palette.signalGlow);
```

Add the import at the top of the test file (after the existing imports):

```tsx
import { palette } from "../../src/theme/index.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx -t "REAL grade"`
Expected: FAIL — `getByTestId("preview-grade-pill")` throws (pill not yet present).

- [ ] **Step 3: Implement the pill**

Replace the grade render (`preview.tsx:130–134`) with:

```tsx
            {result.auditGrade ? (
              <View
                testID="preview-grade-pill"
                style={{
                  minWidth: 30,
                  height: 30,
                  paddingHorizontal: 6,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: palette.signalGlow,
                }}
              >
                <AppText kind="mono" testID="preview-grade" style={{ color: palette.signal, fontWeight: "700" }}>
                  {result.auditGrade}
                </AppText>
              </View>
            ) : null}
```

This maps 1:1 onto the web `.grade` rule. The grade text node keeps `testID="preview-grade"`, so the existing text-content assertion stays valid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx -t "REAL grade"`
Expected: PASS.

- [ ] **Step 5: Run the full preview test file + typecheck**

Run: `cd mobile && npx jest app/\(public\)/preview.test.tsx && npx tsc --noEmit`
Expected: all 4 preview tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(public\)/preview.tsx mobile/app/\(public\)/preview.test.tsx
git commit -m "feat(mobile): grade badge as a pill (preview-screen feel parity with web)"
```

---

## Post-implementation manual verification (user + Argent)

Not a plan task — recorded so it isn't forgotten:

1. **Web overflow** — deploy the web build; **user** opens `app.shipaso.com` on a real phone, confirms the page no longer slides side-to-side and fits the viewport. This is the authoritative test for Part 1.
2. **Mobile grid lines + grade pill** — visual check in the iOS simulator via Argent: hairlines between the preview sample rows (none after the last); grade renders as a signal-glow pill.

## Self-Review

- **Spec coverage:** Part 1 → Task 1; Part 2 → Task 2; Part 3a (grade pill) + 3b (spacing, via the removed `gap` + per-row padding in Task 2 and the pill in Task 3) → Tasks 2/3; Part 3c (copy) → no change needed (verified in spec, copy already matches). All spec parts mapped.
- **Placeholder scan:** no TBD/TODO; every step has concrete code and commands.
- **Type/name consistency:** `palette.line`, `palette.signal`, `palette.signalGlow` all confirmed present in `mobile/src/theme/tokens.ts`. `testID`s (`preview-grade`, `preview-sample`, new `preview-row-*`, `preview-grade-pill`) are consistent between implementation and test steps. Web class names (`.move-row`, `.txt`, `.kw`, `.appcard .bundle`, `.mono`) match `app.css` exactly.
- **Scope:** single cohesive plan, three independent tasks — no decomposition needed.
