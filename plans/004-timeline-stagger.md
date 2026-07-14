# 004 — Stagger the "What changed" timeline rows on entry

- **Status**: DONE
- **Commit**: 08b6e81
- **Depends on**: 001 (needs `--ease-out`, `--duration-popover`)
- **Severity**: LOW (polish — additive delight, no defect)
- **Category**: Cohesion & stagger (§7), Missed opportunities (§8)
- **Estimated scope**: 2 files (`cloud/web/src/features/appDetail/AppDetailView.tsx`, `cloud/web/src/app.css`), ~15 lines

## Problem

The "What changed" timeline is the app's narrative surface — it shows your approved pushes (▲) and competitors' visible changes (◆) landing over time. All rows currently appear **at once**, instantly, with no motion:

```tsx
/* cloud/web/src/features/appDetail/AppDetailView.tsx:91-97 — current */
<b>What changed</b>
{annotations.slice(-8).map((a, i) => (
  <div key={`${a.at}-${i}`} className="anno-row">
    <span style={{ color: a.kind === "push" ? "var(--signal)" : "var(--warn)" }}>
      {a.kind === "push" ? "▲" : "◆"}
    </span>
    <span>{a.label}</span>
```

```css
/* cloud/web/src/app.css:101 — current */
.anno-row { display: flex; gap: 8px; align-items: baseline; margin-top: 8px; }
```

A group entrance rendered all-at-once is exactly what §7's stagger guidance targets. These rows represent *events that happened in sequence*; showing them as one instant block loses that meaning. A 30–80ms stagger makes the timeline read as events landing over time.

This is genuinely polish — the current UI is not broken. If effort is scarce, do plans 002 and 003 first.

## ⚠️ Pre-existing bug in this exact code — read before starting

`AppDetailView.tsx:92-93` uses `key={`${a.at}-${i}`}` on a `.slice(-8)` **moving window**. When a 9th annotation arrives, every row's index shifts, so React can reconcile a row against the wrong annotation. This is the same defect that was fixed on the mobile side (see `mobile/src/lib/rankSeries.ts`, `annotationKey()`), and it is **still present on web**.

**It is out of scope for this plan** — it is a correctness bug, not a motion bug, and it deserves its own change with its own tests. But it matters here for one reason: **a stagger driven by the array index will visibly misfire when the keys are unstable** (rows will re-animate on re-render). Two acceptable options:

- **Preferred**: fix the key first (port `annotationKey()` from mobile: use `a.runId ?? \`${a.at}:${a.kind}:${a.label}\``), then apply the stagger. Report that you did this.
- **Acceptable**: apply the stagger as specified and note in your summary that the row keys are unstable and the stagger may replay on re-render until that is fixed separately.

Do **not** silently leave it broken without flagging it.

## Target

Stagger via a per-row CSS custom property carrying the row's index, consumed as a `transition-delay`. Rows fade and rise 4px into place.

```tsx
/* AppDetailView.tsx — target: add the index as a custom property */
<div key={/* stable key */} className="anno-row" style={{ "--row": i } as React.CSSProperties}>
```

```css
/* cloud/web/src/app.css:101 — target: extend the existing .anno-row rule */
.anno-row {
  display: flex; gap: 8px; align-items: baseline; margin-top: 8px;
  opacity: 1;
  transform: translateY(0);
  transition: opacity var(--duration-popover) var(--ease-out),
              transform var(--duration-popover) var(--ease-out);
  transition-delay: calc(var(--row, 0) * 40ms);
}
@starting-style {
  .anno-row {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .anno-row {
    transition: opacity var(--duration-popover) var(--ease-out);
    transition-delay: 0ms;
  }
  @starting-style {
    .anno-row { transform: none; }
  }
}
```

Values, and why they are what they are:

- **`40ms` per row** — inside §7's 30–80ms band. With 8 rows the last one starts at 280ms; total settle ≈ 460ms. Longer would start to feel sluggish.
- **`translateY(4px)`** — a whisper. These are dense text rows; anything larger reads as a bounce.
- **Reduced motion drops the movement AND the delay** — a staggered *delay* is itself motion-adjacent and can feel like lag. Rows fade in together instead.
- **Stagger must never block interaction.** These rows are non-interactive text, so there is no risk here — but do not extend this pattern to buttons or links without revisiting that.

## Repo conventions to follow

- Plain hand-written CSS in `app.css`; no Tailwind, no CSS-in-JS.
- Motion values come from tokens (plan 001) — never inline a `cubic-bezier` or raw duration. The one exception is the `40ms` stagger step, which is a per-list rhythm, not a shared motion primitive; inline it in the `calc()`.
- Inline `style` objects are already used in this file for dynamic values — see `AppDetailView.tsx:94`, which sets a colour per row. Setting `--row` inline follows the same established pattern.
- TypeScript requires the cast `as React.CSSProperties` when passing a CSS custom property in a `style` object; without it, `tsc` rejects the unknown `--row` key.

## Steps

1. **Confirm plan 001 has landed** — `--ease-out` and `--duration-popover` must resolve.

2. **Decide on the key** (see the warning above). Either port `annotationKey()` from `mobile/src/lib/rankSeries.ts` and use it, or proceed and flag it in your summary.

3. **`cloud/web/src/features/appDetail/AppDetailView.tsx:93`** — add `style={{ "--row": i } as React.CSSProperties}` to the `.anno-row` div. Change nothing else on that element.

4. **`cloud/web/src/app.css:101`** — extend the existing `.anno-row` rule with the transition, `opacity: 1`, `transform: translateY(0)`, and the `transition-delay` calc from the Target section. Keep the existing layout declarations.

5. **`cloud/web/src/app.css`** — add the `@starting-style` block for `.anno-row`.

6. **`cloud/web/src/app.css`** — extend the reduced-motion media block (from plans 002/003) with the `.anno-row` override: keep the fade, drop the transform and zero the delay.

## Boundaries

- Do NOT touch `.move-row` (`app.css:97`), `.war-grid` rows, or the runs list. This plan staggers **one** list. Do not "consistently" apply it elsewhere — the other lists are longer and a stagger there would feel slow.
- Do NOT add any animation dependency. `@starting-style` + CSS only.
- Do NOT drive child transforms from a parent CSS variable (§5 warns this recalcs styles for all children). Setting `--row` **on each row itself**, as specified, is fine — each element consumes only its own value.
- Do NOT exceed 80ms per step or animate more than the 8 sliced rows.
- Do NOT change the `.slice(-8)` window, the annotation data, or the ▲/◆ semantics.
- If `AppDetailView.tsx:91-97` or `app.css:101` has drifted from the excerpts above since `08b6e81`, STOP and report.

## Verification

- **Mechanical**:
  - From `cloud/web/`: `npx tsc --noEmit` is clean. **This is the step most likely to fail** — if you omitted `as React.CSSProperties`, TS will reject the `--row` key. Do not "fix" that by loosening the type to `any`.
  - `npm run build` succeeds.
  - `npx vitest run src/features/appDetail/` passes — no markup or test id changed.
- **Feel check** — `npm run dev`, open an app detail page with ≥4 annotations, hard-reload:
  - Rows should appear **one after another**, top to bottom, each rising slightly as it fades in. It should read as a gentle cascade, not a wave.
  - DevTools → Animations panel → playback **10%**: confirm each row starts ~40ms after the one above it, and that each rises only a few pixels — not a slide.
  - Scroll away and back, or re-render: rows should **not** re-animate. If they do, the row keys are unstable (see the warning above) — that is the pre-existing key bug, not a fault in the stagger.
  - **Reduced motion**: DevTools → Rendering → `prefers-reduced-motion: reduce`. All rows should fade in **together** (no stagger, no movement). A visible cascade under reduced motion means the `transition-delay: 0ms` override didn't apply.
- **Done when**: the cascade is visible and gentle at normal speed, absent under reduced motion, and `tsc --noEmit` is clean.
