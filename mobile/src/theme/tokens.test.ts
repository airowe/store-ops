import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fonts, palette, theme } from "./tokens.js";

/** The web's canonical design system — the single source of truth. */
const stylesCss = readFileSync(
  resolve(__dirname, "../../../cloud/public/styles.css"),
  "utf8",
);

/** Pull a `--name: value;` custom property out of the web's :root block. */
function cssVar(name: string): string | null {
  const m = stylesCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

describe("theme tokens", () => {
  it("carries the canonical palette values verbatim", () => {
    expect(palette.bg).toBe("#07090e");
    expect(palette.signal).toBe("#34d399");
    expect(palette.ink).toBe("#eef1f7");
    expect(palette.bad).toBe("#f87171");
    expect(palette.warn).toBe("#fbbf24");
  });

  // The binding test: every ported color must still match the web's :root, so a
  // palette change in styles.css that isn't mirrored here breaks the build.
  it.each([
    ["bg", "bg"],
    ["bg-2", "bg2"],
    ["panel", "panel"],
    ["panel-2", "panel2"],
    ["line", "line"],
    ["line-soft", "lineSoft"],
    ["ink", "ink"],
    ["dim", "dim"],
    ["faint", "faint"],
    ["signal", "signal"],
    ["signal-dim", "signalDim"],
    ["brand", "brand"],
    ["warn", "warn"],
    ["bad", "bad"],
  ] as const)("--%s matches palette.%s", (cssName, key) => {
    const fromCss = cssVar(cssName);
    expect(fromCss).not.toBeNull(); // --${cssName} must exist in styles.css
    expect(palette[key].toLowerCase()).toBe(fromCss!.toLowerCase());
  });

  it("exposes the three canonical font families", () => {
    expect(fonts.mono).toBe("JetBrains Mono");
    expect(fonts.sans).toBe("Space Grotesk");
    expect(fonts.display).toBe("Fraunces");
    // and the web declares them in its --mono/--sans/--display stacks
    expect(cssVar("mono")).toContain("JetBrains Mono");
    expect(cssVar("sans")).toContain("Space Grotesk");
    expect(cssVar("display")).toContain("Fraunces");
  });

  it("assembles a theme object that bundles palette + fonts", () => {
    expect(theme.palette).toBe(palette);
    expect(theme.fonts).toBe(fonts);
    expect(theme.radius.base).toBeGreaterThan(0);
  });
});
