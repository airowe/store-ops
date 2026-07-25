/**
 * No raw colour literals in components (#350).
 *
 * The token system is only as good as the number of places that ask it for a
 * colour. `packages/tokens/verify.mjs` proves tokens.json matches the shipped
 * stylesheet, but it is silent about a component that never requests a token —
 * which is exactly how two ambers and two non-existent custom properties
 * shipped:
 *
 *   • CppSetsCard / ScreenshotPlanCard hardcoded #d97706, an amber that is in
 *     no palette, rendering identically in both themes (#350).
 *   • FindingsCard reaches for --danger / --muted, neither of which exists, so
 *     `critical` and `info` fall through to hardcoded hex in both themes.
 *
 * Both classes fail SILENTLY: a hex renders fine, and CSS `var()` fallback
 * syntax means a missing custom property never errors. Nothing goes red — the
 * colour just stops following the theme. So this guard reads the source rather
 * than the rendered output, and covers both:
 *
 *   1. a colour literal in a .tsx file, and
 *   2. a `var(--x, …)` reference to a custom property the canonical palette
 *      does not define.
 *
 * Adding to ALLOWED is a deliberate act: it says "this file cannot consume a
 * CSS custom property", which is true of canvas and almost nothing else.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = join(SRC, "..", "..", "..");

/**
 * Files permitted to name a colour directly, each with the reason it cannot go
 * through a token. Canvas paints on a 2D context, which takes concrete colour
 * strings — `var(--signal)` is meaningless to it — so the chart reads the
 * computed custom property at runtime and needs a literal only as the fallback.
 */
const ALLOWED = new Set(["features/charts/RankChart.tsx"]);

/** Every .tsx under src/, excluding tests. */
function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentFiles(full));
    else if (entry.name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every custom property the canonical source defines — the palette plus the
 * non-colour scales (fonts, radius, easing, duration), since a component may
 * legitimately reach for `--display` or `--radius` too.
 */
const tokensJson = JSON.parse(
  readFileSync(join(REPO, "packages/tokens/tokens.json"), "utf8"),
) as { paletteKeys: string[]; fonts: Record<string, string>; radius: Record<string, unknown>;
       easing: Record<string, unknown>; duration: Record<string, unknown> };
const canonicalTokens: ReadonlySet<string> = new Set([
  ...tokensJson.paletteKeys.map((k) => `--${k}`),
  ...Object.keys(tokensJson.fonts).map((k) => `--${k}`),
  ...Object.keys(tokensJson.radius).map((k) => `--radius-${k}`.replace(/-default$/, "")),
  ...Object.keys(tokensJson.easing).map((k) => `--ease-${k}`),
  ...Object.keys(tokensJson.duration).map((k) => `--duration-${k}`),
]);

// `#abc` / `#aabbcc` / `rgb(12,…)`, but NOT `#350` or `#issue-ref` in prose —
// so hex is only counted inside a string literal, where a colour actually lives.
const HEX_IN_STRING = /["'`][^"'`\n]*#[0-9a-fA-F]{3,8}\b[^"'`\n]*["'`]/g;
const RGB_IN_STRING = /["'`][^"'`\n]*\brgba?\(\s*\d/g;
const VAR_REF = /var\(\s*(--[a-z0-9-]+)/gi;

/**
 * Strip comments before scanning. A file header citing an issue ("#324") or an
 * apostrophe in prose ("finding's fix") otherwise reads as a string literal
 * containing a colour — a false positive that would train people to ignore this.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files = componentFiles(SRC).map((f) => ({
  rel: relative(SRC, f).split("\\").join("/"),
  text: stripComments(readFileSync(f, "utf8")),
}));

describe("design tokens are the only source of colour (#350)", () => {
  it("finds components to check (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no component names a colour directly", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .flatMap(({ rel, text }) => {
        const hits = [...(text.match(HEX_IN_STRING) ?? []), ...(text.match(RGB_IN_STRING) ?? [])];
        return hits.map((h) => `${rel}: ${h.trim()}`);
      });
    expect(offenders).toEqual([]);
  });

  // The silent half: `var(--danger, #c0392b)` renders the hex forever and never
  // errors, so a typo'd or imagined token is invisible without this.
  it("every custom property a component references actually exists", () => {
    const offenders = files.flatMap(({ rel, text }) =>
      [...text.matchAll(VAR_REF)]
        .map((m) => m[1]!)
        .filter((token) => !canonicalTokens.has(token))
        .map((token) => `${rel}: var(${token}) is not in the canonical palette`),
    );
    expect(offenders).toEqual([]);
  });
});
