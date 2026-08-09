/**
 * shotRender — the device twin of lib/shipshots_render.py. The cross-renderer
 * CONTRACT (docs/shipaton/shipshots-device-render.md) is pinned here with the
 * SAME numeric vectors the Python suite asserts — if either side's WCAG math or
 * color rules drift, one of the two suites goes red.
 */
import {
  DARK_INK,
  HEADLINE_BASE,
  LIGHT_INK,
  MIN_ACCENT_CONTRAST,
  NEUTRAL_BG,
  boxToRect,
  buildShotRender,
  contrastRatio,
  fitText,
  inkFor,
  parseHex,
  wrapLines,
  type RGB,
  type TextMeasurer,
} from "./shotRender.js";
import type { FrameTemplate, PlannedShot } from "../types/api.js";

const NEAR_BLACK: RGB = [7, 9, 14];
const LIGHT_BG: RGB = [246, 247, 249];
const SIGNAL_GREEN: RGB = [52, 211, 153];

/** ~half-em per glyph: deterministic fake measurer for wrap/fit tests. */
const measure: TextMeasurer = (text, size) => text.length * size * 0.5;

const TEMPLATE: FrameTemplate = {
  id: "duo",
  name: "Two-line story",
  sell: "Headline plus subline.",
  slots: {
    headline: { fx: 0.09, fy: 0.06, fw: 0.82, fh: 0.14, align: "center" },
    subline: { fx: 0.09, fy: 0.22, fw: 0.82, fh: 0.07, align: "center" },
  },
  deviceFrame: { fx: 0.14, fy: 0.32, fw: 0.72, fh: 0.6 },
};

const SHOT: PlannedShot = {
  sourceScreen: "frame-1",
  headline: "Track your rank",
  subline: "One dashboard",
  templateId: "duo",
  accent: "#34d399",
};

describe("cross-renderer parity vectors (must match lib/shipshots_render.py)", () => {
  it("pins the WCAG math to the Python renderer's values", () => {
    expect(contrastRatio(SIGNAL_GREEN, NEAR_BLACK)).toBeCloseTo(10.3596, 3);
    expect(contrastRatio(DARK_INK, LIGHT_BG)).toBeCloseTo(16.8805, 3);
    expect(contrastRatio(LIGHT_INK, LIGHT_BG)).toBeCloseTo(1.0719, 3);
    expect(contrastRatio([11, 14, 20], NEAR_BLACK)).toBeCloseTo(1.031, 3);
    expect(MIN_ACCENT_CONTRAST).toBe(3.0);
  });

  it("pins the measured-ink rule both ways", () => {
    expect(inkFor(NEAR_BLACK)).toEqual(LIGHT_INK);
    expect(inkFor(LIGHT_BG)).toEqual(DARK_INK);
  });

  it("pins hex parsing semantics (refused, never guessed)", () => {
    expect(parseHex("#34d399")).toEqual(SIGNAL_GREEN);
    expect(parseHex("34d399")).toEqual(SIGNAL_GREEN);
    for (const bad of ["green", "#34d39", "#34d39g", 42, null, "#34d399ff"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it("pins geometry resolution: round then clamp (mirrors _box)", () => {
    // full-bleed on the 6.7" canvas resolves to exactly the canvas
    expect(boxToRect({ fx: 0, fy: 0, fw: 1, fh: 1 }, 1290, 2796)).toEqual({
      x: 0, y: 0, width: 1290, height: 2796,
    });
    // the duo headline box, same rounding as the Python renderer
    expect(boxToRect(TEMPLATE.slots.headline!, 1290, 2796)).toEqual({
      x: 116, y: 168, width: 1058, height: 391,
    });
  });
});

describe("buildShotRender — color decisions", () => {
  const build = (over: Partial<PlannedShot> = {}, background?: RGB) =>
    buildShotRender({
      shot: { ...SHOT, ...over },
      template: TEMPLATE,
      canvasWidth: 1290,
      canvasHeight: 2796,
      frameUri: "file:///cache/frame-1.jpg",
      ...(background ? { background } : {}),
    });

  it("a readable accent colors the HEADLINE; the subline keeps the ink", () => {
    const r = build({}, NEAR_BLACK);
    expect(r.texts.find((t) => t.slotId === "headline")!.color).toEqual(SIGNAL_GREEN);
    expect(r.texts.find((t) => t.slotId === "subline")!.color).toEqual(LIGHT_INK);
  });

  it("an unreadable accent falls back to the measured ink — never ships", () => {
    const r = build({ accent: "#0b0e14" }, NEAR_BLACK);
    expect(r.texts.find((t) => t.slotId === "headline")!.color).toEqual(LIGHT_INK);
  });

  it("a light background flips the ink dark", () => {
    const { accent: _accent, ...noAccent } = SHOT;
    const r = buildShotRender({
      shot: noAccent,
      template: TEMPLATE,
      canvasWidth: 1290,
      canvasHeight: 2796,
      frameUri: "file:///cache/frame-1.jpg",
      background: LIGHT_BG,
    });
    for (const t of r.texts) expect(t.color).toEqual(DARK_INK);
  });

  it("defaults to the Python renderer's neutral background", () => {
    expect(build().background).toEqual(NEUTRAL_BG);
  });
});

describe("buildShotRender — honesty rules", () => {
  it("MISSING renders a placeholder: reason as caption, no frame, forced review", () => {
    const r = buildShotRender({
      shot: { ...SHOT, sourceScreen: "MISSING", missingReason: "no settings screen captured" },
      template: TEMPLATE,
      canvasWidth: 1290,
      canvasHeight: 2796,
      frameUri: null,
    });
    expect(r.frameUri).toBeNull();
    expect(r.needsReview).toBe(true);
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]!.text).toBe("no settings screen captured");
  });

  it("a real shot with no matching capture is ALSO a placeholder (never fabricated)", () => {
    const r = buildShotRender({
      shot: SHOT,
      template: TEMPLATE,
      canvasWidth: 1290,
      canvasHeight: 2796,
      frameUri: null,
    });
    expect(r.frameUri).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("carries the planner's needsReview flag through", () => {
    const r = buildShotRender({
      shot: { ...SHOT, needsReview: true },
      template: TEMPLATE,
      canvasWidth: 1290,
      canvasHeight: 2796,
      frameUri: "file:///cache/frame-1.jpg",
    });
    expect(r.needsReview).toBe(true);
  });
});

describe("wrap + fit — shrink to the floor, never truncate", () => {
  it("keeps the base size when the text fits", () => {
    const { fontSize, lines } = fitText("Track your rank", { x: 0, y: 0, width: 2000, height: 400 }, HEADLINE_BASE, measure);
    expect(fontSize).toBe(HEADLINE_BASE);
    expect(lines).toEqual(["Track your rank"]);
  });

  it("wraps greedily by word at the measured width", () => {
    // 12 chars/line at size 10 with the half-em measurer → width 60
    expect(wrapLines("aaaa bbbb cccc dddd", 60, 10, measure)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  it("shrinks toward the 70% floor when too wide, never below", () => {
    const { fontSize, lines } = fitText(
      "A fairly long benefit headline that keeps going",
      { x: 0, y: 0, width: 400, height: 240 },
      HEADLINE_BASE,
      measure,
    );
    expect(fontSize).toBeLessThan(HEADLINE_BASE);
    expect(fontSize).toBeGreaterThanOrEqual(Math.round(HEADLINE_BASE * 0.7));
    // every character survives — never truncated
    expect(lines.join(" ")).toBe("A fairly long benefit headline that keeps going");
  });
});
