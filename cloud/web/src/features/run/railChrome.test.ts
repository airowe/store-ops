/**
 * A rail item is a <button>, so it must strip the browser's button chrome.
 *
 * SectionRail renders each section as a real `<button>` — deliberately, for
 * keyboard reach and native Enter/Space (its docstring says so). But `.rail-link`
 * was written as if for an `<a>`: it sets colour, padding and a left border, and
 * never resets `appearance`, `background`, `border` or `font`.
 *
 * The result on screen was every rail item wearing the platform's default button
 * box — a grey bevelled rectangle with the system font — stacked down the left of
 * the run page. The component tests all passed: they assert the item's TEXT and
 * its click behaviour, both of which were correct the entire time. It took
 * looking at the page.
 *
 * This is the same class of defect as #356's status bars and the same fix as
 * `button.card` and `.btn`, which both strip the chrome explicitly. Asserted
 * against the stylesheet text because the defect is the ABSENCE of declarations,
 * which no rendered attribute in jsdom reveals.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read from disk, not `./app.css?raw`: vitest stubs CSS imports, so ?raw would
// resolve to an empty string and every assertion below would pass vacuously.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "..", "app.css"), "utf8");

/** The declaration block(s) for an exact selector, comments stripped. */
function blocksFor(selector: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sels]) => sels!.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body!);
}

const railLink = () => blocksFor(".rail-link").join(" ");

describe(".rail-link strips the browser's button chrome", () => {
  it("has a rule at all (guards against the selector being renamed away)", () => {
    expect(blocksFor(".rail-link").length).toBeGreaterThan(0);
  });

  // Each of these is what a bare <button> brings that an index item must not
  // show: the bevel, the grey fill, and the system font.
  it.each([
    ["appearance", /appearance\s*:\s*none/],
    ["background", /background(-color)?\s*:/],
    ["border", /\bborder\s*:/],
    ["font", /font(-family)?\s*:/],
  ])("resets %s", (_name, pattern) => {
    expect(railLink()).toMatch(pattern);
  });

  it("keeps the left border as the active-state affordance", () => {
    // The reset must not remove what the design uses to mark the active item.
    expect(railLink()).toMatch(/border-left\s*:/);
    expect(blocksFor(".rail-link.active").join(" ")).toMatch(/border-left-color/);
  });

  it("is left-aligned and full width, so items read as a list not as buttons", () => {
    expect(railLink()).toMatch(/text-align\s*:\s*left/);
    expect(railLink()).toMatch(/width\s*:\s*100%/);
  });

  it("stays clickable", () => {
    expect(railLink()).toMatch(/cursor\s*:\s*pointer/);
  });
});
