#!/usr/bin/env python3
"""
shipshots_render — the plan→render bridge for ShipShots (#153).

The planner (cloud/src/engine/screenshotPlanner.ts) emits a ScreenshotPlan; the
renderer (render_localized_shots.py) draws pixels. Nothing connected them. This
module is that bridge: it turns each PlannedShot into a RenderJob the existing
render_locale already knows how to draw — reusing the template library
(shot_templates.template_layout), the draw-plan builder (build_draw_plan), and
the renderer verbatim.

Honesty, load-bearing (mirrors the engine):
  • the LLM never paints pixels — this is pure, deterministic mapping,
  • a shot with no real captured screen (MISSING, or a source not among the
    captured screens) renders a labeled PLACEHOLDER whose caption is the
    missingReason — never a fabricated screen — and is forced needs_review so
    render_locale stamps the DRAFT watermark,
  • font size is a deterministic shrink-to-fit that mirrors the engine's
    fitCaption (localizeScreenshots.ts): same coarse glyph metric, same shrink to
    a 70% floor, never truncate — so the same plan renders identical pixels.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from render_localized_shots import (
    Canvas,
    DrawPlan,
    SlotBox,
    _avg_glyph_ratio,
    build_draw_plan,
)
from shot_templates import TEMPLATE_IDS, template_layout

DEFAULT_LINE_HEIGHT = 1.2
_FONT_FLOOR = 0.7  # mirror fitCaption's minSize default (70% of the base size)
_HEADLINE_BASE = 96
_SUBLINE_BASE = 64


def _wrapped_line_count(text: str, chars_per_line: int, per_char: bool) -> int:
    """How many lines `text` wraps to at `chars_per_line`. Mirrors the engine's
    countWrappedLines: CJK breaks per character, everything else greedily by word,
    and a single word longer than the column spills onto extra lines."""
    t = text.strip()
    if not t:
        return 1
    if per_char:
        return max(1, -(-len(t) // chars_per_line))  # ceil-div characters
    lines = 1
    col = 0
    for word in t.split():
        add = len(word) if col == 0 else len(word) + 1
        if col and col + add > chars_per_line:
            lines += 1
            col = len(word)
        else:
            col += add
        if len(word) > chars_per_line:
            lines += (len(word) - 1) // chars_per_line
            col = len(word) % chars_per_line or chars_per_line
    return lines


def fit_headline(text: str, box: SlotBox, base_font: int = _HEADLINE_BASE, locale: str = "en") -> int:
    """Largest whole-px size ≤ base_font at which `text` fits `box`, shrinking to a
    70% floor (mirrors fitCaption). Never returns below the floor; never truncates."""
    ratio = _avg_glyph_ratio(locale)
    per_char = ratio >= 1
    min_size = max(1, round(base_font * _FONT_FLOOR))

    def fits(size: int) -> bool:
        chars_per_line = max(1, int(box.width / (size * ratio)))
        lines = _wrapped_line_count(text, chars_per_line, per_char)
        max_lines = max(1, int(box.height / (size * DEFAULT_LINE_HEIGHT)))
        return lines <= max_lines

    if fits(base_font):
        return base_font
    for size in range(base_font - 1, min_size - 1, -1):
        if fits(size):
            return size
    return min_size


@dataclass(frozen=True)
class RenderJob:
    """One planned shot resolved to everything render_locale needs to draw it."""
    draw_plan: DrawPlan
    device_screen: Optional[str]   # a real capture path, or None (→ placeholder)
    device_frame: SlotBox
    out_name: str


def _coerce_template(template_id) -> str:
    """Map a plan's templateId to a real template. An unknown id coerces to
    headline-top (mirrors the engine's coerceTemplate default) rather than raising
    — template_layout itself would ValueError, so we coerce before calling it."""
    return template_id if template_id in TEMPLATE_IDS else "headline-top"


def plan_to_render_jobs(
    plan: dict,
    canvas: Canvas,
    screen_paths: dict,
    *,
    locale: str = "en",
) -> list:
    """Map a ScreenshotPlan (the planner's JSON) to a list of RenderJobs the
    renderer draws.

    Per shot: resolve its template layout, fit the headline (+ subline, when the
    template has that slot) to the caption box, and resolve the source screen to a
    real path or None. A MISSING source, or one absent from `screen_paths`, is
    rendered as a labeled placeholder (its missingReason becomes the caption) and
    forced needs_review — never a fabricated screen."""
    jobs: list = []
    shots = plan.get("shots") or []
    for i, shot in enumerate(shots):
        template_id = _coerce_template(shot.get("templateId"))
        layout = template_layout(template_id, canvas)

        source = shot.get("sourceScreen")
        real_path = screen_paths.get(source) if isinstance(source, str) else None
        missing = source == "MISSING" or real_path is None

        needs_review = bool(shot.get("needsReview")) or missing

        manifest: dict = {}
        headline_box = layout.slots.get("headline")
        if missing:
            # the honest gap: the reason IS the caption, so the placeholder frame
            # explains itself. No screen is composited underneath.
            reason = shot.get("missingReason") or "no captured screen for this shot"
            if headline_box is not None:
                manifest["headline"] = {"text": reason, "fontSize": fit_headline(reason, headline_box, locale=locale)}
        else:
            headline = (shot.get("headline") or "").strip()
            if headline and headline_box is not None:
                manifest["headline"] = {"text": headline, "fontSize": fit_headline(headline, headline_box, locale=locale)}
            subline_box = layout.slots.get("subline")
            subline = (shot.get("subline") or "").strip()
            if subline and subline_box is not None:
                manifest["subline"] = {"text": subline, "fontSize": fit_headline(subline, subline_box, base_font=_SUBLINE_BASE, locale=locale)}

        draw_plan = build_draw_plan(canvas, layout.slots, manifest, needs_review=needs_review, locale=locale)
        jobs.append(RenderJob(
            draw_plan=draw_plan,
            device_screen=real_path if not missing else None,
            device_frame=layout.device_frame,
            out_name=f"{i + 1:02d}-{template_id}.png",
        ))
    return jobs
