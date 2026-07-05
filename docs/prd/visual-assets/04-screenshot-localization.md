# PRD 04 — screenshot localization (#78 item 3)

Status: **PRD / scoping doc** (owner picked "write a PRD first", 2026-07-05).
No code ships from this doc — it exists to size the surface, name the honesty
rules, and decide where the work lives before anyone builds it. Ties to the
parked #26 Studio tier and to existing `02-screenshot-brief.md` /
`03-studio-generation.md`.

## What's being asked

Astro's referenced stack (@kedytcom) uses Argent for screenshot *design* +
Fastlane for *delivery*. "Screenshot localization" means producing, per target
market, screenshots whose **on-image caption/overlay copy** is translated (and
laid out correctly for that locale) — not merely translating the store's text
metadata (that's the shipped localization feature, `docs/prd/localization/`).

This is a fundamentally bigger surface than text metadata because the copy is
**baked into pixels**: translation is the easy 10%; typesetting, font coverage,
RTL, and per-locale layout are the 90%.

## Why it's out of the text-localization scope

Shipped localization operates on strings ASC stores as text (name/subtitle/
keywords) with per-character limits. Screenshot copy is rendered into an image
asset. That pulls in an entire image pipeline we do not have:

| Concern | Text metadata (shipped) | Screenshot localization (this) |
|---|---|---|
| Output | UTF-8 string, char-limited | Rendered PNG/JPEG per device size per locale |
| Translation | `Localizer` seam (done) | same seam, but re-typeset after |
| Layout | none | per-locale text reflow, overflow, line breaks |
| Fonts | Apple renders | **we** must embed a font covering the script |
| RTL | n/a | Arabic/Hebrew mirror the whole composition |
| Delivery | ASC text PATCH / fastlane `deliver` | fastlane `frameit`/`deliver` screenshot trees per locale |

## The hard problems (the reason for the gate)

1. **Font coverage matrix.** A single Latin font won't render CJK, Arabic,
   Hebrew, Thai, Devanagari, Cyrillic. We need a font fallback stack per script
   with **licenses that permit embedding/redistribution** (Noto family is the
   honest default: open-license, near-complete script coverage). This is a
   licensing + asset-weight decision, not just a code one.
2. **RTL is not a flag.** Arabic/Hebrew mirror layout direction, alignment,
   and often the whole visual composition (device angle, badge placement). A
   naive "translate the caption" produces broken, embarrassing output. Either
   we support RTL properly or we **explicitly exclude RTL locales** and say so.
3. **Text reflow / overflow.** German is ~30% longer than English; CJK is
   shorter but taller. Fixed-size caption boxes overflow or leave dead space.
   Needs auto-fit (shrink-to-fit within min size, then wrap, then truncate with
   an honest "review this shot" flag) — never silent clipping.
4. **Source of the base composition.** We don't design screenshots today
   (`02-screenshot-brief.md` produces a *brief*, not pixels; `03-studio-
   generation.md` is the parked generation path). Localizing screenshots
   presupposes a base composition to localize. **This work depends on #26
   Studio existing** — you can't translate an overlay onto an image we never
   made. Standalone, the most we could do is re-caption a user-supplied layered
   source (PSD/SVG/Figma export), which is a narrower, more tractable v1.

## Two possible v1 scopes (for the go/no-go)

### v1-A — "re-caption a layered source" (no generation dependency)
User provides a layered template (SVG or a defined JSON layout + background
image) with named text slots. We translate the slot copy (existing `Localizer`),
re-typeset with the Noto fallback stack + auto-fit, render per device size per
locale, and emit a fastlane-ready per-locale screenshot tree. Honest flags on
any overflow/truncation and any locale whose script we can't cover.

- **Buildable without #26.** Medium effort (renderer + font stack + layout
  engine + fastlane tree writer). RTL either supported or explicitly excluded.
- Honest value: real localized screenshots for users who already have a design.

### v1-B — full generation + localization
Fold into #26 Studio: generate the base composition *and* localize it. Larger,
parked with #26.

## Honesty rules (hard, either scope)

- **Machine-translated overlay copy is a draft**, labeled exactly like text
  localization (`draft — machine-translated, review before shipping`). Never
  auto-push a localized screenshot to a live store.
- **No silent clipping.** Any locale where copy overflows, truncates, or hits a
  script we can't render is surfaced for human review, not shipped blind.
- **Excluded locales are stated**, not silently dropped. If we don't do RTL in
  v1, the UI says "Arabic/Hebrew not yet supported," never renders them broken.
- **We don't claim design quality we don't produce.** If we re-caption a
  user's template, we say the design is theirs; we localized the copy.

## Recommendation

Write **v1-A** as the honest, dependency-free first cut *if/when* this is
prioritized — but it is **not** on the pre-PMF critical path. The strongest
localization ROI (text metadata) already shipped; screenshot pixels are a
polish/parity feature. Recommend keeping #78 item 3 **open, gated on this PRD,
sequenced after #26 Studio** (which supplies the base compositions v1-B needs
and shares the renderer v1-A would build). Owner decides v1-A-now vs. fold-into-
#26 when Studio is unparked.

## Decision needed to proceed

Owner picks: (a) build v1-A standalone next cycle, or (b) fold entirely into
#26 Studio and keep parked. Until then #78 item 3 stays open with this PRD as
its resolution-of-record.
