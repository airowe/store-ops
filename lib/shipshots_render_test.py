#!/usr/bin/env python3
"""
Tests for shipshots_render — the plan→render bridge (#153).

Honesty invariants under test:
  • a real sourceScreen becomes a RenderJob backed by that screen path,
  • a MISSING (or unknown) sourceScreen renders a labeled placeholder — its
    reason as the caption, device_screen None — and is forced needs_review,
  • a bad-headline needsReview flag from the planner is carried through,
  • an unknown templateId coerces to headline-top (never raises),
  • fit_headline shrinks toward the 70% floor, never below it,
  • out-names are stable + indexed.
Plain-assert style (no pytest), run standalone like the other lib suites.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))

from render_localized_shots import Canvas, SlotBox  # noqa: E402
from shipshots_render import fit_headline, plan_to_render_jobs  # noqa: E402

CANVAS = Canvas(width=1290, height=2796)
LABEL = "draft — machine-planned, review before shipping"


def _plan(shots):
    return {"narrative": "hook then proof", "shots": shots, "label": LABEL, "degraded": False}


# ── fit_headline ─────────────────────────────────────────────────────────────
def test_fit_headline_keeps_base_size_when_it_fits():
    box = SlotBox(x=0, y=0, width=1000, height=300)
    assert fit_headline("Track your rank", box, base_font=96) == 96


def test_fit_headline_shrinks_toward_floor_when_too_wide():
    box = SlotBox(x=0, y=0, width=200, height=120)
    size = fit_headline("A fairly long benefit headline here", box, base_font=96)
    assert size < 96
    assert size >= round(96 * 0.7)  # never below the 70% floor


# ── plan_to_render_jobs ──────────────────────────────────────────────────────
def test_real_source_screen_becomes_a_render_job_with_that_path():
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank", "templateId": "headline-top"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert len(jobs) == 1
    job = jobs[0]
    assert job.device_screen == "/tmp/home.png"
    assert job.draw_plan.needs_review is False
    assert job.out_name == "01-headline-top.png"
    assert any("Track your rank" in " ".join(d.lines) for d in job.draw_plan.draws)


def test_missing_shot_renders_placeholder_and_forces_review():
    plan = _plan([{"sourceScreen": "MISSING", "missingReason": "no settings screen captured",
                   "headline": "Fine-tune it", "templateId": "duo"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {})
    job = jobs[0]
    assert job.device_screen is None            # no fabricated screen
    assert job.draw_plan.needs_review is True    # watermark will show
    drawn = " ".join(line for d in job.draw_plan.draws for line in d.lines)
    assert "no settings screen captured" in drawn  # the reason is the caption


def test_unknown_source_is_demoted_to_placeholder():
    plan = _plan([{"sourceScreen": "ghost", "headline": "Nope", "templateId": "full-bleed"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})  # "ghost" absent
    assert jobs[0].device_screen is None
    assert jobs[0].draw_plan.needs_review is True


def test_needs_review_flag_from_planner_is_carried_through():
    plan = _plan([{"sourceScreen": "home", "headline": "", "templateId": "headline-top", "needsReview": True}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert jobs[0].draw_plan.needs_review is True


def test_unknown_template_coerces_to_headline_top():
    plan = _plan([{"sourceScreen": "home", "headline": "Hi there", "templateId": "carousel"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert jobs[0].out_name == "01-headline-top.png"


def test_out_names_are_stable_and_indexed():
    plan = _plan([
        {"sourceScreen": "home", "headline": "One", "templateId": "headline-top"},
        {"sourceScreen": "home", "headline": "Two", "templateId": "duo"},
    ])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    assert [j.out_name for j in jobs] == ["01-headline-top.png", "02-duo.png"]


def test_duo_subline_is_laid_out_when_present():
    plan = _plan([{"sourceScreen": "home", "headline": "Story", "subline": "and the proof",
                   "templateId": "duo"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {"home": "/tmp/home.png"})
    drawn = " ".join(line for d in jobs[0].draw_plan.draws for line in d.lines)
    assert "and the proof" in drawn


# ── render smoke (Pillow-guarded; skips cleanly when Pillow is absent) ────────
def test_render_jobs_produce_pngs_smoke():
    try:
        from PIL import Image  # noqa: F401
    except Exception:
        print("  (skip render smoke — Pillow not installed)")
        return
    from render_localized_shots import render_locale

    plan = _plan([{"sourceScreen": "MISSING", "missingReason": "capture the home screen",
                   "headline": "x", "templateId": "headline-top"}])
    jobs = plan_to_render_jobs(plan, CANVAS, {})
    with tempfile.TemporaryDirectory() as d:
        out = render_locale(jobs[0].draw_plan, None, Path(d) / jobs[0].out_name,
                            device_screen=jobs[0].device_screen, device_frame=jobs[0].device_frame)
        assert out.exists() and out.stat().st_size > 0




# ── brand colors (measured-or-nothing, applied to pixels) ────────────────────
def test_accent_colors_the_headline_when_readable_on_a_solid_background():
    from shipshots_render import MIN_ACCENT_CONTRAST, contrast_ratio
    bg = (7, 9, 14)  # near-black
    accent = (52, 211, 153)  # the signal green — high contrast on dark
    assert contrast_ratio(accent, bg) >= MIN_ACCENT_CONTRAST
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank",
                   "templateId": "duo", "subline": "One dashboard", "accent": "#34d399"}])
    [job] = plan_to_render_jobs(plan, CANVAS, {"home": "/shots/home.png"}, background=bg)
    colors = {d.slot_id: d.box.color for d in job.draw_plan.draws}
    assert colors["headline"] == accent
    # restraint: the accent is the headline's; the subline keeps the measured ink
    assert colors["subline"] == (255, 255, 255)


def test_unreadable_accent_falls_back_to_the_measured_ink_never_ships():
    # a near-black accent on a near-black background can't be read — reject
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank",
                   "templateId": "headline-top", "accent": "#0b0e14"}])
    [job] = plan_to_render_jobs(plan, CANVAS, {"home": "/shots/home.png"}, background=(7, 9, 14))
    [draw] = job.draw_plan.draws
    assert draw.box.color == (255, 255, 255)


def test_light_background_flips_the_default_ink_dark():
    # white-on-white was the latent bug; with a measured light background the
    # ink must go dark even with no accent in play.
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank",
                   "templateId": "headline-top"}])
    [job] = plan_to_render_jobs(plan, CANVAS, {"home": "/shots/home.png"}, background=(246, 247, 249))
    [draw] = job.draw_plan.draws
    assert draw.box.color == (17, 22, 33)


def test_no_solid_background_means_no_accent_ever():
    # background art (or none) → contrast is unmeasurable → the accent is NOT
    # applied. Never a color we couldn't verify.
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank",
                   "templateId": "headline-top", "accent": "#34d399"}])
    [job] = plan_to_render_jobs(plan, CANVAS, {"home": "/shots/home.png"})
    [draw] = job.draw_plan.draws
    assert draw.box.color == (255, 255, 255)


def test_malformed_accent_is_ignored_not_guessed():
    from shipshots_render import parse_hex
    assert parse_hex("#34d399") == (52, 211, 153)
    for bad in ("green", "#34d39", "#34d39g", 42, None, "#34d399ff"):
        assert parse_hex(bad) is None
    plan = _plan([{"sourceScreen": "home", "headline": "Track your rank",
                   "templateId": "headline-top", "accent": "green"}])
    [job] = plan_to_render_jobs(plan, CANVAS, {"home": "/shots/home.png"}, background=(7, 9, 14))
    [draw] = job.draw_plan.draws
    assert draw.box.color == (255, 255, 255)


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
