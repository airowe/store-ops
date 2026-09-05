#!/usr/bin/env python3
"""
Unit tests for audit_card_render — the pure layout brain for the audit card
image (#437), plus a Pillow smoke test that the shell writes a 1600x900 PNG.

No network. Pillow is optional: the pure tests run without it; the raster
smoke test prints "skip" when Pillow is absent. Run:

    python3 audit_card_render_test.py
"""
from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_card_render import (  # noqa: E402
    CARD_STATES,
    DASH,
    build_card_plan,
    render_card,
    show_value,
)

AS_OF = "2026-09-05T12:00:00.000Z"


def measured(value, source="App Store"):
    return {"state": "measured", "value": value, "asOf": AS_OF, "source": source}


def card():
    return {
        "identity": {
            "name": "Acme Habits",
            "developer": measured("Acme Labs"),
            "iconUrl": None,
            "released": measured("2024-03-01T00:00:00Z"),
            "lastUpdated": {"state": "unavailable", "reason": "not readable"},
        },
        "chips": {"category": measured("Productivity"), "price": measured("Free")},
        "hero": {
            "downloads": {"state": "unavailable", "reason": "Apple reports downloads only to the developer."},
            "proceeds": {"state": "pending", "reason": "Requested — Apple takes 1–2 days."},
        },
        "tiles": {"rating": measured({"avg": 4.62, "count": 1283}), "size": {"state": "absent"}},
        "aso": {
            "headline": "Found for 2 of 3 keywords tested. Best rank #7 for “habit tracker”.",
            "score": measured(67, "ShipASO listing audit"),
            "grade": "B",
            "rankSummary": measured({"tested": 3, "found": 2, "best": {"keyword": "habit tracker", "rank": 7}}, "ShipASO rank check · US · top 200"),
            "topFindings": [
                {"id": "a", "title": "Subtitle carries no target keyword", "fix": "Lead with “habit tracker”."},
                {"id": "b", "title": "Only 2 screenshots", "fix": "Use more slots."},
                {"id": "c", "title": "Third finding", "fix": "should not render"},
            ],
        },
        "screenshots": [],
        "measuredAt": AS_OF,
        "country": "US",
    }


def texts(plan):
    return [t.text for t in plan.texts]


def test_states_are_the_four_from_the_model():
    assert CARD_STATES == ("measured", "pending", "unavailable", "absent")


def test_show_value_has_exactly_the_four_branches():
    assert show_value(measured(5), str) == ("5", "")
    assert show_value({"state": "pending", "reason": "r"}, str) == (DASH, "r")
    assert show_value({"state": "unavailable", "reason": "u"}, str) == (DASH, "u")
    assert show_value({"state": "absent"}, str) == (DASH, "")
    try:
        show_value({"state": "estimated", "value": 33000}, str)
    except ValueError as e:
        assert "estimated" in str(e)
    else:
        raise AssertionError("an unknown state must raise, never render")


def test_measured_values_are_drawn_with_provenance_stamp():
    t = texts(build_card_plan(card()))
    assert "Acme Habits" in t
    assert "Acme Labs" in t
    assert "4.6 · 1,283 ratings" in t
    assert "67/100 · B" in t
    assert "ShipASO rank check · US · top 200" in t
    assert any(s.startswith("Measured 2026-09-05 · US") for s in t)


def test_unavailable_and_pending_draw_dash_and_reason_never_a_number():
    plan = build_card_plan(card())
    t = texts(plan)
    assert "Apple reports downloads only to the developer." in t
    assert "Requested — Apple takes 1–2 days." in t
    # No digit-bearing run sits at the hero value positions.
    hero_values = [r.text for r in plan.texts if r.size == 52]
    assert hero_values == [DASH, DASH], hero_values


def test_absent_draws_dash_alone():
    plan = build_card_plan(card())
    size_runs = [r.text for r in plan.texts if r.size == 30]
    assert size_runs[2] == DASH


def test_headline_is_required():
    c = card()
    c["aso"]["headline"] = "  "
    try:
        build_card_plan(c)
    except ValueError as e:
        assert "headline" in str(e)
    else:
        raise AssertionError("a card without its finding must not render")


def test_at_most_two_findings():
    t = texts(build_card_plan(card()))
    assert "Subtitle carries no target keyword" in t
    assert "Only 2 screenshots" in t
    assert "Third finding" not in t


def test_new_app_renders_intentionally():
    c = card()
    c["aso"].update(headline="No keywords measured yet.", score={"state": "absent"}, grade=None,
                    rankSummary={"state": "absent"}, topFindings=[])
    c["tiles"]["rating"] = {"state": "absent"}
    plan = build_card_plan(c)
    t = texts(plan)
    assert "No keywords measured yet." in t
    assert "ShipASO rank check" in t
    assert not any(re.fullmatch(r"\d+/100.*", s) for s in t)


def test_nothing_is_drawn_off_canvas():
    plan = build_card_plan(card())
    for r in plan.texts:
        assert 0 <= r.x < plan.width and 0 <= r.y < plan.height, r
    for r in plan.rects:
        assert r.x + r.w <= plan.width and r.y + r.h <= plan.height, r


def test_render_smoke():
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("skip: Pillow not installed")
        return
    with tempfile.TemporaryDirectory() as d:
        out = render_card(build_card_plan(card()), Path(d) / "card.png")
        from PIL import Image

        with Image.open(out) as img:
            assert img.size == (1600, 900), img.size


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
