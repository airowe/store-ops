# 002 — Fix the app-card hover: easing, touch-hover, and reduced motion

- **Status**: DONE
- **Commit**: 08b6e81
- **Depends on**: 001 (needs `--ease-out` and `--duration-hover` to exist)
- **Severity**: MEDIUM
- **Category**: Easing & duration (§2), Accessibility (§6)
- **Estimated scope**: 1 file (`cloud/web/src/app.css`), ~10 lines

## Problem

These two lines are the **entire motion surface of the web app** — there is no other `transition`, `@keyframes`, or `animation` anywhere in `cloud/web/src`:

```css
/* cloud/web/src/app.css:74-75 — current */
.appcard { cursor: pointer; transition: border-color .18s, transform .18s; }
.appcard:hover { border-color: var(--signal-dim); transform: translateY(-2px); }
```

Three distinct defects, all confirmed at that location:

1. **No easing function.** `transition: border-color .18s` omits the timing function, so CSS falls back to `ease` — a weak, symmetric default. A card lifting toward the cursor is an *entrance*; the playbook's decision order says entering/exiting → **`ease-out`**, which starts fast and feels responsive. The duration (`.18s` = 180ms) is already correct and must not change.

2. **Ungated `:hover` on a touch device.** On touch, tapping fires `:hover`, and it **sticks** — the card lifts 2px and stays lifted until the user taps elsewhere. It reads as a stuck/broken card. This is a real defect on phones and tablets, not a polish item. The app is a store-ops dashboard people will open on a phone.

3. **No `prefers-reduced-motion` handling — anywhere in the repository.** I grepped `cloud/web/src`, `mobile/src`, `mobile/app`, and `packages/`: there is not one `prefers-reduced-motion` block or `useReducedMotion()` call. Users who have asked their OS to reduce motion still get the `translateY` movement.

## Target

```css
/* cloud/web/src/app.css:74-75 — target */
.appcard {
  cursor: pointer;
  transition: border-color var(--duration-hover) var(--ease-out),
              transform var(--duration-hover) var(--ease-out);
}

/* Touch devices fire a sticky :hover on tap — gate the motion to real pointers. */
@media (hover: hover) and (pointer: fine) {
  .appcard:hover { border-color: var(--signal-dim); transform: translateY(-2px); }
}
```

Then, at the **end of the file**, a global reduced-motion block:

```css
/* Reduced motion: keep the color feedback, drop the movement. Gentler, not zero. */
@media (prefers-reduced-motion: reduce) {
  .appcard { transition: border-color var(--duration-hover) var(--ease-out); }
  .appcard:hover { transform: none; }
}
```

Three things to be precise about, because the instinct is to get them wrong:

- **Reduced motion is not "no motion."** It means *fewer and gentler* animations. The `border-color` transition **stays** — it is a color change that aids comprehension and causes no vestibular discomfort. Only the `transform` (position change) is dropped. Do not write `animation: none` or `transition: none`.
- The hover rule must move **inside** the media query, not be duplicated. There should be exactly one `.appcard:hover` rule in the non-reduced-motion path.
- The `translateY(-2px)` value itself is correct — a subtle lift. Do not change its magnitude.

## Repo conventions to follow

- `cloud/web/src/app.css` is plain hand-written CSS. There is no Tailwind, no CSS-in-JS, no PostCSS nesting — write flat, standard CSS.
- Custom properties come from `@shipaso/tokens`, imported once at `cloud/web/src/main.tsx:6` (`import "@shipaso/tokens/css";`). Any `var(--x)` in `app.css` resolves against that.
- **Exemplar** — `app.css:71` already composes a token-driven interactive state correctly:
  ```css
  .txt:focus { outline: none; border-color: var(--signal-dim); box-shadow: 0 0 0 3px var(--signal-glow); }
  ```
  Note it references tokens (`--signal-dim`, `--signal-glow`) rather than hard-coding values. Do the same for motion: `var(--ease-out)`, never a literal `cubic-bezier(...)`.
- The file is organized in commented sections (`/* public surfaces */`, `/* money screen: ... */`). Put the reduced-motion block at the very end under its own comment.

## Steps

1. **Confirm plan 001 has landed.** In a browser, or by grepping `packages/tokens/generated/tokens.css`, verify `--ease-out` and `--duration-hover` exist. If they do not, STOP — this plan will produce CSS that silently falls back to no transition at all.

2. **`cloud/web/src/app.css:74`** — replace the `.appcard` rule with the tokenized, eased version from the Target section. Keep `cursor: pointer`.

3. **`cloud/web/src/app.css:75`** — wrap the existing `.appcard:hover` rule in `@media (hover: hover) and (pointer: fine) { ... }`. Do not change the declarations inside it; only nest it.

4. **End of `cloud/web/src/app.css`** (after line 160, the last `.rank-chart` rule) — append the `@media (prefers-reduced-motion: reduce)` block from the Target section, with its explanatory comment.

## Boundaries

- Do NOT touch any other rule in `app.css`. In particular, leave `.run-row:hover` (line 103), `.theme-toggle:hover` (line 44), `.btn.bad:hover` (line 68), and `.war-chip:hover` (line 140) alone — they change **color only**, with no transition and no transform, so they have no motion defect and no sticky-hover problem worth solving here.
- Do NOT add transitions to elements that currently have none. This plan fixes the one transition that exists; it does not add motion. (Adding motion is plans 003 and 004.)
- Do NOT change `translateY(-2px)` or `.18s` / `180ms` — both values are correct.
- Do NOT touch `mobile/`, `packages/`, or any `.tsx` file. This is a single-file CSS change.
- Do NOT add dependencies.
- If `app.css:74-75` does not match the "current" excerpt above (drift since commit `08b6e81`), STOP and report.

## Verification

- **Mechanical**:
  - From `cloud/web/`: `npm run build` succeeds.
  - `grep -c "prefers-reduced-motion" src/app.css` returns `1`.
  - `grep -c "hover: hover" src/app.css` returns `1`.
  - `grep "cubic-bezier" src/app.css` returns **nothing** — the curve must come from the token, not be inlined.
- **Feel check** — run `npm run dev` in `cloud/web/` and open the dashboard (the route with the app-card grid):
  - Hover an app card with a mouse. It lifts 2px and the border brightens. In DevTools → Animations panel, set playback speed to **10%** and hover again: the movement should be **fast at the start and settle slowly** into place. If it eases in (slow start), the `--ease-out` token is not resolving — check step 1.
  - **Touch check (the important one)**: DevTools → Toggle device toolbar (⌘⇧M) → pick iPhone → tap a card. The card must **NOT** lift and stay lifted. Before this fix it does; after, tapping should produce no transform at all.
  - **Reduced motion**: DevTools → Rendering panel → "Emulate CSS media feature prefers-reduced-motion" → `reduce`. Hover a card: the **border still brightens** (color feedback preserved) but the card **does not move**. If the border stops changing too, the reduced-motion block is over-aggressive — it should drop movement only.
- **Done when**: all three checks above pass and `npm run build` is clean.
