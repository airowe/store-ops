/**
 * A status LABEL takes its tone as a colour, never as a background (#356).
 *
 * The history row pairs an 8px filled dot with a text label, and both wear the
 * same `is-*` tone class. They were first written as one shared selector list
 * setting `color` AND `background`, which painted each label's own tone behind
 * its text as a full-width bar — the status was unreadable, and every run in
 * the history looked like a progress meter. The reset that tried to undo it
 * (`.pruns-history-status { background: none }`) lost on specificity to
 * `.pruns-history-status.is-signal`, so it had no effect at all.
 *
 * Nothing caught this: the component tests assert the label's TEXT, which was
 * present and correct the whole time. It took looking at the page.
 *
 * Asserted against the stylesheet text (the approach `formControls.test.ts`
 * and `packages/tokens/verify.mjs` already use) because the defect lives in
 * selector specificity, not in any rendered attribute.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read from disk, not `./app.css?raw`: vitest stubs CSS imports, so ?raw
// resolves to an empty string and every assertion below would pass vacuously.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "..", "app.css"), "utf8");

const TONES = ["dim", "brand", "warn", "signal", "bad", "faint"] as const;

// Strip comments before parsing: a `/* … */` block sitting above a rule is
// otherwise swallowed into that rule's selector text, so no selector ever
// compares equal to the bare class. (noRawHex.test.ts needed the same fix.)
const source = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in the stylesheet, as [selectorList, declarations]. */
const RULES: Array<[string, string]> = [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [
  m[1]!.trim(),
  m[2]!,
]);

/**
 * Declaration blocks of rules whose selector list contains `sel` as a WHOLE
 * selector. Substring matching would be wrong here: ".pruns-history-status"
 * is a substring of ".pruns-history-status.is-signal", and
 * ".pruns-status-dot.is-dim" sits in a selector list that also contains
 * ".pruns-history-status.is-dim" — so a loose match reads one rule's
 * declarations as another's.
 */
function blocksFor(sel: string): string[] {
  return RULES.filter(([selectors]) =>
    selectors.split(",").some((s) => s.trim() === sel),
  ).map(([, body]) => body);
}

describe("run history status tones (#356)", () => {
  it("finds the rules at all (guards against a renamed class)", () => {
    for (const tone of TONES) {
      expect(blocksFor(`.pruns-history-status.is-${tone}`).length).toBeGreaterThan(0);
      expect(blocksFor(`.pruns-status-dot.is-${tone}`).length).toBeGreaterThan(0);
    }
  });

  it.each(TONES)("the .is-%s LABEL sets a colour and no background", (tone) => {
    const blocks = blocksFor(`.pruns-history-status.is-${tone}`);
    expect(blocks.length).toBeGreaterThan(0);
    const body = blocks.join(";");
    expect(body).toMatch(/color:\s*var\(--/);
    // `background`, `background-color`, or the shorthand — none of them belong
    // on text whose tone is already carried by `color`.
    expect(body).not.toMatch(/background(-color)?\s*:\s*var\(--/);
  });

  it.each(TONES)("the .is-%s DOT sets a background (it is a filled circle)", (tone) => {
    const body = blocksFor(`.pruns-status-dot.is-${tone}`).join(";");
    expect(body).toMatch(/background:\s*var\(--/);
  });

  /**
   * The specific trap: one selector list covering both elements. Whatever it
   * sets, it sets on the text too, so the split has to hold structurally
   * rather than by whoever edits last remembering why.
   */
  it("no single rule styles both the dot and the label", () => {
    const shared = RULES.map(([selectors]) => selectors).filter(
      (s) => s.includes(".pruns-status-dot") && s.includes(".pruns-history-status"),
    );
    expect(shared).toEqual([]);
  });
});
