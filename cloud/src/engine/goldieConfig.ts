/**
 * goldie config emitter (#406 / #521) — the diagnosis half, in goldie's shape.
 *
 * goldie (kacperkapusciak/goldie, MIT) renders App Store screenshot strips on
 * the developer's own Mac from a `goldie.config.ts`: one scene per screenshot,
 * each with a headline and subhead it has no way to originate. We have exactly
 * that: the ShipShots plan (which screens matter, in what order, saying what),
 * the proposed store copy, and the app's locales. This module turns a run into
 * that file. A file, not a service: no macOS in our infrastructure, no
 * binaries, no per-capture billing (owner decision 2026-09-05: capture runs on
 * the developer's Mac).
 *
 * Honesty rules (each is a test):
 *   - a MISSING shot (no captured screen to source it from) becomes no scene;
 *     it is listed as skipped with the reason and commented in the file,
 *   - a headline the planner's lint flagged is kept and carries its issue for
 *     review — flagged, never silently dropped or silently shipped,
 *   - nothing cosmetic is invented: no rating, rating count, or age rating,
 *   - the paths only the developer knows are left for them to fill in,
 *   - the draft label rides through, and so does the planner's `degraded` flag.
 *
 * The shape follows goldie's `goldie.config.example.ts` as read on 2026-09-05
 * (appRoot, appPath, bundleId, devices, locales, appearance, frame, theme,
 * store, scenes). Re-check that file before changing a key here.
 */
import { PLAN_DRAFT_LABEL, type ScreenshotPlan } from "./screenshotPlanner.js";

export type GoldieConfigInput = {
  runId: string;
  /** ISO timestamp, an input so the output is reproducible. */
  generatedAt: string;
  appName: string;
  bundleId: string;
  subtitle?: string | undefined;
  description?: string | undefined;
  developer?: string | undefined;
  category?: string | undefined;
  price?: string | undefined;
  /** storefront locale first, e.g. "en-US"; the rest follow. */
  locales: string[];
  /** locale → the approved localized subtitle, when one exists. */
  localizedSubtitles?: Record<string, string> | undefined;
  plan: ScreenshotPlan;
  /** the user's brand palette; the first entry becomes the strip background. */
  palette?: string[] | undefined;
};

export type GoldieScene = {
  kind: "screenshot";
  id: string;
  flow: string;
  headline: Record<string, string>;
  subhead?: Record<string, string>;
  /** the planner's lint issue, when it flagged this headline. */
  review?: string;
};

export type GoldieConfigDraft = {
  runId: string;
  generatedAt: string;
  label: typeof PLAN_DRAFT_LABEL;
  degraded: boolean;
  bundleId: string;
  devices: ["iphone-6.9"];
  locales: string[];
  appearance: "light" | "dark";
  frame: { variant: "17-pro-blue" };
  theme: { background?: string; layout: "classic" };
  store: {
    name: string;
    subtitle: Record<string, string>;
    developer?: string;
    category?: string;
    price?: string;
    description?: Record<string, string>;
  };
  scenes: GoldieScene[];
  skipped: { headline: string; reason: string }[];
};

function present(s: string | undefined): s is string {
  return typeof s === "string" && s.trim() !== "";
}

export function goldieConfig(input: GoldieConfigInput): GoldieConfigDraft {
  const primary = input.locales[0] ?? "en-US";
  const locales = [...new Set([primary, ...input.locales.slice(1), ...Object.keys(input.localizedSubtitles ?? {})])];

  const scenes: GoldieScene[] = [];
  const skipped: GoldieConfigDraft["skipped"] = [];
  for (const shot of input.plan.shots) {
    if (shot.sourceScreen === "MISSING") {
      skipped.push({ headline: shot.headline, reason: shot.missingReason ?? "no captured screen to source this shot from" });
      continue;
    }
    const n = String(scenes.length + 1).padStart(2, "0");
    scenes.push({
      kind: "screenshot",
      id: shot.sourceScreen,
      flow: `store-${n}-${shot.sourceScreen}`,
      headline: { [primary]: shot.headline },
      ...(present(shot.subline) ? { subhead: { [primary]: shot.subline } } : {}),
      ...(shot.needsReview ? { review: shot.headlineIssue ?? "flagged by the headline lint" } : {}),
    });
  }

  const subtitle: Record<string, string> = {};
  if (present(input.subtitle)) subtitle[primary] = input.subtitle;
  for (const [locale, text] of Object.entries(input.localizedSubtitles ?? {})) if (present(text)) subtitle[locale] = text;

  const background = input.palette?.find(present);

  return {
    runId: input.runId,
    generatedAt: input.generatedAt,
    label: PLAN_DRAFT_LABEL,
    degraded: input.plan.degraded,
    bundleId: input.bundleId,
    devices: ["iphone-6.9"],
    locales,
    appearance: "light",
    frame: { variant: "17-pro-blue" },
    theme: { ...(background ? { background } : {}), layout: "classic" },
    store: {
      name: input.appName,
      subtitle,
      ...(present(input.developer) ? { developer: input.developer } : {}),
      ...(present(input.category) ? { category: input.category } : {}),
      ...(present(input.price) ? { price: input.price } : {}),
      ...(present(input.description) ? { description: { [primary]: input.description } } : {}),
    },
    scenes,
    skipped,
  };
}

// ── the file ─────────────────────────────────────────────────────────────────

const q = (s: string): string => JSON.stringify(s);

function map(m: Record<string, string>, indent: string): string {
  const entries = Object.entries(m).map(([k, v]) => `${indent}  ${q(k)}: ${q(v)},`);
  return `{\n${entries.join("\n")}\n${indent}}`;
}

/** The `goldie.config.ts` text. Paths the developer alone knows are left marked FILL IN. */
export function renderGoldieConfigTs(c: GoldieConfigDraft): string {
  const lines: string[] = [];
  lines.push(`import type { GoldieConfig } from "goldie/config";`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Generated by ShipASO from run ${c.runId} on ${c.generatedAt.slice(0, 10)}.`);
  lines.push(` * ${c.label}.`);
  if (c.degraded) lines.push(` * The plan came from the deterministic fallback, not the model.`);
  lines.push(` *`);
  lines.push(` * Scenes are ordered by the audit's view of what matters; headlines are`);
  lines.push(` * proposals. Record one argent flow per scene under .argent/flows using the`);
  lines.push(` * flow names below, then run \`goldie all\`. goldie writes files locally and`);
  lines.push(` * never uploads; approving and uploading stay yours.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`// FILL IN: the absolute path of the app repo this config lives in.`);
  lines.push(`const APP_ROOT = "/absolute/path/to/your/app";`);
  lines.push(``);
  lines.push(`const config: GoldieConfig = {`);
  lines.push(`  appRoot: APP_ROOT,`);
  lines.push(`  // FILL IN: a Release simulator build (a Debug build needs Metro and paints LogBox into captures).`);
  lines.push(`  appPath: \`\${APP_ROOT}/ios/build/Build/Products/Release-iphonesimulator/YourApp.app\`,`);
  lines.push(`  bundleId: ${q(c.bundleId)},`);
  lines.push(`  devices: ${JSON.stringify(c.devices)},`);
  lines.push(`  locales: ${JSON.stringify(c.locales)},`);
  lines.push(`  appearance: ${q(c.appearance)},`);
  lines.push(`  frame: { variant: ${q(c.frame.variant)} },`);
  lines.push(`  theme: {`);
  if (c.theme.background) lines.push(`    background: ${q(c.theme.background)},`);
  lines.push(`    layout: ${q(c.theme.layout)},`);
  lines.push(`  },`);
  lines.push(`  store: {`);
  lines.push(`    name: ${q(c.store.name)},`);
  lines.push(`    subtitle: ${map(c.store.subtitle, "    ")},`);
  if (c.store.developer) lines.push(`    developer: ${q(c.store.developer)},`);
  if (c.store.category) lines.push(`    category: ${q(c.store.category)},`);
  if (c.store.price) lines.push(`    price: ${q(c.store.price)},`);
  if (c.store.description) lines.push(`    description: ${map(c.store.description, "    ")},`);
  lines.push(`  },`);
  lines.push(`  scenes: [`);
  for (const s of c.scenes) {
    if (s.review) lines.push(`    // REVIEW: ${s.review}`);
    lines.push(`    {`);
    lines.push(`      kind: "screenshot",`);
    lines.push(`      id: ${q(s.id)},`);
    lines.push(`      flow: ${q(s.flow)},`);
    lines.push(`      headline: ${map(s.headline, "      ")},`);
    if (s.subhead) lines.push(`      subhead: ${map(s.subhead, "      ")},`);
    lines.push(`    },`);
  }
  for (const k of c.skipped) {
    lines.push(`    // Skipped: ${k.reason.replace(/\n/g, " ")} (planned headline: ${q(k.headline)})`);
  }
  lines.push(`  ],`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`export default config;`);
  return lines.join("\n") + "\n";
}
