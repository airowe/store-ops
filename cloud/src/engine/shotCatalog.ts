/**
 * The marketing frame catalog — the TypeScript mirror of the source of truth at
 * `lib/shot_catalog.json` (which the Python renderer resolves layouts from).
 * This side feeds the planner's template whitelist, the public catalog endpoint
 * (GET /screenshot-templates), and the product pickers, which also use the
 * fraction boxes to draw live previews.
 *
 * MIRROR, not import: the Worker bundle can't reach outside cloud/, so the data
 * is duplicated here and `shotCatalog.spec.ts` deep-diffs this module against
 * the JSON — any drift is a red test, so the two can never disagree silently.
 *
 * Every entry carries the picker-facing marketing metadata (`name`, and `sell` —
 * why this frame converts) alongside the geometry. "Let ShipASO pick" is not an
 * entry: it's the absence of a `templatePreference`, in which case the planner
 * (LLM or deterministic) assigns frames per shot.
 */

export type FrameBox = {
  /** fractions of the canvas — resolution-independent, same as the renderer. */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  align?: "left" | "center" | "right";
};

export type FrameTemplate = {
  id: string;
  /** picker display name. */
  name: string;
  /** why this frame converts — the picker's one-line pitch. */
  sell: string;
  /** caption slots (slotId → box), in draw order. */
  slots: Record<string, FrameBox>;
  /** where the raw app capture is composited. */
  deviceFrame: FrameBox;
};

export const FRAME_CATALOG_VERSION = 1;

export const FRAME_CATALOG = [
  {
    id: "headline-top",
    name: "Headline up top",
    sell: "The classic converter: the promise first, the proof right under it. The safe default for shot #1.",
    slots: { headline: { fx: 0.09, fy: 0.06, fw: 0.82, fh: 0.15, align: "center" } },
    deviceFrame: { fx: 0.1, fy: 0.26, fw: 0.8, fh: 0.66 },
  },
  {
    id: "headline-bottom",
    name: "Screen first",
    sell: "The product leads, the caption lands after — strong when the screen itself is the hook.",
    slots: { headline: { fx: 0.09, fy: 0.79, fw: 0.82, fh: 0.15, align: "center" } },
    deviceFrame: { fx: 0.1, fy: 0.06, fw: 0.8, fh: 0.66 },
  },
  {
    id: "full-bleed",
    name: "Full bleed",
    sell: "Immersive, edge-to-edge product with the caption overlaid low. Great for rich, dense screens.",
    slots: { headline: { fx: 0.09, fy: 0.8, fw: 0.82, fh: 0.14, align: "center" } },
    deviceFrame: { fx: 0.0, fy: 0.0, fw: 1.0, fh: 1.0 },
  },
  {
    id: "duo",
    name: "Two-line story",
    sell: "Headline plus a supporting subline over a centered device — room to explain a non-obvious win.",
    slots: {
      headline: { fx: 0.09, fy: 0.06, fw: 0.82, fh: 0.14, align: "center" },
      subline: { fx: 0.09, fy: 0.22, fw: 0.82, fh: 0.07, align: "center" },
    },
    deviceFrame: { fx: 0.14, fy: 0.32, fw: 0.72, fh: 0.6 },
  },
  {
    id: "editorial",
    name: "Editorial",
    sell: "Left-aligned copy like a feature card, device offset to the right — reads premium, stands out in a row of centered sets.",
    slots: {
      headline: { fx: 0.09, fy: 0.07, fw: 0.82, fh: 0.14, align: "left" },
      subline: { fx: 0.09, fy: 0.23, fw: 0.82, fh: 0.06, align: "left" },
    },
    deviceFrame: { fx: 0.22, fy: 0.33, fw: 0.72, fh: 0.6 },
  },
  {
    id: "spotlight",
    name: "Spotlight",
    sell: "One oversized claim with the product beneath it — built for the single number or benefit that sells the app.",
    slots: { headline: { fx: 0.09, fy: 0.1, fw: 0.82, fh: 0.2, align: "center" } },
    deviceFrame: { fx: 0.08, fy: 0.4, fw: 0.84, fh: 0.55 },
  },
  {
    id: "full-bleed-top",
    name: "Full bleed, promise up top",
    sell: "Edge-to-edge product with the caption at the top — where browsing thumbs never cover it.",
    slots: { headline: { fx: 0.09, fy: 0.07, fw: 0.82, fh: 0.12, align: "center" } },
    deviceFrame: { fx: 0.0, fy: 0.0, fw: 1.0, fh: 1.0 },
  },
  {
    id: "duo-bottom",
    name: "Story after the screen",
    sell: "Device on top, two-line explanation below — the deep-dive frame for shots 3+, after the hook has landed.",
    slots: {
      headline: { fx: 0.09, fy: 0.7, fw: 0.82, fh: 0.13, align: "center" },
      subline: { fx: 0.09, fy: 0.85, fw: 0.82, fh: 0.06, align: "center" },
    },
    deviceFrame: { fx: 0.14, fy: 0.06, fw: 0.72, fh: 0.6 },
  },
] as const satisfies readonly FrameTemplate[];

/** The planner/renderer whitelist, in catalog (= cycling) order. */
export const TEMPLATE_IDS = FRAME_CATALOG.map((t) => t.id) as unknown as readonly TemplateId[];
export type TemplateId = (typeof FRAME_CATALOG)[number]["id"];

export function isTemplateId(id: unknown): id is TemplateId {
  return typeof id === "string" && FRAME_CATALOG.some((t) => t.id === id);
}
