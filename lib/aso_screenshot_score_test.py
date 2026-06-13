#!/usr/bin/env python3
"""
Unit tests for aso-screenshot-score — pure logic (scoring, aspect parsing).
No network. Run:  python3 aso_screenshot_score_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_screenshot_score import (  # noqa: E402
    score, _aspect_from_url, _aspect_label,
)

TALL = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/1290x2796bb.png"
WIDE = "https://is1.mzstatic.com/image/thumb/x/v4/a/b/c/392x696bb.png"


def _listing(n_iphone=0, n_ipad=0, url=TALL):
    return {"screenshotUrls": [url] * n_iphone,
            "ipadScreenshotUrls": ["ipad"] * n_ipad}


# ── aspect parsing ───────────────────────────────────────────────────────────
def test_aspect_from_url():
    assert _aspect_from_url(TALL) == (1290, 2796)
    assert _aspect_from_url(WIDE) == (392, 696)


def test_aspect_from_url_none_when_absent():
    assert _aspect_from_url("https://x/no-size-here.png") is None


def test_aspect_label_tall_phone():
    assert "tall phone" in _aspect_label(1290, 2796)


def test_aspect_label_tablet():
    assert "tablet" in _aspect_label(1024, 1366).lower() or \
           "landscape" in _aspect_label(1366, 1024).lower()


# ── scoring ──────────────────────────────────────────────────────────────────
def test_zero_screenshots_is_failing():
    res = score("x", _listing(0))
    assert res.grade == "F"
    assert res.iphone_count == 0
    assert any("No iPhone screenshots" in f for f in res.findings)


def test_few_screenshots_flagged():
    res = score("x", _listing(2))
    assert any("Only 2" in f for f in res.findings)
    assert res.score < score("x", _listing(6)).score   # more shots scores higher


def test_full_set_scores_well():
    res = score("x", _listing(8, n_ipad=4))
    assert res.score >= 70 and res.grade in ("A", "B")


def test_ipad_adds_points():
    with_ipad = score("x", _listing(6, n_ipad=5)).score
    without = score("x", _listing(6, n_ipad=0)).score
    assert with_ipad > without


def test_tall_ratio_scores_higher_than_wide():
    tall = score("x", _listing(6, url=TALL)).score
    wide = score("x", _listing(6, url=WIDE)).score
    assert tall > wide


def test_fetch_flag_off_gives_neutral_credit_not_zero():
    res = score("x", _listing(6))
    # without --fetch, there's an info finding and partial credit, no crash
    assert any("--fetch" in f for f in res.findings)


def test_score_capped_at_100():
    res = score("x", _listing(10, n_ipad=10, url=TALL))
    assert res.score <= 100


def test_to_dict_roundtrip():
    d = score("mangia", _listing(5)).to_dict()
    assert d["app"] == "mangia" and "findings" in d and isinstance(d["score"], int)


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
