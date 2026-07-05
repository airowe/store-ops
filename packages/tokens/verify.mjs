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
for (const [themeName, selectorBody] of [["dark", rootBody], ["light", lightBody]]) {
  const theme = tokens.themes[themeName];
  for (const key of tokens.paletteKeys) {
    const want = norm(theme[key]);
    const got = selectorBody ? cssVar(selectorBody, key) : null;
    if (got == null) {
      console.error(`  ✗ [${themeName}] --${key} missing from styles.css`);
      failures++;
    } else if (norm(got) !== want) {
      console.error(`  ✗ [${themeName}] --${key}: styles.css=${got} tokens.json=${theme[key]}`);
      failures++;
    }
  }
}

const total = tokens.paletteKeys.length * 2;
if (failures) {
  console.error(`\n[tokens] DRIFT: ${failures}/${total} palette values disagree with styles.css`);
  process.exit(1);
}
console.log(`[tokens] OK: all ${total} palette values (dark+light) match cloud/public/styles.css`);
