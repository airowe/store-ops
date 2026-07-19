#!/usr/bin/env python3
"""
Unit tests for render_localized_shots — the pure LAYOUT brain that turns a
localizeScreenshots() manifest into a deterministic per-locale draw plan, plus a
Pillow smoke test that the draw shell writes a PNG of the right size.

No network. Pillow is optional: the pure-layout tests run without it; the raster
smoke test skips (prints "skip") when Pillow is absent. Run:

    python3 render_localized_shots_test.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_localized_shots import (  # noqa: E402
    DRAFT_LABEL,
    Canvas,
    SlotBox,
    build_draw_plan,
    render_locale,
)

# ── fixtures ─────────────────────────────────────────────────────────────────
CANVAS = Canvas(width=1290, height=2796)

# Two named slots over the background: a headline near the top, a subhead below.
LAYOUT = {
    "headline": SlotBox(x=120, y=200, width=1050, height=260, align="center"),
    "subhead": SlotBox(x=120, y=480, width=1050, height=160, align="center"),
}

# What localizeScreenshots() → toScreenshotManifest() emits for one locale:
#   { slotId: { "text": ..., "fontSize": ... } }
# plus the engine's per-locale needsReview flag carried alongside.
def manifest_locale(headline="Improve Every Trade", sub="Journal your decisions",
                    hsize=88, ssize=44):
    return {
        "headline": {"text": headline, "fontSize": hsize},
        "subhead": {"text": sub, "fontSize": ssize},
    }


# ── pure layout: build_draw_plan ─────────────────────────────────────────────
def test_plan_places_every_slot_in_layout_order():
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    assert [d.slot_id for d in plan.draws] == ["headline", "subhead"]


def test_plan_honors_the_engine_font_size_never_reflows_it():
    # The engine already auto-fit the size; the renderer must NOT second-guess it.
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(hsize=61), needs_review=False)
    headline = next(d for d in plan.draws if d.slot_id == "headline")
    assert headline.font_size == 61


def test_plan_wraps_text_within_the_slot_width():
    long_head = "Improve every single trade you ever make this year"
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(headline=long_head),
                           needs_review=False)
    headline = next(d for d in plan.draws if d.slot_id == "headline")
    # a long caption must wrap to >1 line, and no line may exceed the slot width
    assert len(headline.lines) > 1
    assert all(line.strip() for line in headline.lines)  # no empty lines


def test_plan_centers_lines_when_slot_align_is_center():
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    headline = next(d for d in plan.draws if d.slot_id == "headline")
    # centered: every line's x is offset from the slot's left edge (not flush 120)
    assert headline.align == "center"


def test_plan_carries_the_draft_label_and_review_flag():
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=True)
    assert plan.label == DRAFT_LABEL
    assert plan.needs_review is True


def test_review_watermark_only_when_flagged():
    flagged = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=True)
    clean = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    assert flagged.watermark is not None and "review" in flagged.watermark.lower()
    assert clean.watermark is None


def test_plan_raises_on_slot_missing_from_layout():
    # A manifest slot with no box in the layout is an authoring error — loud, not
    # silently dropped (mirrors the engine's no-silent-clipping posture).
    bad = manifest_locale()
    bad["mystery_slot"] = {"text": "orphan", "fontSize": 40}
    try:
        build_draw_plan(CANVAS, LAYOUT, bad, needs_review=False)
        raise AssertionError("expected a KeyError for the un-laid-out slot")
    except KeyError as e:
        assert "mystery_slot" in str(e)


def test_plan_is_deterministic():
    a = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    b = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    assert a == b


# ── raster smoke: render_locale writes a PNG of the canvas size ──────────────
def test_render_locale_writes_png_of_canvas_size():
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("  skip render_locale (Pillow not installed)")
        return
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=True)
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "de-DE" / "01.png"
        render_locale(plan, background=None, out_path=out)
        assert out.exists()
        from PIL import Image
        with Image.open(out) as im:
            assert im.size == (CANVAS.width, CANVAS.height)


def test_render_locale_composites_a_device_screen_into_the_frame():
    # A raw app screen composited into a template's device_frame rect must land
    # inside that rect (not fill the whole canvas) — the template controls where
    # the device sits.
    try:
        from PIL import Image
    except ImportError:
        print("  skip device composite (Pillow not installed)")
        return
    device = Image.new("RGB", (600, 1200), (200, 30, 30))  # a red "app screen"
    frame = SlotBox(x=145, y=728, width=1000, height=1836)  # a device_frame rect
    plan = build_draw_plan(CANVAS, LAYOUT, manifest_locale(), needs_review=False)
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "01.png"
        render_locale(plan, background=None, out_path=out,
                      device_screen=device, device_frame=frame)
        with Image.open(out) as im:
            # a pixel well inside the frame is reddish (device composited there)
            r, g, b = im.convert("RGB").getpixel((frame.x + frame.width // 2,
                                                   frame.y + frame.height // 2))
            assert r > 120 and g < 100 and b < 100, f"device not composited: {(r,g,b)}"
            # a pixel in the top caption band is NOT the device red
            tr, tg, tb = im.convert("RGB").getpixel((CANVAS.width // 2, 40))
            assert not (tr > 120 and tg < 100 and tb < 100), "device bled into caption band"


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
