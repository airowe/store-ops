#!/usr/bin/env python3
"""
Score an app's App Store screenshot set against ASO best practice — no paid API.

The visual half of ASO nothing else in the loop touches. Screenshots drive
conversion (the % of people who view the listing and install), and the first
2-3 are what most users actually see. This pulls the live screenshot set via the
free iTunes Lookup API and scores the things that are *deterministic* — count,
aspect/device coverage, resolution — plus a light caption heuristic. It does NOT
pretend to OCR your captions or judge design; it flags the structural ASO
mistakes (too few shots, wrong ratios, no iPad set) that quietly cost installs.

Usage:
    python3 aso_screenshot_score.py --app mangia --bundle com.airowe.mangia
    python3 aso_screenshot_score.py --app mangia --bundle com.airowe.mangia --json
    python3 aso_screenshot_score.py --app mangia --bundle com.airowe.mangia --fetch
        # --fetch downloads the first few images for the caption heuristic (slower)

Exit codes: 0 ok · 1 bad args · 2 app not found.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict, field

LOOKUP_URL = "https://itunes.apple.com/lookup"
USER_AGENT = "Mozilla/5.0 (Macintosh; aso-screenshot-score)"
# Apple allows up to 10 screenshots; the first ~3 carry most of the conversion.
MAX_SLOTS = 10
GOOD_MIN = 4          # below this, you're leaving conversion on the table
KEY_SLOTS = 3         # the first N are what most users see


@dataclass
class ShotScore:
    app: str
    iphone_count: int
    ipad_count: int
    score: int                       # 0–100
    grade: str
    findings: list[str] = field(default_factory=list)
    aspect_hint: str = ""
    caption_heuristic: str = ""      # only if --fetch

    def to_dict(self) -> dict:
        return asdict(self)


def _fetch_listing(bundle_id: str, country: str = "US") -> dict | None:
    qs = urllib.parse.urlencode({"bundleId": bundle_id, "country": country})
    req = urllib.request.Request(f"{LOOKUP_URL}?{qs}",
                                 headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"),
                              strict=False)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    r = data.get("results") or []
    return r[0] if r else None


def _aspect_from_url(url: str) -> tuple[int, int] | None:
    """Screenshot URLs end in a size token like '392x696bb.png'."""
    m = re.search(r"/(\d{2,4})x(\d{2,4})[a-z]{0,3}\.(png|jpg|jpeg)", url)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _aspect_label(w: int, h: int) -> str:
    r = h / w if w else 0
    if r >= 2.0:
        return "tall phone (≈19.5:9 — modern iPhone)"
    if 1.7 <= r < 2.0:
        return "phone (≈16:9)"
    if 1.2 <= r < 1.7:
        return "tablet / landscape"
    return "unusual ratio"


def _caption_heuristic(url: str) -> str:
    """VERY light: download the image, check whether the top ~20% has high
    contrast variance (a proxy for overlaid caption text vs. a bare screenshot).
    Labeled as a heuristic — not OCR."""
    try:
        from PIL import Image  # noqa
        import io
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            img = Image.open(io.BytesIO(resp.read())).convert("L")
        w, h = img.size
        top = img.crop((0, 0, w, max(1, h // 5)))
        # stdev of pixel luminance: text overlays raise it vs. a flat header
        px = list(top.getdata())
        mean = sum(px) / len(px)
        var = sum((p - mean) ** 2 for p in px) / len(px)
        std = var ** 0.5
        return ("likely has a caption/headline (high top-band contrast)"
                if std > 55 else
                "top band looks plain — consider adding a value-prop caption")
    except Exception:  # noqa: BLE001
        return ""


def score(app: str, listing: dict, *, fetch: bool = False) -> ShotScore:
    iphone = listing.get("screenshotUrls", []) or []
    ipad = listing.get("ipadScreenshotUrls", []) or []
    findings: list[str] = []
    pts = 0

    # count (the biggest lever) — up to 50 pts
    n = len(iphone)
    if n == 0:
        findings.append("✗ No iPhone screenshots — the listing can't convert. Add 4+.")
    elif n < GOOD_MIN:
        findings.append(f"⚠ Only {n} iPhone screenshots — add up to {MAX_SLOTS}; "
                        f"the first {KEY_SLOTS} carry most installs.")
        pts += 20
    else:
        findings.append(f"✓ {n} iPhone screenshots (good — slots well used).")
        pts += 50 if n >= 6 else 40

    # iPad set — 15 pts (matters if the app is universal)
    if ipad:
        findings.append(f"✓ {len(ipad)} iPad screenshots present.")
        pts += 15
    else:
        findings.append("⚠ No iPad screenshots — fine if iPhone-only; add them if universal.")
        pts += 5

    # aspect / device targeting — 20 pts
    aspect_hint = ""
    if iphone:
        dims = _aspect_from_url(iphone[0])
        if dims:
            aspect_hint = _aspect_label(*dims)
            if dims[1] / dims[0] >= 2.0:
                findings.append(f"✓ Modern tall-phone ratio ({dims[0]}×{dims[1]}).")
                pts += 20
            else:
                findings.append(f"⚠ Screenshots are {dims[0]}×{dims[1]} "
                                f"({aspect_hint}) — verify they fit current devices.")
                pts += 10
        else:
            pts += 10

    # caption heuristic — 15 pts (only with --fetch)
    caption = ""
    if fetch and iphone:
        caption = _caption_heuristic(iphone[0])
        if caption.startswith("likely"):
            findings.append("✓ First screenshot " + caption + ".")
            pts += 15
        elif caption:
            findings.append("⚠ First screenshot: " + caption + ".")
            pts += 5
    elif iphone:
        findings.append("ℹ Run with --fetch for a (light) caption check on the "
                        "first screenshot.")
        pts += 8  # neutral partial credit when not fetching

    pts = min(100, pts)
    grade = ("A" if pts >= 85 else "B" if pts >= 70 else
             "C" if pts >= 50 else "D" if pts >= 30 else "F")
    return ShotScore(app=app, iphone_count=n, ipad_count=len(ipad),
                     score=pts, grade=grade, findings=findings,
                     aspect_hint=aspect_hint, caption_heuristic=caption)


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Score an app's App Store screenshots")
    ap.add_argument("--app", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--country", default="US")
    ap.add_argument("--fetch", action="store_true",
                    help="download the first screenshot for the caption heuristic")
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    listing = _fetch_listing(args.bundle, args.country)
    if listing is None:
        print(f"no listing for {args.bundle}", file=sys.stderr)
        return 2
    res = score(args.app, listing, fetch=args.fetch)
    if args.json:
        print(json.dumps(res.to_dict(), indent=2))
        return 0
    print(f"=== {args.app} screenshots — {res.grade} ({res.score}/100) ===")
    print(f"  iPhone: {res.iphone_count} · iPad: {res.ipad_count}"
          + (f" · {res.aspect_hint}" if res.aspect_hint else ""))
    for f in res.findings:
        print(f"  {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
