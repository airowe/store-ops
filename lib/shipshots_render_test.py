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
