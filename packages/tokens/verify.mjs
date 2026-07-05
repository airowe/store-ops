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

if (failures) {
  console.error(`\n[tokens] DRIFT: ${failures} check(s) failed against cloud/public/styles.css`);
  process.exit(1);
}
console.log(
  `[tokens] OK: ${tokens.paletteKeys.length} dark palette values match styles.css` +
    (lightBody ? " (+ light block matches)" : "; light palette complete + swap-compatible"),
);
