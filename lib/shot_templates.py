#!/usr/bin/env python3
"""
shot_templates — the fixed template library for ShipShots (#153).

The planner (cloud/src/engine/screenshotPlanner.ts) emits, per shot, one of four
`templateId`s. This module is the deterministic other half: it resolves a
templateId + a Canvas into a `TemplateLayout` — the caption `SlotBox`es that
build_draw_plan draws into, plus a `device_frame` rect telling render_locale
where to composite the app screen.

"Typography/spacing/frames are code, so the set is internally consistent and
deterministic" (#153). Layouts are expressed as fractions of the canvas, so the
same four templates scale to any App Store device size (iPhone 1290×2796, iPad
2048×2732, …) without hardcoded pixels. Same template + canvas → same boxes.

The four templates, each a distinct composition:
  headline-top     caption band across the top; device below it (the default)
  headline-bottom  device up top; caption band across the bottom
  full-bleed       device fills the canvas; caption overlays a low gradient band
  duo              a two-line story (headline + subline) over a smaller device
"""
from __future__ import annotations

from dataclasses import dataclass, field
from render_localized_shots import Canvas, SlotBox

TEMPLATE_IDS = ("headline-top", "headline-bottom", "full-bleed", "duo")

# a consistent side margin (fraction of width) for caption text across templates
_MARGIN = 0.09


@dataclass(frozen=True)
class TemplateLayout:
    """A resolved template: caption slots + where the device screen goes."""
    slots: dict          # slot_id -> SlotBox (feeds build_draw_plan)
    device_frame: SlotBox  # where render_locale composites the app capture


def _box(canvas: Canvas, *, fx: float, fy: float, fw: float, fh: float, align: str = "center") -> SlotBox:
    """A SlotBox from canvas fractions, rounded to whole pixels and clamped so it
    never spills off the canvas (keeps every template on-canvas at any size)."""
    x = round(fx * canvas.width)
    y = round(fy * canvas.height)
    w = round(fw * canvas.width)
    h = round(fh * canvas.height)
    w = min(w, canvas.width - x)
    h = min(h, canvas.height - y)
    return SlotBox(x=x, y=y, width=w, height=h, align=align)


def _headline_top(canvas: Canvas) -> TemplateLayout:
    # caption band across the top third; device fills the lower two-thirds.
    headline = _box(canvas, fx=_MARGIN, fy=0.06, fw=1 - 2 * _MARGIN, fh=0.15)
    device = _box(canvas, fx=0.10, fy=0.26, fw=0.80, fh=0.66)
    return TemplateLayout(slots={"headline": headline}, device_frame=device)


def _headline_bottom(canvas: Canvas) -> TemplateLayout:
    # device fills the upper two-thirds; caption band across the bottom.
    device = _box(canvas, fx=0.10, fy=0.06, fw=0.80, fh=0.66)
    headline = _box(canvas, fx=_MARGIN, fy=0.79, fw=1 - 2 * _MARGIN, fh=0.15)
    return TemplateLayout(slots={"headline": headline}, device_frame=device)


def _full_bleed(canvas: Canvas) -> TemplateLayout:
    # device dominates the whole canvas; caption overlays a low band near the
    # bottom (the renderer draws it over the composited screen).
    device = _box(canvas, fx=0.0, fy=0.0, fw=1.0, fh=1.0)
    headline = _box(canvas, fx=_MARGIN, fy=0.80, fw=1 - 2 * _MARGIN, fh=0.14)
    return TemplateLayout(slots={"headline": headline}, device_frame=device)


def _duo(canvas: Canvas) -> TemplateLayout:
    # a two-line story: headline + subline stacked over a smaller centered device.
    # the headline band is tall enough for a 2-line wrap, and the subline sits
    # clear below it (no collision even when the headline wraps).
    headline = _box(canvas, fx=_MARGIN, fy=0.06, fw=1 - 2 * _MARGIN, fh=0.14)
    subline = _box(canvas, fx=_MARGIN, fy=0.22, fw=1 - 2 * _MARGIN, fh=0.07)
    device = _box(canvas, fx=0.14, fy=0.32, fw=0.72, fh=0.60)
    return TemplateLayout(slots={"headline": headline, "subline": subline}, device_frame=device)


_RESOLVERS = {
    "headline-top": _headline_top,
    "headline-bottom": _headline_bottom,
    "full-bleed": _full_bleed,
    "duo": _duo,
}


def template_layout(template_id: str, canvas: Canvas) -> TemplateLayout:
    """Resolve a planner templateId + Canvas into a TemplateLayout. Unknown ids
    raise ValueError — the renderer must never guess a layout for a template it
    doesn't have (the engine already whitelists templateId, so this is the
    belt-and-suspenders guard)."""
    resolver = _RESOLVERS.get(template_id)
    if resolver is None:
        raise ValueError(
            f"unknown templateId {template_id!r} — must be one of {TEMPLATE_IDS}"
        )
    return resolver(canvas)
