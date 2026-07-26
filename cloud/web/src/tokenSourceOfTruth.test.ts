/**
 * app.css must not re-declare a token the generated set already defines (#339).
 *
 * There is one canonical palette: `packages/tokens/tokens.json` → `build.mjs` →
 * `generated/tokens.css`, which `main.tsx` imports BEFORE `app.css`. So a
 * `--token:` in app.css does not merely duplicate the canonical value — it
 * SHADOWS it, and later cascade wins.
 *
 * app.css carried seven such tokens (--rail-bg, --nav-active, --on-accent,
 * --warn-glow, --warn-border, --bad-glow, --brand-glow) with a comment
 * instructing the reader to keep them "byte-identical" to a second file by
 * hand. They were identical, so nothing was visibly wrong — which is exactly
 * why it survived: the failure mode is silent, and only appears when someone
 * edits tokens.json and the app keeps rendering the old value.
 *
 * app.css may still DEFINE a token the canonical set does not have; that is how
 * a web-only surface is introduced. What it may not do is redefine one that
 * exists upstream.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "app.css"), "utf8");
const generated = readFileSync(
  join(here, "..", "..", "..", "packages", "tokens", "generated", "tokens.css"),
  "utf8",
);

/** Custom-property names DECLARED in a stylesheet (`--x: value`), not read via var(). */
function declared(css: string): Set<string> {
  const out = new Set<string>();
  // strip comments so a commented-out example never counts as a declaration
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[;{])\s*(--[a-z0-9-]+)\s*:/gi)) {
    out.add(m[2]!);
  }
  return out;
}

const appTokens = declared(app);
const canonical = declared(generated);

describe("one source of truth for design tokens (#339)", () => {
  it("finds both stylesheets (guards against a moved path)", () => {
    expect(canonical.size).toBeGreaterThan(20);
    expect(app.length).toBeGreaterThan(1000);
  });

  it("app.css never redefines a canonical token", () => {
    const shadowed = [...appTokens].filter((t) => canonical.has(t)).sort();
    expect(shadowed).toEqual([]);
  });

  /**
   * Properties supplied per-element from JSX rather than declared in any
   * stylesheet. These are NOT palette tokens — `--row` is a stagger index set
   * inline in AppDetailView, so its `var(--row, 0)` fallback is legitimate
   * (unlike a colour fallback, which would silently mask a missing token).
   */
  const INLINE_SET = new Set(["--row"]);

  /**
   * The other half: every token app.css READS must exist somewhere, or it
   * renders as nothing at all.
   */
  it("every var() app.css reads is defined by the canonical set or by app.css itself", () => {
    const used = new Set(
      [...app.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]!),
    );
    const missing = [...used]
      .filter((t) => !canonical.has(t) && !appTokens.has(t) && !INLINE_SET.has(t))
      .sort();
    expect(missing).toEqual([]);
  });
});
