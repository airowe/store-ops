/**
 * shotRender — the PURE half of the on-device ShipShots renderer: a planned
 * shot + its catalog frame + a captured screen → a deterministic ShotRender
 * (rects, colors, wrapped lines) that the thin Skia executor just draws.
 *
 * This is the device twin of the Python bridge (lib/shipshots_render.py). The
 * two renderers share ONE contract — catalog geometry, WCAG color rules,
 * honesty rules — pinned by identical numeric vectors in both test suites; see
 * docs/shipaton/shipshots-device-render.md. Pixel identity is NOT a goal
 * (Skia measures real glyphs), geometry/color/honesty identity is.
 *
 * Honesty, load-bearing:
 *   • a shot without a real captured frame renders a labeled PLACEHOLDER whose
 *     caption is the missingReason — never a fabricated screen — and is forced
 *     needsReview so the executor stamps the DRAFT watermark,
 *   • an accent paints the headline only when it MEASURES readable against the
 *     known solid background; otherwise the measured ink. Malformed hex is
 *     refused, never guessed at,
 *   • captions shrink to a 70% floor and are never truncated.
 */
import type { FrameBox, FrameTemplate, PlannedShot } from "../types/api.js";

export type RGB = readonly [number, number, number];

/** WCAG large-text AA — same constant the Python renderer enforces. */
export const MIN_ACCENT_CONTRAST = 3.0;
export const DARK_INK: RGB = [17, 22, 33];
export const LIGHT_INK: RGB = [255, 255, 255];
/** The Python renderer's neutral fill (render_locale's default). */
export const NEUTRAL_BG: RGB = [14, 16, 22];

const FONT_FLOOR = 0.7;
export const HEADLINE_BASE = 96;
export const SUBLINE_BASE = 64;
export const LINE_HEIGHT = 1.2;

/** "#rrggbb" → RGB; anything else → null (refused, never guessed). */
export function parseHex(value: unknown): RGB | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as unknown as RGB;
}

function relLuminance([r, g, b]: RGB): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio (1..21) — identical math to the Python side. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The measured readable ink for a solid background — never mid-gray. */
export function inkFor(background: RGB): RGB {
  return contrastRatio(LIGHT_INK, background) >= contrastRatio(DARK_INK, background)
    ? LIGHT_INK
    : DARK_INK;
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Fraction box → pixel rect: round, then clamp on-canvas (mirrors _box). */
export function boxToRect(b: FrameBox, canvasW: number, canvasH: number): Rect {
  const x = Math.round(b.fx * canvasW);
  const y = Math.round(b.fy * canvasH);
  return {
    x,
    y,
    width: Math.min(Math.round(b.fw * canvasW), canvasW - x),
    height: Math.min(Math.round(b.fh * canvasH), canvasH - y),
  };
}

/** Injected text measurer: rendered width in px of `text` at `fontSize`. */
export type TextMeasurer = (text: string, fontSize: number) => number;

/** Greedy word wrap at the measured width (a single over-long word overflows
 *  its own line rather than being truncated — never drop characters). */
export function wrapLines(text: string, maxWidth: number, fontSize: number, measure: TextMeasurer): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && measure(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

/** Largest size ≤ base at which the wrapped text fits the rect, shrinking to
 *  the 70% floor (mirrors fitCaption / fit_headline). Never truncates. */
export function fitText(
  text: string,
  rect: Rect,
  base: number,
  measure: TextMeasurer,
): { fontSize: number; lines: string[] } {
  const floor = Math.max(1, Math.round(base * FONT_FLOOR));
  for (let size = base; size >= floor; size--) {
    const lines = wrapLines(text, rect.width, size, measure);
    const fitsW = lines.every((l) => measure(l, size) <= rect.width);
    const fitsH = lines.length * size * LINE_HEIGHT <= rect.height;
    if (fitsW && fitsH) return { fontSize: size, lines };
  }
  return { fontSize: floor, lines: wrapLines(text, rect.width, floor, measure) };
}

export type ShotText = {
  slotId: string;
  text: string;
  rect: Rect;
  align: "left" | "center" | "right";
  color: RGB;
  baseFontSize: number;
};

export type ShotRender = {
  canvasWidth: number;
  canvasHeight: number;
  background: RGB;
  /** the captured frame to composite (contain-fit), or null for a placeholder. */
  frameUri: string | null;
  deviceRect: Rect;
  texts: ShotText[];
  /** true → the executor stamps the DRAFT watermark. */
  needsReview: boolean;
};

/**
 * Resolve one planned shot against its catalog template. `frameUri` is the
 * captured screen for the shot's sourceScreen id — pass null when there isn't
 * one and the shot renders as an honest placeholder.
 */
export function buildShotRender(opts: {
  shot: PlannedShot;
  template: FrameTemplate;
  canvasWidth: number;
  canvasHeight: number;
  frameUri: string | null;
  background?: RGB;
}): ShotRender {
  const { shot, template, canvasWidth, canvasHeight } = opts;
  const background = opts.background ?? NEUTRAL_BG;
  const ink = inkFor(background);

  const accent = parseHex(shot.accent);
  const headlineColor =
    accent !== null && contrastRatio(accent, background) >= MIN_ACCENT_CONTRAST ? accent : ink;

  const missing = shot.sourceScreen === "MISSING" || opts.frameUri === null;
  const deviceRect = boxToRect(template.deviceFrame, canvasWidth, canvasHeight);

  const texts: ShotText[] = [];
  const slot = (slotId: string, text: string, color: RGB, baseFontSize: number) => {
    const box = template.slots[slotId];
    if (!box || !text.trim()) return;
    texts.push({
      slotId,
      text: text.trim(),
      rect: boxToRect(box, canvasWidth, canvasHeight),
      align: (box.align === "left" || box.align === "right" ? box.align : "center") as ShotText["align"],
      color,
      baseFontSize,
    });
  };

  if (missing) {
    // the honest gap: the reason IS the caption; nothing composites underneath.
    slot("headline", shot.missingReason ?? "no captured screen for this shot", ink, HEADLINE_BASE);
  } else {
    slot("headline", shot.headline, headlineColor, HEADLINE_BASE);
    if (shot.subline) slot("subline", shot.subline, ink, SUBLINE_BASE);
  }

  return {
    canvasWidth,
    canvasHeight,
    background,
    frameUri: missing ? null : opts.frameUri,
    deviceRect,
    texts,
    needsReview: Boolean(shot.needsReview) || missing,
  };
}
