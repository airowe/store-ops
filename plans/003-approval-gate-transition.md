# 003 — Animate the approve/reject decision (the money moment)

- **Status**: DONE
- **Commit**: 08b6e81
- **Depends on**: 001 (needs `--ease-out`, `--duration-popover`)
- **Severity**: MEDIUM (additive — no defect, but the highest-emotion seam in the product)
- **Category**: Missed opportunities (§8), Physicality (§3), Accessibility (§6)
- **Estimated scope**: 2 files (`cloud/web/src/features/run/RunView.tsx`, `cloud/web/src/app.css`), ~25 lines

## Problem

The approve/reject gate is the reason this product exists — the human decision point where a user commits to changing their live App Store listing. It currently **teleports**: the two buttons vanish and a status line appears in the same frame, with zero transition.

```tsx
/* cloud/web/src/features/run/RunView.tsx:115-128 — current */
{pending ? (
  <div className="btn-row" style={{ display: "flex", gap: 10, marginTop: 14 }}>
    <button className="btn primary" data-testid="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
      {decide.isPending ? "Approving…" : "Approve"}
    </button>
    <button className="btn ghost" data-testid="reject" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
      Reject
    </button>
  </div>
) : (
  <p className={"run-status" + (approved ? " good" : "")} data-testid="run-status">
    {approved ? "Approved · ready to push" : "Rejected"}
  </p>
)}
```

Per the frequency table, this is an **occasional, high-consequence** action — exactly where a standard animation belongs. A brief transition confirms *"your decision registered"* and prevents the jarring instant swap. Right now the most important click in the app feels like a page repaint.

## Target

The result line **fades and scales up from `0.96`** as it appears. Two rules from the playbook are load-bearing here:

- **Never `scale(0)`** — nothing in the real world appears from nothing. Enter from `scale(0.96)` + `opacity: 0`.
- Entering → **`ease-out`**.

Because this element mounts (it does not merely change state), a plain CSS `transition` will not fire on first paint — the browser has no "before" value to interpolate from. Use **`@starting-style`**, which is the modern, JS-free way to animate an entry:

```css
/* cloud/web/src/app.css — append near the .run-status rule (line 129) */
.run-status {
  transition: opacity var(--duration-popover) var(--ease-out),
              transform var(--duration-popover) var(--ease-out);
  opacity: 1;
  transform: scale(1);
}
@starting-style {
  .run-status {
    opacity: 0;
    transform: scale(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .run-status { transition: opacity var(--duration-popover) var(--ease-out); }
  @starting-style {
    .run-status { transform: none; }
  }
}
```

**No TSX change is required for the entry animation** — `@starting-style` handles a mounting element with pure CSS. This is deliberate: it keeps the change small and adds no JS.

`transform-origin` is intentionally left at its default (`center`). The status line is not anchored to a trigger — it replaces the buttons in place — so centre-origin is correct here, the same way it is for a modal.

## Repo conventions to follow

- `cloud/web/src/app.css` is plain hand-written CSS; no Tailwind, no CSS-in-JS.
- `.run-status` already exists at `app.css:129-130`:
  ```css
  .run-status { font-weight: 700; margin-top: 14px; }
  .run-status.good { color: var(--signal); }
  ```
  **Extend this existing rule** — do not create a second `.run-status` block elsewhere in the file.
- Motion values come from tokens (plan 001). Never inline a `cubic-bezier(...)` or a raw `ms` value.
- **Exemplar** — `app.css:71` shows the house style for a token-driven interactive state:
  ```css
  .txt:focus { outline: none; border-color: var(--signal-dim); box-shadow: 0 0 0 3px var(--signal-glow); }
  ```

## Steps

1. **Confirm plan 001 has landed** — `--ease-out` and `--duration-popover` must resolve, or the transition silently becomes instant.

2. **`cloud/web/src/app.css:129`** — extend the existing `.run-status` rule with the `transition`, `opacity: 1`, and `transform: scale(1)` declarations from the Target section. Keep `font-weight: 700; margin-top: 14px;`.

3. **`cloud/web/src/app.css`** — immediately after the `.run-status` rules, add the `@starting-style` block that sets the entry state (`opacity: 0; transform: scale(0.96)`).

4. **`cloud/web/src/app.css`** — extend the existing `@media (prefers-reduced-motion: reduce)` block (added by plan 002, at the end of the file) with the `.run-status` reduced-motion override: keep the opacity fade, drop the scale. If plan 002 has not landed, create the media block.

5. **Do not modify `RunView.tsx`.** Read it to confirm `.run-status` is still the class on the result element (`RunView.tsx:125`), then leave it alone. If the class name has changed, STOP and report.

## Boundaries

- Do NOT change the approve/reject **buttons'** exit. Animating an element *out* on unmount requires JS (the element is gone from the DOM the moment React re-renders) and is not worth the complexity here — the entry animation alone carries the moment. Do not reach for a library to do it.
- Do NOT add `framer-motion`, `motion`, `react-transition-group`, or any animation dependency. The web app has **zero** motion libraries and must keep it that way.
- Do NOT touch the mutation logic, `decide.mutate`, the `data-testid` attributes, or any markup in `RunView.tsx`.
- Do NOT animate `.btn-row` or the buttons themselves.
- Do NOT use `scale(0)` — the entry floor is `0.96`.
- Do NOT exceed 300ms. `--duration-popover` (180ms) is the correct budget.
- If `app.css:129` or `RunView.tsx:115-128` does not match the excerpts above (drift since `08b6e81`), STOP and report.

## Verification

- **Mechanical**:
  - From `cloud/web/`: `npm run build` succeeds and `npx tsc --noEmit` is clean.
  - `npx vitest run src/features/run/RunView.test.tsx` still passes — the `data-testid="run-status"` element is unchanged, so the existing assertions must survive untouched. If any test fails, you changed markup you shouldn't have.
  - `grep "scale(0)" src/app.css` returns **nothing** (only `scale(0.96)` and `scale(1)` are permitted).
- **Feel check** — `npm run dev`, open a run in `awaiting_approval`, click **Approve**:
  - The "Approved · ready to push" line should **fade in while growing slightly** — not pop, not slide.
  - DevTools → Animations panel → playback **10%**: confirm it starts from a *visible but slightly small* state (~96%), never from nothing. If it appears to grow from a point, the `scale(0.96)` is wrong.
  - Confirm it is **fast at the start, settling at the end** (ease-out). A slow start means the token isn't resolving.
  - **Browser support note**: `@starting-style` is supported in Chrome/Edge 117+, Safari 17.5+, Firefox 129+. In an older browser the element simply appears with no animation — an acceptable graceful degradation, **not** a bug to fix with JS.
  - **Reduced motion**: DevTools → Rendering → `prefers-reduced-motion: reduce`. The line should still **fade** in (comprehension preserved) but must **not scale**.
- **Done when**: the approve click produces a visible, fast-settling fade-and-grow; reduced motion drops the scale but keeps the fade; and `RunView.test.tsx` passes untouched.
