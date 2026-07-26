#!/usr/bin/env node
/**
 * Token invariants. Exits non-zero on any violation.
 *
 * WHAT THIS PROVES, AND WHAT IT NO LONGER DOES
 *
 * It used to diff tokens.json against `cloud/public/styles.css` — a
 * HAND-MAINTAINED stylesheet — so the parity check was real: two independent
 * artifacts had to agree. That stylesheet was deleted with the legacy dashboard
 * (#356 Phase 3), and the only remaining palette is `generated/tokens.css`,
 * which `build.mjs` produces FROM tokens.json.
 *
 * So the parity section below is now a TAUTOLOGY: `npm test` runs
 * `build.mjs && verify.mjs`, so it compares tokens.json against a mechanical
 * copy of itself and cannot fail. It is kept because it still catches a broken
 * GENERATOR (a build.mjs change that drops or mangles a key), which is a real
 * if narrower guarantee — but it is no longer drift detection, and pretending
 * otherwise would be the kind of check that reassures without checking.
 *
 * The sections that DO still carry weight independently:
 *   • COVERAGE — every theme key is listed in paletteKeys, so no token ships
 *     unverified (#338 shipped two that way).
 *   • CONTRAST — every text token clears WCAG AA against its own background,
 *     in both themes (#318 shipped --faint at 3.5:1).
 *
 * The real consumer-side guard now lives in the web app:
 * `cloud/web/src/tokenSourceOfTruth.test.ts` asserts app.css never redefines a
 * canonical token, which is what actually went wrong (#339).
 *
 * Usage: node verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const css = readFileSync(join(here, "generated/tokens.css"), "utf8");

/** Slice the `{ … }` body of a selector's block out of the stylesheet. */
function block(selector) {
  const at = css.indexOf(selector);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}
function cssVar(body, name) {
  const m = body.match(new RegExp(`--${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
const norm = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();

const rootBody = block(":root");
const lightBody = block(':root[data-theme="light"]');

/**
 * Theme entries that are NOT palette colours and so are exempt from the
 * coverage check. `color-scheme` is a real CSS property (it tells the UA which
 * form-control and scrollbar rendering to use), not a token anything reads.
 */
const NON_PALETTE = new Set(["color-scheme"]);

let failures = 0;

// 0) COVERAGE — `paletteKeys` drives every check below, so a theme entry missing
// from that list is GENERATED and SHIPPED but never verified. That is not
// hypothetical: #338 added --warn-glow/--warn-border to styles.css, app.css and
// mobile without adding them here, and nothing failed. Assert the list covers
// the themes so the next token cannot be silently unpinned.
const themeKeys = Object.keys(tokens.themes.dark).filter((k) => !NON_PALETTE.has(k));
const unlisted = themeKeys.filter((k) => !tokens.paletteKeys.includes(k));
if (unlisted.length) {
  console.error(
    `  ✗ [coverage] ${unlisted.length} theme key(s) absent from paletteKeys, so unverified: ${unlisted.join(", ")}`,
  );
  failures += unlisted.length;
}
const orphaned = tokens.paletteKeys.filter((k) => !(k in tokens.themes.dark));
if (orphaned.length) {
  console.error(`  ✗ [coverage] paletteKeys names ${orphaned.length} key(s) no theme defines: ${orphaned.join(", ")}`);
  failures += orphaned.length;
}

// 1) DARK parity — the hard proof: every palette key in tokens.json must match
// the value shipping in styles.css :root today. This is a no-op or it's drift.
for (const key of tokens.paletteKeys) {
  const want = norm(tokens.themes.dark[key]);
  const got = rootBody ? cssVar(rootBody, key) : null;
  if (got == null) {
    console.error(`  ✗ [dark] --${key} missing from styles.css`);
    failures++;
  } else if (norm(got) !== want) {
    console.error(`  ✗ [dark] --${key}: styles.css=${got} tokens.json=${tokens.themes.dark[key]}`);
    failures++;
  }
}

// 2) LIGHT completeness — the light palette is the forward token set (the SoT
// the web light theme will generate FROM). It need not exist in styles.css yet,
// but it MUST be swap-compatible with dark: same key set, all non-empty. If a
// light [data-theme="light"] block IS present, additionally assert it matches.
const lightKeys = tokens.paletteKeys.filter((k) => typeof tokens.themes.light[k] === "string" && tokens.themes.light[k].length);
if (lightKeys.length !== tokens.paletteKeys.length) {
  console.error(`  ✗ [light] palette is incomplete: ${lightKeys.length}/${tokens.paletteKeys.length} keys`);
  failures++;
}
if (lightBody) {
  for (const key of tokens.paletteKeys) {
    const got = cssVar(lightBody, key);
    if (got != null && norm(got) !== norm(tokens.themes.light[key])) {
      console.error(`  ✗ [light] --${key}: styles.css=${got} tokens.json=${tokens.themes.light[key]}`);
      failures++;
    }
  }
}

// 3) CONTRAST — every text token must clear WCAG AA (4.5:1) against its theme
// background, in BOTH themes. A muted color that's pretty but unreadable is a
// bug (#318): --faint shipped at 3.5–3.8:1. Guard so no token can regress.
// TEXT_TOKENS: palette keys used as foreground text color (not borders/surfaces).
const TEXT_TOKENS = ["ink", "dim", "faint"];
const AA_NORMAL = 4.5;

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function relLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fgHex, bgHex) {
  const L1 = relLuminance(hexToRgb(fgHex));
  const L2 = relLuminance(hexToRgb(bgHex));
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

for (const themeName of ["dark", "light"]) {
  const theme = tokens.themes[themeName];
  const bg = theme.bg;
  for (const key of TEXT_TOKENS) {
    const fg = theme[key];
    const ratio = contrast(fg, bg);
    if (ratio < AA_NORMAL) {
      console.error(
        `  ✗ [contrast:${themeName}] --${key} ${fg} on bg ${bg} = ${ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1)`,
      );
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n[tokens] ${failures} check(s) failed (coverage / generator parity / WCAG AA)`);
  process.exit(1);
}
console.log(
  `[tokens] OK: ${tokens.paletteKeys.length} dark palette values regenerate cleanly` +
    (lightBody ? " (+ light block matches)" : "; light palette complete + swap-compatible"),
);
