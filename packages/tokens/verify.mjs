#!/usr/bin/env node
/**
 * PRD 01 spike proof — assert the canonical tokens.json reproduces the palette
 * that lives in the live web stylesheet TODAY, for BOTH themes:
 *   • dark  values  == cloud/public/styles.css  :root { … }
 *   • light values  == cloud/public/styles.css  :root[data-theme="light"] { … }
 *
 * This is the whole point of the source-of-truth: generating from tokens.json
 * must be a no-op against what's already shipped. Exits non-zero on any drift.
 *
 * Usage: node verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const css = readFileSync(join(here, "../../cloud/public/styles.css"), "utf8");

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

let failures = 0;

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
  console.error(`\n[tokens] ${failures} check(s) failed against cloud/public/styles.css / WCAG AA`);
  process.exit(1);
}
console.log(
  `[tokens] OK: ${tokens.paletteKeys.length} dark palette values match styles.css` +
    (lightBody ? " (+ light block matches)" : "; light palette complete + swap-compatible"),
);
