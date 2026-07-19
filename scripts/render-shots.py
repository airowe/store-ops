#!/usr/bin/env python3
"""
render-shots — drive lib/render_localized_shots over a localize-shots manifest,
writing one PNG per locale. The pixel step of the localized-previews loop:

    localize-shots.mjs  → out/manifest.json + review.json + excluded.json
    render-shots.py     → out/<locale>/<shot>.png   (this)
    asc screenshots frame / review-*                (downstream, no auto-upload)

Reads the same source.json the bridge used (for canvas + layout), the manifest
(per-locale caption text + engine-chosen font size), and review.json (which
locales the engine flagged, so those PNGs get a visible DRAFT watermark).
Excluded locales are printed, never rendered (they were stated in excluded.json).

Usage (from repo root):
    python3 scripts/render-shots.py \
        --source marketing/localize-demo/source.json \
        --out marketing/localize-demo/out \
        --background marketing/localize-demo/background.png   # optional
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "lib"))
from render_localized_shots import Canvas, SlotBox, build_draw_plan, render_locale  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--background", default=None,
                    help="background art (path). Omitted → neutral fill.")
    ap.add_argument("--shot", default="01",
                    help="shot basename for the output PNG (default 01)")
    args = ap.parse_args()

    source = json.loads((REPO / args.source).read_text())
    out_dir = REPO / args.out
    manifest = json.loads((out_dir / "manifest.json").read_text())
    review = json.loads((out_dir / "review.json").read_text()) if (out_dir / "review.json").exists() else {}
    excluded = json.loads((out_dir / "excluded.json").read_text()) if (out_dir / "excluded.json").exists() else {}

    canvas = Canvas(width=source["canvas"]["width"], height=source["canvas"]["height"])
    layout = {
        sid: SlotBox(x=b["x"], y=b["y"], width=b["width"], height=b["height"],
                     align=b.get("align", "center"))
        for sid, b in source["layout"].items()
    }
    background = str(REPO / args.background) if args.background else None

    written = []
    for locale, slots in manifest.items():
        plan = build_draw_plan(canvas, layout, slots,
                               needs_review=bool(review.get(locale, False)),
                               locale=locale)
        out_path = out_dir / locale / f"{args.shot}.png"
        render_locale(plan, background, out_path)
        flag = "  ⚠ DRAFT watermark (needsReview)" if plan.needs_review else ""
        written.append((locale, out_path, flag))

    for locale, path, flag in written:
        print(f"  {locale:6} → {path.relative_to(REPO)}{flag}")
    if excluded:
        for locale, reason in excluded.items():
            print(f"  {locale:6} — excluded, not rendered: {reason}")
    print(f"\nrendered {len(written)} locale(s). Review flagged locales before the "
          f"frame/upload step — nothing is pushed to the store by this script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
