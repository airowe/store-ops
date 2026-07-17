# Mobile Parity Pass — Design

**Date:** 2026-07-16
**Status:** Approved (design), ready for planning

## Goal

Bring the ShipASO mobile experience to parity with the web's polish across three
related items the user flagged, as one cohesive pass:

1. **BUG** — The website has horizontal overflow on mobile: the whole page slides
   side-to-side while scrolling instead of fitting inside the viewport.
2. **Parity** — The mobile app's audit result rows lack the hairline grid-line
   separators the web has (`.move-row { border-bottom: 1px solid var(--line-soft) }`).
3. **Parity** — The mobile "audit any listing free" / preview screen doesn't feel
   the same as the web `/preview` — align the key visual details (grade badge,
   spacing rhythm).

Two surfaces: `cloud/web` (React + Vite, CSS in `src/app.css`) and `mobile/`
(React Native + Expo).

## Parity depth (decided)

**Match the key visual details** — targeted, keep native conventions. NOT a full
pixel-for-pixel mobile↔web match. Reuse existing theme tokens; introduce no new
design tokens.

## Overflow-fix strategy (decided)

**Defensive guard + fix likely culprits** (belt and suspenders). I cannot
reproduce mobile viewport width in local browser tooling (`resize_window`
resizes the OS window but the page still renders at desktop width), so the true
verification is the **user confirming on a real phone after deploy**. The guard
is a safety net; the culprit fixes address the probable real cause so the guard
isn't merely masking a layout break.

---

## Part 1 — Web horizontal overflow (the bug)

**File:** `cloud/web/src/app.css`

### Root-cause analysis (by code inspection)

- `body` (`app.css:4`) sets `margin: 0` but has **no** `overflow-x` or
  `max-width` guard. Any child wider than the viewport makes the whole page
  scroll horizontally.
- `.move-row` (`app.css:124`): `display: grid; grid-template-columns: 1fr auto auto`.
  A CSS grid `1fr` track has an implicit `min-width: auto`, so a long unbroken
  keyword string in the `1fr` cell (`.kw`) forces the track — and the page —
  wider than the viewport. This is the classic grid-overflow trap.
- `.txt` (`app.css:82`): `flex: 1` with no `min-width: 0`. A flex item's implicit
  `min-width: auto` means the input refuses to shrink below its intrinsic
  content width; inside the audit input row (`ListingAudit.tsx:56`,
  `flex, maxWidth: 480`) a long placeholder/value can push past a narrow
  viewport.

### Changes

**Belt (defensive guard)** — add near the top of `app.css` (after the `body`
rule):

```css
html, body { max-width: 100%; overflow-x: hidden; }
```

**Suspenders (fix likely culprits):**

```css
/* Let the 1fr grid track shrink so a long keyword can't widen the page. */
.move-row { min-width: 0; }
.move-row .kw { min-width: 0; overflow-wrap: anywhere; }

/* Flex inputs must be allowed to shrink below their intrinsic content width. */
.txt { min-width: 0; }

/* Long bundle ids / mono strings wrap instead of forcing width. */
.appcard .bundle, .mono { overflow-wrap: anywhere; }
```

### Verification

- Web build stays green; existing `cloud/web` public tests stay green (the CSS is
  additive/defensive — no DOM/behavior change).
- **User verifies on a real phone after deploy** — the only true test of the
  mobile-width symptom. If the guard hides but doesn't fix, the culprit fixes
  address the underlying cause.

### Scope boundary

Do NOT restyle unrelated components, do NOT change layout beyond the overflow
guard + shrink/wrap fixes, do NOT touch the mobile app in this part.

---

## Part 2 — Mobile grid-line parity

**File:** `mobile/app/(public)/preview.tsx` (the `preview-sample` rows,
lines ~143–153)

### Current state

Sample rows render as `flexDirection: "row", justifyContent: "space-between"`
inside a `View` with `gap: spacing.xs`, with **no** separators. The web's
`.move-row` has `border-bottom: 1px solid var(--line-soft)` between rows
(last row omitted).

### Change

Give each sample row a bottom hairline using the mobile palette's line token
(`palette.line`, the same token `Card` already uses for its border — the mobile
equivalent of the web's soft line), and drop the border on the **last** row to
mirror the web's `.move-row:last-child { border-bottom: 0 }`.

- Replace the outer `gap: spacing.xs` rhythm with per-row vertical padding so the
  hairline sits between rows the way the web's `padding: 8px 0` does.
- Each row: `borderBottomWidth: 1, borderBottomColor: palette.line`, and the last
  row gets `borderBottomWidth: 0`.

The rows already have a `key={s.keyword}`; use the index (or array length) to
detect the last row for the border-drop.

### Verification

- `mobile/app/(public)/preview.test.tsx` (if present) stays green; the sample
  region keeps its `testID="preview-sample"` and per-row content.
- Visual check in the iOS simulator via Argent (already running): hairlines
  appear between sample rows, none after the last.

### Scope boundary

Only the sample rows. Do NOT add borders to the candidate cards or the connect/run
gate (which already has its own `borderTopWidth` divider).

---

## Part 3 — Mobile "audit free" key-detail parity

**File:** `mobile/app/(public)/preview.tsx`

Match the specific web `/preview` touches — key details, not a pixel match:

### 3a. Grade badge → pill

Web renders the grade as `.grade` (`app.css:153`): an `inline-flex` pill —
`min-width: 30px; height: 30px; border-radius: 8px; padding: 0 6px`, mono/700,
`background: var(--signal-glow); color: var(--signal)`.

Mobile currently renders the grade (`preview.tsx:130–134`) as **plain**
`AppText kind="mono"` colored `palette.signal` — no pill. Give it the pill
treatment: a small `View` wrapper with `backgroundColor: palette.signalGlow`
(the mobile equivalent of the web's `var(--signal-glow)` — confirmed present in
both light/dark palettes in `mobile/src/theme/tokens.ts`: `rgba(52,211,153,.18)`
dark / `rgba(15,157,99,.14)` light), `borderRadius: 8`, `minWidth: 30`,
`height: 30`, `paddingHorizontal: 6`, centered (`alignItems`/`justifyContent`
center), containing the mono grade text in `palette.signal`, `fontWeight: "700"`.
This maps 1:1 onto the web `.grade` rule (`app.css:153`). No new token — reuse
`palette.signalGlow`.

### 3b. Spacing rhythm

Align the title → subcopy → input-group gaps to the web's `/preview` rhythm.
The mobile screen already uses `spacing.sm` between the input group and title;
confirm against the web `PreviewView` and adjust only where the mobile gaps
visibly diverge. Keep native `<Screen>` gutter conventions.

### 3c. Copy

Confirm the copy already matches ("Try it — free, no signup" + the subcopy).
It does today (`preview.tsx:86–89`); no change expected — just verify no drift.

### Verification

- `mobile/app/(public)/preview.test.tsx` stays green; `testID="preview-grade"`
  is preserved (the pill wraps the same text node / keeps the testID reachable).
- Simulator visual check via Argent: grade renders as a pill matching the web's
  look; spacing reads like the web `/preview`.

### Scope boundary

No full mobile-web pixel match. No restyling of the login screen, dashboard, or
other screens. No new design tokens.

---

## Testing summary

| Part | Automated | Manual |
| --- | --- | --- |
| 1 (web overflow) | web build + public tests green | **user** on real phone after deploy |
| 2 (grid lines) | mobile preview test green | Argent simulator visual |
| 3 (preview feel) | mobile preview test green (grade testID preserved) | Argent simulator visual |

No new behavior is introduced anywhere; the changes are visual/defensive. Where a
mobile test file does not yet exist for `preview.tsx`, the plan adds a minimal
render test that pins the grade testID and the sample rows rather than leaving
the new visual structure untested.

## Global constraints

- Reuse existing theme tokens on both surfaces; introduce **no** new design tokens.
- Web CSS changes are additive/defensive — no behavior or DOM changes.
- Keep native conventions on mobile (do not clone web layout wholesale).
- Preserve all existing `testID`s (`preview-grade`, `preview-sample`,
  `preview-query`, `preview-search`, `preview-result`).
- The web overflow symptom is verified by the user on a real device, not by CI.
