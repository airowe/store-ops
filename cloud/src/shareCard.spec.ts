/**
 * Share-a-win card — PURE builder. `pickShareWin` honestly gates on a REAL win
 * (the same credibility bar as /proof: only a climb or a strong new entry), and
 * `renderShareCardSvg` emits a self-contained, branded SVG string (no external
 * fonts/refs) at two aspect ratios. Both are testable with no DOM and no network.
 */
import { describe, expect, it } from "vitest";
import { pickShareWin, renderShareCardSvg } from "./shareCard.js";
import type { RankDeltaView } from "./digest.js";

function view(entries: RankDeltaView["entries"], appName = "Acme"): RankDeltaView {
  return { appName, entries, anyMovement: entries.some((e) => e.direction !== "same") };
}

describe("pickShareWin — only a real, honest win is shareable", () => {
  it("returns the top climber (direction 'up') as the win", () => {
    const v = view([
      { keyword: "budget tracker", current: 12, previous: 40, delta: -28, direction: "up" },
      { keyword: "expenses", current: 33, previous: 10, delta: 23, direction: "down" },
    ]);
    const win = pickShareWin(v);
    expect(win).not.toBeNull();
    expect(win!.keyword).toBe("budget tracker");
    expect(win!.previous).toBe(40);
    expect(win!.current).toBe(12);
    expect(win!.delta).toBe(-28);
  });

  it("returns a strong NEW entry (entered at top-50) as a win", () => {
    const v = view([
      { keyword: "habit app", current: 22, previous: null, delta: null, direction: "new" },
    ]);
    expect(pickShareWin(v)!.direction).toBe("new");
  });

  it("returns null for a weak NEW entry (entered deep, not brag-worthy)", () => {
    const v = view([
      { keyword: "obscure", current: 180, previous: null, delta: null, direction: "new" },
    ]);
    expect(pickShareWin(v)).toBeNull();
  });

  it("returns null when nothing improved (held / down only)", () => {
    const v = view([
      { keyword: "money", current: 15, previous: 15, delta: 0, direction: "same" },
      { keyword: "savings", current: 40, previous: 20, delta: 20, direction: "down" },
    ]);
    expect(pickShareWin(v)).toBeNull();
  });

  it("returns null for an empty view", () => {
    expect(pickShareWin(view([]))).toBeNull();
  });
});

describe("renderShareCardSvg — self-contained branded SVG", () => {
  const win = { keyword: "budget tracker", current: 12, previous: 40, delta: -28, direction: "up" as const };

  it("emits a single-root svg with the brand, the boat mark, and the before→after", () => {
    const svg = renderShareCardSvg(win, { size: "wide", appName: "Acme" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("ShipASO");
    expect(svg).toContain("shipaso.com");
    expect(svg).toContain("M16 6"); // the inlined boat path
    expect(svg).toContain("#34d399"); // signal green
    expect(svg).toContain("#40");
    expect(svg).toContain("#12");
  });

  it("uses the wide viewBox for size 'wide' and square for 'square'", () => {
    expect(renderShareCardSvg(win, { size: "wide", appName: "Acme" })).toContain('viewBox="0 0 1200 630"');
    expect(renderShareCardSvg(win, { size: "square", appName: "Acme" })).toContain('viewBox="0 0 1080 1080"');
  });

  it("escapes a keyword containing markup so the SVG can't be broken out of", () => {
    const evil = { ...win, keyword: 'x<tspan onload="alert(1)">' };
    const svg = renderShareCardSvg(evil, { size: "wide", appName: "Acme" });
    expect(svg).not.toContain("<tspan onload");
    expect(svg).toContain("&lt;tspan");
  });

  it("renders a NEW-entry win without a bogus 'from' number", () => {
    const newWin = { keyword: "habit app", current: 22, previous: null, delta: null, direction: "new" as const };
    const svg = renderShareCardSvg(newWin, { size: "square", appName: "Acme" });
    expect(svg).toContain("#22");
    expect(svg).not.toContain("#null");
  });
});
