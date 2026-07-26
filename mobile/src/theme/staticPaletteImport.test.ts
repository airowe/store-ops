/**
 * No component may import the STATIC palette (#353).
 *
 * `tokens.ts` exports two palettes. `palette` is the DARK one specifically;
 * `usePalette()` returns whichever is live. Both typecheck, both render, and
 * both look correct in dark — so a component that imports the static one is
 * invisible until someone selects Light and finds dark text on a light card.
 * That is how 39 files drifted before the migration in #353.
 *
 * `tokens.test.ts` proves the VALUES are right in both palettes. It cannot see
 * which palette a component reads, which is the blind spot this closes — the
 * same shape as the web's `noRawHex.test.ts` (#352).
 *
 * Adding to ALLOWED is a deliberate act: it asserts the file renders outside
 * any React tree, where no hook can run.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// __dirname, not import.meta.url: jest transpiles this to CJS, where the latter
// is not available.
const MOBILE = join(__dirname, "..", "..");

/**
 * Files permitted to read the static dark palette, each with the reason a hook
 * cannot serve them. Non-component modules only — never a screen or a card.
 */
const ALLOWED = new Set<string>([
  // The theme module itself defines and re-exports the palettes.
  "src/theme/tokens.ts",
  "src/theme/index.ts",
  "src/theme/ThemeProvider.tsx",
]);

/** Every source file under src/ and app/, excluding tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `import { …, palette, … } from "…/theme…"` — the static dark export. */
const STATIC_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*theme[^"']*["']/g;

const files = [join(MOBILE, "src"), join(MOBILE, "app")]
  .flatMap(sourceFiles)
  .map((f) => ({
    rel: relative(MOBILE, f).split("\\").join("/"),
    text: readFileSync(f, "utf8"),
  }));

describe("components read the live palette, never the static one (#353)", () => {
  it("finds source files to check (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no component imports the static dark palette", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .filter(({ text }) =>
        [...text.matchAll(STATIC_IMPORT)].some((m) =>
          m[1]!.split(",").some((s) => s.trim().replace(/^type\s+/, "") === "palette"),
        ),
      )
      .map(({ rel }) => `${rel} imports the static dark palette — use usePalette()`);
    expect(offenders).toEqual([]);
  });

  // The other half: a literal colour bypasses the palette entirely, which is how
  // login.tsx carried a hardcoded #f87171 (dark `bad`) into light mode.
  it("no component hardcodes a colour literal", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .flatMap(({ rel, text }) => {
        const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const hits = stripped.match(/["'`][^"'`\n]*#[0-9a-fA-F]{3,8}\b[^"'`\n]*["'`]/g) ?? [];
        return hits.map((h) => `${rel}: ${h.trim()}`);
      });
    expect(offenders).toEqual([]);
  });
});
