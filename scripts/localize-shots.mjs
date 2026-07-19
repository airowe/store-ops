#!/usr/bin/env node
/**
 * localize-shots — the bridge between the pure localization ENGINE
 * (cloud/src/engine/localizeScreenshots.ts) and the pixel RENDERER
 * (lib/render_localized_shots.py). This is the middle of the "automated
 * localization of App Store Previews" loop:
 *
 *     localize-shots.mjs   (this)   translate captions + auto-fit  → manifest.json
 *     render_localized_shots.py     draw manifest onto background  → per-locale PNGs
 *     asc screenshots frame         device framing                 (existing CLI)
 *     asc screenshots review-*      human review gate — STOP        (no auto-upload)
 *
 * It runs the SAME engine the Worker route runs — bundled fresh with esbuild so
 * we never drift from src — so the offline demo and the production route share
 * one honest brain (brand tokens preserved, deterministic auto-fit, RTL excluded
 * with a reason, no half-plans on provider failure).
 *
 * Localizer providers:
 *   --provider offline  (default) reads a pre-translated table (translations.json)
 *                       next to the source. Zero external calls — makes the whole
 *                       loop provable now with the demo fixture. A source caption
 *                       with no table entry is a LOUD error, never shipped as en.
 *   --provider ai       POSTs to a running cloud Worker's /localize/screenshots
 *                       (env CLOUD_BASE_URL) — the real Workers-AI localizer. Use
 *                       for real translations. (Left as the documented seam; the
 *                       offline path is what the demo/workflow exercises.)
 *
 * Usage:
 *   node scripts/localize-shots.mjs \
 *     --source marketing/localize-demo/source.json \
 *     --locales es-ES,de-DE,fr-FR,pt-BR,it-IT \
 *     --out marketing/localize-demo/out
 *
 * Writes <out>/manifest.json (locale → slot → {text,fontSize}) and
 * <out>/excluded.json (locale → reason) — never mutates the store.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const sourcePath = resolve(REPO, arg("source", "marketing/localize-demo/source.json"));
const locales = arg("locales", "es-ES,de-DE,fr-FR,pt-BR,it-IT").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = resolve(REPO, arg("out", "marketing/localize-demo/out"));
const provider = arg("provider", "offline");

const source = JSON.parse(readFileSync(sourcePath, "utf8"));

/** Bundle the pure engine fresh from src so this never drifts from the Worker. */
function loadEngine() {
  const enginePath = join(REPO, "cloud/src/engine/localizeScreenshots.ts");
  const tmp = mkdtempSync(join(tmpdir(), "localize-engine-"));
  const bundle = join(tmp, "engine.mjs");
  const esbuild = join(REPO, "cloud/node_modules/.bin/esbuild");
  execFileSync(esbuild, [
    enginePath, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  return { bundle, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Offline Localizer: a pre-translated table keyed by source text → locale. A
 *  missing entry is a hard error (never ship English posing as a translation —
 *  the engine's own refusal posture, enforced here at the provider). */
function offlineLocalizer() {
  const tablePath = join(dirname(sourcePath), "translations.json");
  const table = JSON.parse(readFileSync(tablePath, "utf8"));
  return async ({ text, targetLocale }) => {
    // the engine masks brand tokens to ⟦N⟧ before calling us; unmask to match
    // the table's plain source key, then the engine re-inserts the brand verbatim.
    const plainKey = text.replace(/⟦\d+⟧/g, "").trim();
    const byLocale = table[plainKey] ?? table[text];
    const hit = byLocale && byLocale[targetLocale];
    if (!hit) {
      throw new Error(`no offline translation for ${JSON.stringify(plainKey)} → ${targetLocale}`);
    }
    // re-apply the placeholder so the engine's unmask restores the brand token
    return text.includes("⟦") ? hit.replace(/^/, "") : hit;
  };
}

/** AI Localizer seam — the real path. POSTs the whole source to a running Worker
 *  and returns its manifest directly (the Worker owns the engine call). Left as
 *  the documented production hook; the offline path drives the demo/workflow. */
async function aiRouteManifest() {
  const base = process.env.CLOUD_BASE_URL;
  if (!base) throw new Error("--provider ai needs CLOUD_BASE_URL (a running cloud Worker)");
  const res = await fetch(`${base.replace(/\/$/, "")}/localize/screenshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: { slots: source.slots },
      targetLocales: locales,
      brandTokens: source.brandTokens ?? [],
    }),
  });
  if (!res.ok) throw new Error(`cloud /localize/screenshots ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Flatten a {localized, excluded} result to the engine's manifest shape,
 *  without needing the engine module (used for the AI route path). */
function flattenManifest(result) {
  const manifest = {};
  for (const shot of result.localized ?? []) {
    manifest[shot.locale] = {};
    for (const s of shot.slots) manifest[shot.locale][s.id] = { text: s.text, fontSize: s.fit.fontSize };
  }
  return manifest;
}

async function main() {
  if (provider === "ai") {
    const result = await aiRouteManifest();
    writeManifest(flattenManifest(result), result);
    return;
  }

  const { bundle, cleanup } = loadEngine();
  try {
    const eng = await import(pathToFileURL(bundle).href);
    const localizer = offlineLocalizer();
    const result = await eng.localizeScreenshots(localizer, {
      source: { slots: source.slots },
      targetLocales: locales,
      brandTokens: source.brandTokens ?? [],
    });
    // reuse the engine's own flattener so the manifest shape is authoritative
    writeManifest(eng.toScreenshotManifest(result), result);
  } finally {
    cleanup();
  }
}

function writeManifest(manifest, result) {
  mkdirSync(outDir, { recursive: true });
  // per-locale needsReview, so the renderer can stamp the review watermark
  const review = {};
  for (const shot of result.localized ?? []) review[shot.locale] = shot.needsReview;
  const excluded = {};
  for (const ex of result.excluded ?? []) excluded[ex.locale] = ex.reason;

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "review.json"), JSON.stringify(review, null, 2) + "\n");
  writeFileSync(join(outDir, "excluded.json"), JSON.stringify(excluded, null, 2) + "\n");

  const nLoc = Object.keys(manifest).length;
  const nRev = Object.values(review).filter(Boolean).length;
  console.log(`localized ${nLoc} locale(s) → ${join(outDir, "manifest.json")}`);
  if (nRev) console.log(`  ${nRev} locale(s) flagged needsReview (overflow/shrink) — see review.json`);
  const exList = Object.keys(excluded);
  if (exList.length) console.log(`  excluded (stated, not rendered): ${exList.join(", ")}`);
}

main().catch((e) => {
  console.error(`localize-shots failed: ${e.message}`);
  process.exit(1);
});
