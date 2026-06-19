#!/usr/bin/env node
/**
 * Build step for the static Pages dashboard: content-hash the assets so a deploy
 * always invalidates the client bundle (#40 — a stale cached app.js once made a
 * preview audit the WRONG app).
 *
 * Reads `public/`, stamps via the pure `stampAssets` (the SAME logic the unit
 * tests cover — imported directly; Node strips the TS), and writes a deploy-ready
 * `dist/`:
 *   • index.html         → references the hashed asset names (served no-cache)
 *   • <name>.<hash>.<ext> → the hashed, cache-forever assets
 *   • everything else in public/ (favicons, etc.) copied through verbatim
 *
 * `public/` is left UNTOUCHED so local dev + Playwright E2E keep loading the
 * plain filenames. CI runs `npm run build:dashboard` then
 * `wrangler pages deploy dist`.
 *
 * Usage: node scripts/stamp-assets.mjs [srcDir=public] [outDir=dist]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stampAssets } from "../src/build/stampAssets.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcDir = resolve(root, process.argv[2] ?? "public");
const outDir = resolve(root, process.argv[3] ?? "dist");

// Assets eligible for hashing (referenced from index.html). Everything else in
// public/ is copied through unchanged.
const HASHABLE = /\.(js|css)$/;
const ENTRY = "index.html";

function listFiles(dir) {
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile());
}

const files = listFiles(srcDir);
if (!files.includes(ENTRY)) {
  console.error(`[stamp-assets] no ${ENTRY} in ${srcDir}`);
  process.exit(1);
}

const html = readFileSync(join(srcDir, ENTRY), "utf8");
const assets = files
  .filter((n) => HASHABLE.test(n))
  .map((n) => ({ name: n, body: new Uint8Array(readFileSync(join(srcDir, n))) }));

const { html: stampedHtml, assets: stampedAssets } = stampAssets(html, assets);

// Which source filenames actually got stamped (i.e. were referenced in the
// HTML)? Those are emitted under their hashed name; an un-referenced .js/.css is
// NOT stamped and must still be copied through verbatim. stampAssets preserves
// the stem, so source "app.js" → stamped "app.<hash>.js" — match on the stem.
const stem = (n) => n.slice(0, n.indexOf("."));
const stampedStems = new Set(stampedAssets.map((f) => stem(f.name)));

// Fresh dist/.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 1) hashed assets
for (const f of stampedAssets) {
  writeFileSync(join(outDir, f.name), Buffer.from(f.body));
}
// 2) rewritten entry html (Pages serves .html with no-cache → always current)
writeFileSync(join(outDir, ENTRY), stampedHtml);
// 3) pass-through everything that wasn't a hashed asset or the entry html
//    (e.g. additional html, images, robots.txt) so dist/ is a complete site.
for (const n of files) {
  if (n === ENTRY) continue;
  if (HASHABLE.test(n) && stampedStems.has(stem(n))) continue; // already emitted hashed
  writeFileSync(join(outDir, n), readFileSync(join(srcDir, n)));
}

const stampedCount = stampedAssets.length;
console.log(`[stamp-assets] ${srcDir} → ${outDir}: ${stampedCount} asset(s) hashed, ${files.length - stampedCount - 1} copied, index.html rewritten`);
for (const f of stampedAssets) console.log(`  • ${f.name}`);
