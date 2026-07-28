/**
 * Nothing on the run page may push the page wider than the viewport.
 *
 * Found by looking at a real run at 1512px: the CLI `asc metadata set …`
 * command, the PPO paragraph and the metadata-budget "wasted budget" lines all
 * ran past the right edge and clipped. A command you cannot read is a command
 * you cannot run, and this page's whole job after approval is handing you one.
 *
 * The layout itself is correct — `.run-shell` uses `minmax(0, 1fr)` and
 * `.run-detail-pane` sets `min-width: 0`, so the grid track CAN shrink. What
 * overflowed is content that refuses to: a long unbroken token inside a `<pre>`
 * has no break opportunity, so it forces its container wide regardless of the
 * track. The fix has to be on the content, not the grid.
 *
 * Asserted against the stylesheet text (same approach as railChrome.test.ts and
 * statusTone.test.ts) because overflow is a layout fact jsdom does not compute:
 * it reports every width as 0, so a rendered assertion would pass vacuously.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "..", "app.css"), "utf8");

/** Declaration block(s) for an exact selector, comments stripped. */
function blocksFor(selector: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sels]) => sels!.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body!);
}

describe("run page cannot overflow horizontally", () => {
  /**
   * The MCP handoff renders a BARE <pre> — not inside .cmd-block — so it never
   * inherited that rule's `overflow-x: auto`. A global rule covers both, and
   * covers the next bare <pre> someone adds without having to remember.
   */
  it("every <pre> can scroll rather than force the page wide", () => {
    const bare = blocksFor("pre").join(" ");
    expect(bare, "app.css needs a global `pre` rule").not.toBe("");
    expect(bare).toMatch(/overflow-x\s*:\s*auto/);
    expect(bare).toMatch(/max-width\s*:\s*100%/);
  });

  /**
   * `overflow-x: auto` alone is not enough inside a grid: a flex/grid item's
   * default `min-width: auto` lets its content set the floor, so the track
   * still grows. `min-width: 0` is what actually lets it shrink.
   */
  it("the scrolling containers can actually shrink inside the grid", () => {
    for (const sel of [".run-detail-pane", ".cmd-block"]) {
      expect(blocksFor(sel).join(" "), `${sel} must be shrinkable`).toMatch(
        /min-width\s*:\s*0/,
      );
    }
  });

  /**
   * Prose overflowed too — the PPO evidence paragraph and the wasted-budget
   * lines. Long unbroken strings (a bundle id, a URL) need a break opportunity
   * or they do the same thing a <pre> does.
   */
  it("cards break long words instead of widening", () => {
    const card = blocksFor(".card").join(" ");
    expect(card).toMatch(/overflow-wrap\s*:\s*(anywhere|break-word)/);
  });

  /** The page itself must never scroll sideways, whatever slips through. */
  it("the run layout clips its own overflow as a backstop", () => {
    expect(blocksFor(".run-shell").join(" ")).toMatch(/max-width\s*:\s*100%/);
  });
});
