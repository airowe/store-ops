/**
 * Form controls must be STYLED, not browser defaults (#343).
 *
 * app.css shipped with no `input` / `textarea` / `select` selector at all, so
 * every text field in the app rendered as a raw grey browser control. The
 * `.txt` class had the correct token-driven treatment all along — it was simply
 * never applied. These tests pin the bare-element rule so a field can never
 * again reach a customer unstyled just because someone forgot a className.
 *
 * Asserted against the stylesheet text (the same approach as
 * packages/tokens/verify.mjs) because the rule's whole job is to apply without
 * any markup opting in — there is no component to render and inspect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read from disk rather than importing `./app.css?raw`: vitest stubs CSS
// imports, so ?raw resolves to an empty string and every assertion below would
// pass vacuously. `node:*` needs @types/node on the typecheck path — see the
// tsconfig `types` entry added alongside this file.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "app.css"),
  "utf8",
);

/** The `{ … }` body of a selector's block, or null when the selector is absent. */
function ruleBody(selector: string): string | null {
  const pattern = new RegExp(
    `(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const match = css.match(pattern);
  return match ? match[2]!.trim() : null;
}

const BARE_CONTROLS = "input, textarea, select";

describe("form control styling (#343)", () => {
  it("styles bare input/textarea/select, so a field needs no className to look right", () => {
    expect(ruleBody(BARE_CONTROLS)).not.toBeNull();
  });

  // The grey box was a browser default background. These four properties are
  // what actually replace it; a rule that sets only some still reads as unstyled.
  it.each([
    ["background", "var(--bg-2)"],
    ["color", "var(--ink)"],
    ["border", "1px solid var(--line)"],
    ["border-radius", "10px"],
  ])("paints %s from the token layer", (property, value) => {
    const body = ruleBody(BARE_CONTROLS) ?? "";
    expect(body).toContain(`${property}: ${value}`);
  });

  it("inherits the app font rather than the browser's control font", () => {
    expect(ruleBody(BARE_CONTROLS) ?? "").toContain("font: inherit");
  });

  it("keeps a visible focus ring — removing the outline without one fails WCAG", () => {
    const focus = ruleBody(`${BARE_CONTROLS.split(", ").join(":focus, ")}:focus`);
    expect(focus).not.toBeNull();
    expect(focus!).toContain("box-shadow: 0 0 0 3px var(--signal-glow)");
    expect(focus!).toContain("border-color: var(--signal-dim)");
  });

  it("matches the .txt treatment it derives from, so the two cannot drift apart", () => {
    const bare = ruleBody(BARE_CONTROLS) ?? "";
    const txt = ruleBody(".txt") ?? "";
    for (const property of ["background", "color", "border", "border-radius", "padding"]) {
      const from = (body: string) =>
        body.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`))?.[1]?.trim();
      expect(from(bare)).toBe(from(txt));
    }
  });

  // Checkboxes and radios are not text fields — a 10px radius and 9px padding
  // would visibly break them, so the rule must scope itself away.
  it("does not restyle checkboxes and radios", () => {
    expect(css).toMatch(/input\[type=["']?checkbox/);
    expect(css).toMatch(/input\[type=["']?radio/);
  });
});
