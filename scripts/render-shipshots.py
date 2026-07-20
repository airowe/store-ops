#!/usr/bin/env python3
"""
render-shipshots — the pixel step of ShipShots (#153). Drives the plan→render
bridge over a ScreenshotPlan (the planner's JSON output) + a directory of raw app
captures, writing one PNG per planned shot at the given App Store device size.

    POST /plan/screenshots  → plan.json          (the hosted planner; no pixels)
    render-shipshots.py     → out/<NN>-<tpl>.png  (this; local, deterministic)
    asc screenshots upload                        (downstream, your explicit step)

The LLM never paints pixels: the plan is data, this renderer is deterministic —
same plan in, same pixels out. A MISSING shot renders a watermarked PLACEHOLDER
whose caption is the reason — never a fabricated screen. Nothing uploads; that
stays your explicit `asc` step.

Usage (from repo root):
    python3 scripts/render-shipshots.py \
        --plan    plan.json \
        --screens marketing/shots/raw/   # filename stem == sourceScreen id
        --canvas  1290x2796 \
        --out     out/
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))
from render_localized_shots import Canvas, render_locale  # noqa: E402
from shipshots_render import plan_to_render_jobs  # noqa: E402

_IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _screen_paths(screens_dir: Path) -> dict:
    """Map each capture's filename stem → its path (the stem is its sourceScreen
    id, e.g. `home.png` → "home"). A missing/empty dir → {} (every shot MISSING)."""
    if not screens_dir or not screens_dir.is_dir():
        return {}
    return {
        p.stem: str(p)
        for p in sorted(screens_dir.iterdir())
        if p.suffix.lower() in _IMG_EXTS
    }


def _parse_canvas(spec: str) -> Canvas:
    w, _, h = spec.lower().partition("x")
    return Canvas(width=int(w), height=int(h))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="ScreenshotPlan JSON (from POST /plan/screenshots)")
    ap.add_argument("--screens", default=None, help="dir of raw captures; filename stem == sourceScreen id")
    ap.add_argument("--canvas", default="1290x2796", help="device size WxH (default iPhone 6.7\")")
    ap.add_argument("--out", required=True, help="output dir for the PNGs")
    ap.add_argument("--locale", default="en")
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text())
    canvas = _parse_canvas(args.canvas)
    screen_paths = _screen_paths(Path(args.screens)) if args.screens else {}
    out_dir = Path(args.out)

    jobs = plan_to_render_jobs(plan, canvas, screen_paths, locale=args.locale)
    if plan.get("degraded"):
        print("note: this plan came from the deterministic fallback (no model shaped it).")

    review = 0
    for job in jobs:
        render_locale(job.draw_plan, None, out_dir / job.out_name,
                      device_screen=job.device_screen, device_frame=job.device_frame)
        flag = "  ⚠ needs review" if job.draw_plan.needs_review else ""
        src = job.device_screen or "MISSING (placeholder)"
        print(f"  {job.out_name}  ← {src}{flag}")
        if job.draw_plan.needs_review:
            review += 1

    print(f"\n{len(jobs)} shot(s) → {out_dir}/  ({review} need review before you ship).")
    print("Nothing was uploaded. Review, then run `asc screenshots upload` yourself.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
