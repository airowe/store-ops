#!/usr/bin/env python3
"""
render-plan — render a ScreenshotPlan (from the #153 planner, POST /plan/screenshots)
into one PNG per shot, using each shot's templateId for layout and compositing
its sourceScreen into the template's device frame. This is the seam that ties
the planner's output to real pixels — the last brick of the ShipShots loop:

    audit findings ─► planner ─► ScreenshotPlan ─► render-plan.py (this) ─► PNGs
                                                            │
                                                    review gate ─► asc upload

Each shot's headline (and optional subline for the `duo` template) is drawn at a
default size the shot_templates layout implies; a shot whose sourceScreen is
"MISSING" renders the caption on a neutral frame with a MISSING marker — an
honest gap, never a fabricated screen. Nothing is uploaded.

Usage (from repo root):
    python3 scripts/render-plan.py \
        --plan plan.json \
        --screens marketing/localize-demo/screens \
        --out marketing/localize-demo/plan-out \
        --width 1290 --height 2796
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))
from render_localized_shots import Canvas, build_draw_plan, render_locale  # noqa: E402
from shot_templates import template_layout  # noqa: E402

# a default caption size per slot, as a fraction of canvas height (the engine
# sizes localized captions; a plan's headline copy is short by lint, so a fixed
# generous size is fine and the renderer wraps it to the template's slot width).
_HEADLINE_FH = 0.055
_SUBLINE_FH = 0.032


def _find_screen(screens_dir: Path, name: str):
    if not screens_dir.exists():
        return None
    for ext in (".png", ".jpg", ".jpeg", ".PNG"):
        p = screens_dir / f"{name}{ext}"
        if p.exists():
            return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="ScreenshotPlan JSON (planner output)")
    ap.add_argument("--screens", required=True, help="dir of raw app captures named <sourceScreen>.png")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1290)
    ap.add_argument("--height", type=int, default=2796)
    args = ap.parse_args()

    plan = json.loads((REPO / args.plan).read_text())
    screens_dir = REPO / args.screens
    out_dir = REPO / args.out
    canvas = Canvas(width=args.width, height=args.height)

    shots = plan.get("shots", [])
    if not shots:
        print("plan has no shots", file=sys.stderr)
        return 1

    hsize = max(1, round(_HEADLINE_FH * canvas.height))
    ssize = max(1, round(_SUBLINE_FH * canvas.height))

    written = []
    for i, shot in enumerate(shots, start=1):
        template_id = shot.get("templateId", "headline-top")
        layout_obj = template_layout(template_id, canvas)

        # build a per-shot manifest for build_draw_plan from the plan's copy
        manifest = {"headline": {"text": shot.get("headline", ""), "fontSize": hsize}}
        if "subline" in layout_obj.slots and shot.get("subline"):
            manifest["subline"] = {"text": shot["subline"], "fontSize": ssize}

        missing = shot.get("sourceScreen") == "MISSING"
        # a bad-headline shot from the planner carries needsReview; MISSING is a
        # review flag too (a human must supply/capture the screen).
        needs_review = bool(shot.get("needsReview")) or missing

        draw_plan = build_draw_plan(canvas, layout_obj.slots, manifest,
                                    needs_review=needs_review, locale="")

        device = None if missing else _find_screen(screens_dir, shot.get("sourceScreen", ""))
        out_path = out_dir / f"{i:02d}-{template_id}.png"
        render_locale(draw_plan, background=None, out_path=out_path,
                      device_screen=str(device) if device else None,
                      device_frame=layout_obj.device_frame if device else None)

        note = ""
        if missing:
            note = f"  ⚠ MISSING ({shot.get('missingReason', 'no source screen')})"
        elif device is None:
            note = f"  ⚠ screen '{shot.get('sourceScreen')}' not found in {args.screens}"
        elif needs_review:
            note = "  ⚠ needsReview"
        written.append((i, template_id, out_path, note))

    for i, tid, path, note in written:
        print(f"  shot {i} [{tid:15}] → {path.relative_to(REPO)}{note}")
    if plan.get("degraded"):
        print("\n  note: this plan was DEGRADED (deterministic, no model) — review copy carefully")
    print(f"\nrendered {len(written)} shot(s). Review before the frame/upload step — "
          f"nothing is pushed to the store by this script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
