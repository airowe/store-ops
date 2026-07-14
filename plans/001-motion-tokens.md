# 001 — Add motion tokens (easing + duration) to the canonical token source

- **Status**: DONE
- **Commit**: 08b6e81
- **Severity**: LOW (but blocks 002, 003, 004 — do this first)
- **Category**: Cohesion & tokens
- **Estimated scope**: 2 files (`packages/tokens/tokens.json`, `packages/tokens/build.mjs`), ~20 lines

## Problem

`packages/tokens/tokens.json` is the canonical source of truth for BOTH surfaces (web CSS custom properties and the React Native palette). It ships `fonts`, `radius`, `fontSize`, `spacing`, and per-theme colors — but **no motion tokens at all**. There is no `--ease-out`, no duration scale.

The consequence today is small, because the codebase has almost no motion. The single transition in the entire web app hand-types its timing with no easing function:

```css
/* cloud/web/src/app.css:74 — current */
.appcard { cursor: pointer; transition: border-color .18s, transform .18s; }
```

The consequence *tomorrow* is the point. `cloud/web/src/app.css:2` states: "The full design system ports in with the route PRDs." When that port lands and every route starts animating, there is no scale to extend — so each component will invent its own cubic-bezier, and they will almost-but-not-quite match. Establishing the scale now is cheap; consolidating five near-identical curves later is not.

## Target

Motion tokens are **theme-independent** — unlike colors, an easing curve does not change between light and dark. So they belong alongside `radius` / `spacing` as a top-level scale, NOT inside `themes.dark` / `themes.light`.

Add to `packages/tokens/tokens.json` (top level, after `"radius"`):

```json
  "easing": {
    "out": "cubic-bezier(0.23, 1, 0.32, 1)",
    "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
    "drawer": "cubic-bezier(0.32, 0.72, 0, 1)"
  },
  "duration": {
    "press": "140ms",
    "hover": "180ms",
    "popover": "180ms",
    "dropdown": "220ms",
    "modal": "260ms"
  },
```

These are the exact values from the animation playbook. **Do not round, rename, or invent additional curves.** Rationale for each, so you don't "improve" them:

- `out` — strong ease-out. The default for anything entering or exiting; starts fast so the UI feels responsive.
- `in-out` — strong ease-in-out. Only for elements *moving/morphing* on screen (already visible, changing position).
- `drawer` — iOS-like drawer curve. For sheets/drawers only. Included now so the design-system port has it; nothing uses it yet.
- Durations follow the budget: UI motion stays **under 300ms**.

After `build.mjs` runs, `generated/tokens.css` must contain, inside BOTH the `:root` and `:root[data-theme="light"]` blocks:

```css
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --duration-press: 140ms;
  --duration-hover: 180ms;
  --duration-popover: 180ms;
  --duration-dropdown: 220ms;
  --duration-modal: 260ms;
```

And `generated/tokens.ts` must export (for React Native, which needs numeric ms, not CSS strings):

```ts
export const duration = { press: 140, hover: 180, popover: 180, dropdown: 220, modal: 260 } as const;
export const easing = { out: "cubic-bezier(0.23, 1, 0.32, 1)", inOut: "cubic-bezier(0.77, 0, 0.175, 1)", drawer: "cubic-bezier(0.32, 0.72, 0, 1)" } as const;
```

## Repo conventions to follow

- **`generated/tokens.css` and `generated/tokens.ts` are GENERATED. Never edit them by hand** — both carry a "do not edit by hand" header. Edit `tokens.json` and re-run the build.
- The build is `packages/tokens/build.mjs`, run with `node build.mjs` (or `npm run build` in that package).
- The web app already consumes the generated CSS: `cloud/web/src/main.tsx:6` does `import "@shipaso/tokens/css";`. So a new custom property in `tokens.json` is automatically available to `app.css` with no further wiring.
- **Exemplar to imitate** — `build.mjs:30-38`, `cssBlock()`, which already emits theme-independent scales into every theme block:
  ```js
  function cssBlock(selector, theme) {
    const lines = [];
    lines.push(`  --mono: ${tokens.fonts.mono};`);
    ...
    lines.push(`  --radius: ${tokens.radius.base};`);
    for (const [k, v] of Object.entries(theme)) lines.push(`  --${k}: ${v};`);
    return `${selector} {\n${lines.join("\n")}\n}`;
  }
  ```
  Note how `--radius` (theme-independent) is pushed unconditionally, while theme colors come from the `theme` argument. Motion tokens follow the `--radius` pattern exactly.

## Steps

1. **`packages/tokens/tokens.json`** — add the `"easing"` and `"duration"` objects at the top level, immediately after the existing `"radius"` key. Use the exact JSON from the Target section above.

2. **`packages/tokens/build.mjs`** — in `cssBlock()` (around line 30), after the existing `--radius` line, emit the motion tokens. They go in every theme block, exactly like `--radius`:
   ```js
   lines.push(`  --radius: ${tokens.radius.base};`);
   for (const [k, v] of Object.entries(tokens.easing)) lines.push(`  --ease-${k}: ${v};`);
   for (const [k, v] of Object.entries(tokens.duration)) lines.push(`  --duration-${k}: ${v};`);
   ```
   The `--ease-${k}` interpolation turns the JSON key `in-out` into `--ease-in-out`, which is why the JSON key is kebab-case. Do not camelCase it.

3. **`packages/tokens/build.mjs`** — in the TypeScript emitter (the `const ts = ...` template, around line 50), add two exports after the existing `radius` export. React Native cannot use CSS `cubic-bezier` strings or `ms` suffixes for timing values, so durations are emitted as **numbers**:
   ```js
   export const duration = ${JSON.stringify(
     Object.fromEntries(Object.entries(tokens.duration).map(([k, v]) => [k, parseInt(v, 10)])),
     null, 2
   )} as const;
   export const easing = ${JSON.stringify(
     Object.fromEntries(Object.entries(tokens.easing).map(([k, v]) => [kebabToCamel(k), v])),
     null, 2
   )} as const;
   ```
   `kebabToCamel` already exists at `build.mjs:26` — reuse it, don't redefine it. It turns `in-out` into `inOut`.

4. Run the build from `packages/tokens/`:
   ```
   node build.mjs
   ```
   Expected output: `[tokens] wrote generated/tokens.css + generated/tokens.ts from tokens.json`

5. Commit the regenerated `generated/tokens.css` and `generated/tokens.ts` along with the source changes — they are checked into the repo.

## Boundaries

- Do NOT touch `cloud/web/src/app.css` — consuming these tokens is plan 002's job. This plan only *defines* them.
- Do NOT touch `mobile/src/theme/`. The RN side re-exports generated tokens; wiring motion into RN components is out of scope here.
- Do NOT hand-edit anything under `packages/tokens/generated/` — it is overwritten by the build.
- Do NOT add motion values into `themes.dark` / `themes.light`. Easing and duration are theme-independent.
- Do NOT add new dependencies.
- Do NOT invent extra curves or durations beyond the five/three listed. A token nobody uses is a liability.
- If `build.mjs` or `tokens.json` doesn't match the excerpts above (drift since commit `08b6e81`), STOP and report rather than improvising.

## Verification

- **Mechanical**:
  - From `packages/tokens/`: `node build.mjs` exits 0 and prints its success line.
  - `node verify.mjs` still passes (it proves the generated palettes match the live stylesheet — motion tokens must not break it).
  - `grep -c "ease-out" generated/tokens.css` returns `2` (once per theme block).
  - `grep "duration = " generated/tokens.ts` shows numeric values, e.g. `press: 140` — **not** `"140ms"`.
  - From `cloud/web/`: `npx tsc --noEmit` and `npm run build` both succeed.
- **Feel check**: none — this plan adds no visible motion. It is pure plumbing.
- **Done when**: `--ease-out` and `--duration-hover` resolve in the browser. Load the web app, open DevTools, inspect `<html>`, and confirm both appear in the Computed styles' CSS-variables list with the exact values above. If they don't resolve, `app.css` cannot use them and plan 002 will silently no-op.
