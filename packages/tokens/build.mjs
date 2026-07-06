#!/usr/bin/env node
/**
 * PRD 01 spike — generate the design-token artifacts from the canonical
 * `tokens.json`:
 *   • dist/tokens.css → the web `:root` + `:root[data-theme="light"]` custom
 *     properties (the block that lives hand-maintained in styles.css today)
 *   • dist/tokens.ts  → the RN palette + light palette + scales (the file
 *     mobile/src/theme/tokens.ts is by hand today)
 *
 * Production wiring (out of spike scope): styles.css @imports the generated CSS
 * (or inlines it at build), and mobile re-exports the generated TS. Then editing
 * tokens.json updates both surfaces and the drift test is retired.
 *
 * Usage: node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const outDir = join(here, "generated");
mkdirSync(outDir, { recursive: true });

const kebabToCamel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Emit a `:root`-style block of `--name: value;` lines for a theme. */
function cssBlock(selector, theme) {
  const lines = [];
  lines.push(`  --mono: ${tokens.fonts.mono};`);
  lines.push(`  --sans: ${tokens.fonts.sans};`);
  lines.push(`  --display: ${tokens.fonts.display};`);
  lines.push(`  --radius: ${tokens.radius.base};`);
  for (const [k, v] of Object.entries(theme)) lines.push(`  --${k}: ${v};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

const css = `/* GENERATED from packages/tokens/tokens.json — do not edit by hand. */
${cssBlock(":root", tokens.themes.dark)}

${cssBlock(':root[data-theme="light"]', tokens.themes.light)}
`;
writeFileSync(join(outDir, "tokens.css"), css);

/** Emit the RN palette object (camelCased palette keys only). */
function paletteObject(theme) {
  const entries = tokens.paletteKeys.map((k) => `  ${kebabToCamel(k)}: ${JSON.stringify(theme[k])},`);
  return `{\n${entries.join("\n")}\n}`;
}

const ts = `// GENERATED from packages/tokens/tokens.json — do not edit by hand.
export const palette = ${paletteObject(tokens.themes.dark)} as const;
export const lightPalette: Record<keyof typeof palette, string> = ${paletteObject(tokens.themes.light)};
export type Palette = Record<keyof typeof palette, string>;
export type Scheme = "light" | "dark";
export const palettes = { dark: palette, light: lightPalette } as const;
export function paletteFor(scheme: Scheme): Palette {
  return scheme === "light" ? lightPalette : palette;
}
export const fonts = ${JSON.stringify(tokens.fonts, null, 2)} as const;
export const fontSize = ${JSON.stringify(tokens.fontSize, null, 2)} as const;
export const spacing = ${JSON.stringify(tokens.spacing, null, 2)} as const;
export const radius = { base: ${parseInt(tokens.radius.base, 10)} } as const;
`;
writeFileSync(join(outDir, "tokens.ts"), ts);

console.log("[tokens] wrote generated/tokens.css + generated/tokens.ts from tokens.json");
