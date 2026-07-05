# PRD 08 — Chart system (uPlot web · Victory-XL native)

> Replace the two hand-rolled SVG chart implementations with a modern, tokenized
> chart layer: **uPlot** on web (Canvas 2D, <50KB, framework-agnostic) and
> **Victory Native XL** (Skia) on native — a *paired* stack sharing geometry and
> tokens but rendering optimally per platform. Lands with PRD 05 (the first
> chart-bearing route).

## The move
`buildSparkGeometry` (`@shipaso/honesty`) already produces the pure geometry both
surfaces need. Keep it as the shared core; swap the renderers: web `sparkline()`
(inline `createElementNS`) → uPlot; native `react-native-svg` → Victory Native XL.

## Why paired, not Skia-everywhere
React Native Skia runs on web via CanvasKit, but that's a **2.9MB WASM** payload
and a **React** renderer — both antithetical to a lean, (currently) non-React,
SEO-sensitive dashboard. uPlot is Canvas-fast, tiny, and framework-agnostic; Skia
earns its keep on-device. See `../../design/ui-review.md` §2.4.

## Deliverables
- **Web**: a `Chart`/`Sparkline` wrapper over `uplot`, theme-aware (reads the
  token CSS custom properties so light/dark + accent re-tint for free), with the
  gridline floor, rounded caps, soft signal-gradient area, endpoint labels, and
  #62 annotation markers. Replaces the `svg.spark` builder.
- **Native**: a `Sparkline` (+ future multi-series) on Victory Native XL, same
  visual language; the existing pure-geometry tests carry over.
- **Shared**: `buildSparkGeometry` + chart tokens (axis, grid, line, area,
  positive/negative, annotation) in the spine.

## Chart roadmap (enabled, not all in scope now)
1. Point tooltips / scrubbing (both surfaces).
2. Promote coverage gauge + driver bars (`.opp-bar`, `.gap-bar`) to the tokenized
   primitives.
3. War-room multi-series line (you vs. competitors) — PRD 06.

## Honesty
- Null rank → floor + **#200+** label, never `0`; single point → no trend drawn.
- Annotation copy stays correlational (▲ your pushes · ◆ competitor *visible*
  changes; "history starts when tracking started").

## TDD
- Reuse the geometry unit tests (`buildSparkGeometry`): empty <2 points, inverted
  axis, honest null labeling, endpoints inside the padded box.
- Web render smoke: uPlot mounts, re-tints on theme flip.
- Native render smoke: Victory-XL chart renders for a real series, renders
  nothing for <2 points.

## Acceptance
- Web sparkline renders via uPlot with theme-aware colors; ≤ the current bundle
  budget impact (uPlot <50KB, no WASM).
- Native sparkline renders via Victory-XL at parity; geometry tests unchanged.
- Both consume the identical shared geometry.

## Dependencies
- **PRD 01** (geometry in the spine). Ships with **PRD 05**; extended by **PRD 06**.
- Native side requires the dev-client/EAS build (any Skia lib does) — a known,
  accepted cost.
