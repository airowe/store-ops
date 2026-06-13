#!/usr/bin/env python3
"""
Unit tests for aso-competitor-watch — pure logic (parse + diff + render),
no network. Run:  python3 aso_competitor_watch_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import json  # noqa: E402
import aso_competitor_watch as cw  # noqa: E402
from aso_competitor_watch import (  # noqa: E402
    Listing, previous_listings, diff, render_snapshot, digest_line, WATCH_FIELDS,
    resolve_name_to_id,
)


def _listing(key, name="", version="", price="Free", rating="", genres="", error=""):
    return Listing(key=key, name=name, version=version, price=price,
                   rating=rating, genres=genres, error=error)


class _FakeResp:
    def __init__(self, body): self._b = body.encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self._b


def test_resolve_name_to_id_returns_top_track_id():
    cw.urllib.request.urlopen = lambda req, timeout=20: _FakeResp(json.dumps(
        {"resultCount": 1, "results": [{"trackId": 571800810, "trackName": "Calm"}]}))
    assert resolve_name_to_id("Calm") == "571800810"


def test_resolve_name_to_id_none_when_no_results():
    cw.urllib.request.urlopen = lambda req, timeout=20: _FakeResp(json.dumps(
        {"resultCount": 0, "results": []}))
    assert resolve_name_to_id("zzz nonexistent app") is None


def test_resolve_name_to_id_none_on_error():
    def boom(req, timeout=20):
        raise OSError("network down")
    cw.urllib.request.urlopen = boom
    assert resolve_name_to_id("Calm") is None


SAMPLE = """# swoop — competitor watch

## 2026-06-01 · US

- `111` · name: Old Name · version: 1.0.0 · price: Free · rating: 4.0 (10) · genres: Social

## 2026-06-08 · US

- `111` · name: Hinge · version: 9.1.0 · price: Free · rating: 4.4 (1000) · genres: Lifestyle, Social Networking
- `222` · name: Bumble · version: 5.4.0 · price: Free · rating: 4.3 (2000) · genres: Lifestyle
"""


# ── parsing ──────────────────────────────────────────────────────────────────
def test_previous_reads_latest_block():
    prev = previous_listings(SAMPLE)
    assert set(prev.keys()) == {"111", "222"}
    assert prev["111"]["name"] == "Hinge"
    assert prev["111"]["version"] == "9.1.0"


def test_previous_parses_multivalue_genres():
    prev = previous_listings(SAMPLE)
    assert prev["111"]["genres"] == "Lifestyle, Social Networking"


def test_previous_empty_when_no_blocks():
    assert previous_listings("# title only") == {}


# ── diff ─────────────────────────────────────────────────────────────────────
def test_diff_detects_new():
    cur = [_listing("999", name="New Competitor", version="1.0")]
    out = diff(cur, {})
    assert out[0]["status"] == "new"


def test_diff_detects_changed_version():
    prev = {"111": {"name": "Hinge", "version": "9.1.0", "price": "Free",
                    "rating": "4.4 (1000)", "genres": "Lifestyle", "subtitle": ""}}
    cur = [_listing("111", name="Hinge", version="9.2.0", price="Free",
                    rating="4.4 (1000)", genres="Lifestyle")]
    out = diff(cur, prev)
    assert out[0]["status"] == "changed"
    assert out[0]["fields"]["version"] == {"from": "9.1.0", "to": "9.2.0"}


def test_diff_detects_name_change():
    prev = {"111": {"name": "Swoop: Connect IRL", "version": "1.0", "price": "Free",
                    "rating": "", "genres": "", "subtitle": ""}}
    cur = [_listing("111", name="Swoop: Chat & Meet IRL", version="1.0")]
    out = diff(cur, prev)
    assert out[0]["status"] == "changed"
    assert "name" in out[0]["fields"]


def test_diff_same_when_unchanged():
    prev = {"111": {"name": "Hinge", "version": "9.1.0", "price": "Free",
                    "rating": "4.4 (1000)", "genres": "Lifestyle", "subtitle": ""}}
    cur = [_listing("111", name="Hinge", version="9.1.0", price="Free",
                    rating="4.4 (1000)", genres="Lifestyle")]
    out = diff(cur, prev)
    assert out[0]["status"] == "same"


def test_diff_error_passthrough():
    out = diff([_listing("111", error="not found")], {})
    assert out[0]["status"] == "error"
    assert out[0]["detail"] == "not found"


def test_diff_empty_field_does_not_falsely_change():
    # current has empty rating; prev had a rating — empty shouldn't count as a change
    prev = {"111": {"name": "X", "version": "1", "price": "Free",
                    "rating": "4.4 (1000)", "genres": "", "subtitle": ""}}
    cur = [_listing("111", name="X", version="1", price="Free", rating="", genres="")]
    out = diff(cur, prev)
    assert out[0]["status"] == "same", out[0]


# ── render round-trip ────────────────────────────────────────────────────────
def test_render_roundtrips_through_parser():
    cur = [_listing("111", name="Hinge", version="9.1.0", price="Free",
                    rating="4.4 (1000)", genres="Lifestyle, Social Networking")]
    md = render_snapshot("2026-06-08", "US", cur)
    reparsed = previous_listings(md)
    assert reparsed["111"]["name"] == "Hinge"
    assert reparsed["111"]["version"] == "9.1.0"
    assert reparsed["111"]["genres"] == "Lifestyle, Social Networking"


def test_render_handles_error_listing():
    md = render_snapshot("2026-06-08", "US", [_listing("111", error="not found")])
    assert "error: not found" in md


# ── digest ───────────────────────────────────────────────────────────────────
def test_digest_counts():
    changes = [{"status": "changed"}, {"status": "new"}, {"status": "same"},
               {"status": "error"}]
    line = digest_line(changes)
    assert "1 changed" in line and "1 new" in line and "1 err" in line


def test_digest_no_changes():
    assert digest_line([{"status": "same"}, {"status": "same"}]) == "no changes"


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
