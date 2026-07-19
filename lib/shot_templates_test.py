#!/usr/bin/env python3
"""
Unit tests for shot_templates — the fixed template library (#153). Each
templateId the planner emits (headline-top / headline-bottom / full-bleed / duo)
resolves to a deterministic layout: caption SlotBoxes (for build_draw_plan) plus
a device_frame rect (where render_locale composites the app screen). Pure,
no Pillow. Run:  python3 shot_templates_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shot_templates import (  # noqa: E402
    TEMPLATE_IDS,
    template_layout,
    TemplateLayout,
)
from render_localized_shots import Canvas, SlotBox  # noqa: E402

CANVAS = Canvas(width=1290, height=2796)


def _within_canvas(box, canvas: Canvas) -> bool:
    return (0 <= box.x and 0 <= box.y and
            box.x + box.width <= canvas.width and
            box.y + box.height <= canvas.height)


# ── the library covers exactly the planner's templateIds ─────────────────────
def test_library_covers_the_planner_template_ids():
    # the same four ids the engine's TEMPLATE_IDS declares
    assert set(TEMPLATE_IDS) == {"headline-top", "headline-bottom", "full-bleed", "duo"}


def test_every_template_resolves():
    for tid in TEMPLATE_IDS:
        layout = template_layout(tid, CANVAS)
        assert isinstance(layout, TemplateLayout)


def test_unknown_template_raises():
    try:
        template_layout("spinny-3d-carousel", CANVAS)
        raise AssertionError("expected ValueError for an unknown template")
    except ValueError as e:
        assert "spinny-3d-carousel" in str(e)


# ── every template's boxes are a usable layout for build_draw_plan ───────────
def test_headline_slot_present_and_on_canvas_for_every_template():
    for tid in TEMPLATE_IDS:
        layout = template_layout(tid, CANVAS)
        assert "headline" in layout.slots, f"{tid} must expose a headline slot"
        assert _within_canvas(layout.slots["headline"], CANVAS), f"{tid} headline off-canvas"
        assert isinstance(layout.slots["headline"], SlotBox)


def test_device_frame_on_canvas_for_every_template():
    for tid in TEMPLATE_IDS:
        layout = template_layout(tid, CANVAS)
        assert _within_canvas(layout.device_frame, CANVAS), f"{tid} device frame off-canvas"


def test_caption_and_device_do_not_overlap_when_headline_is_top():
    # headline-top: caption sits ABOVE the device frame (no overlap)
    layout = template_layout("headline-top", CANVAS)
    head = layout.slots["headline"]
    dev = layout.device_frame
    assert head.y + head.height <= dev.y, "headline-top caption must clear the device frame"


def test_headline_bottom_puts_caption_below_device():
    layout = template_layout("headline-bottom", CANVAS)
    head = layout.slots["headline"]
    dev = layout.device_frame
    assert dev.y + dev.height <= head.y, "headline-bottom caption must sit below the device"


def test_full_bleed_device_fills_most_of_the_canvas():
    # full-bleed: the device screen dominates; caption overlays near an edge
    layout = template_layout("full-bleed", CANVAS)
    dev = layout.device_frame
    coverage = (dev.width * dev.height) / (CANVAS.width * CANVAS.height)
    assert coverage >= 0.6, f"full-bleed device should fill the canvas, got {coverage:.0%}"


def test_duo_exposes_two_caption_slots():
    # duo: a headline + a subline, stacked — the "two-line story" template
    layout = template_layout("duo", CANVAS)
    assert "headline" in layout.slots and "subline" in layout.slots
    head, sub = layout.slots["headline"], layout.slots["subline"]
    assert head.y < sub.y, "duo headline should sit above its subline"


def test_duo_headline_band_clears_the_subline_and_device():
    # the headline band must not overlap the subline (headline can wrap 2 lines),
    # and both captions must clear the device frame below.
    layout = template_layout("duo", CANVAS)
    head, sub, dev = layout.slots["headline"], layout.slots["subline"], layout.device_frame
    assert head.y + head.height <= sub.y, "duo headline band overlaps its subline"
    assert sub.y + sub.height <= dev.y, "duo captions overlap the device frame"


def test_layouts_are_deterministic():
    for tid in TEMPLATE_IDS:
        assert template_layout(tid, CANVAS) == template_layout(tid, CANVAS)


def test_layouts_scale_to_a_different_canvas_size():
    # an iPad canvas (2048x2732) — boxes must stay on-canvas, not hardcoded to iPhone
    ipad = Canvas(width=2048, height=2732)
    for tid in TEMPLATE_IDS:
        layout = template_layout(tid, ipad)
        assert _within_canvas(layout.slots["headline"], ipad), f"{tid} headline off iPad canvas"
        assert _within_canvas(layout.device_frame, ipad), f"{tid} device off iPad canvas"


def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn(); print(f"  ok   {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1; print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
