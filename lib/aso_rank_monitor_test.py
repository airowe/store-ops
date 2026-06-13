#!/usr/bin/env python3
"""
Unit tests for the scheduled rank monitor — pure logic (parsing + deltas),
no network. Run:  python3 aso_rank_monitor_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_rank_check import Rank  # noqa: E402
from aso_rank_monitor import (  # noqa: E402
    previous_ranks, compute_deltas, render_snapshot, digest_line,
)


def _rank(kw, rank, total=100, error=""):
    return Rank(keyword=kw, rank=rank, found_name="", total_results=total,
                limit=200, error=error)


# ── ranks.md parsing ─────────────────────────────────────────────────────────
SAMPLE_MD = """# heathen — rank log

## 2026-06-01 · US · App Store

| keyword | rank | Δ vs prev | competitors |
|---------|------|-----------|-------------|
| agnostic | #50 | baseline | 52 |
| stoic | — | baseline | 180 |

## 2026-06-08 · US · App Store

| keyword | rank | Δ vs prev | competitors |
|---------|------|-----------|-------------|
| agnostic | #45 | ↑ +5 | 52 |
| stoic | — | — | 184 |
| aurelius | #84 | new | 133 |
"""


def test_previous_ranks_reads_latest_block_only():
    prev = previous_ranks(SAMPLE_MD)
    # must read the 2026-06-08 block, not 06-01
    assert prev["agnostic"] == 45, prev
    assert prev["stoic"] is None
    assert prev["aurelius"] == 84


def test_previous_ranks_skips_header_and_separator_rows():
    prev = previous_ranks(SAMPLE_MD)
    assert "keyword" not in prev
    assert all(not set(k) <= {"-", " "} for k in prev)


def test_previous_ranks_empty_when_no_blocks():
    assert previous_ranks("# title\n\njust prose, no snapshot") == {}


# ── delta computation ────────────────────────────────────────────────────────
def test_delta_improved():
    d = compute_deltas([_rank("k", 40)], {"k": 50})[0]
    assert d.symbol == "↑ +10", d.symbol   # 50 -> 40 is better by 10


def test_delta_dropped():
    d = compute_deltas([_rank("k", 60)], {"k": 50})[0]
    assert d.symbol == "↓ -10"


def test_delta_unchanged():
    d = compute_deltas([_rank("k", 50)], {"k": 50})[0]
    assert d.symbol == "—"


def test_delta_new_when_absent_then_ranks():
    d = compute_deltas([_rank("k", 30)], {"k": None})[0]
    assert d.symbol == "new"


def test_delta_new_when_first_seen():
    d = compute_deltas([_rank("k", 30)], {})[0]   # keyword not in prev at all
    assert d.symbol == "new"


def test_delta_lost_when_was_ranking_now_gone():
    d = compute_deltas([_rank("k", None)], {"k": 90})[0]
    assert d.symbol == "lost"


def test_delta_dash_when_absent_both_runs():
    d = compute_deltas([_rank("k", None)], {"k": None})[0]
    assert d.symbol == "—"


def test_delta_err_passthrough():
    d = compute_deltas([_rank("k", None, error="HTTP 500")], {"k": 40})[0]
    assert d.symbol == "err"
    assert d.prev == 40


# ── digest + render ──────────────────────────────────────────────────────────
def test_digest_counts():
    deltas = compute_deltas(
        [_rank("a", 40), _rank("b", 60), _rank("c", 10), _rank("d", None)],
        {"a": 50, "b": 50, "c": None, "d": 90})
    line = digest_line(deltas)
    assert "↑1" in line and "↓1" in line and "new 1" in line and "lost 1" in line


def test_digest_no_change():
    deltas = compute_deltas([_rank("a", 50)], {"a": 50})
    assert digest_line(deltas) == "no change"


def test_render_snapshot_roundtrips_through_parser():
    deltas = compute_deltas([_rank("agnostic", 45, 52), _rank("stoic", None, 184)],
                            {"agnostic": 50, "stoic": None})
    md = "## 2026-06-08 · US · App Store\n\n" + render_snapshot(
        "2026-06-08", "US", deltas)
    # the rendered block must be re-parseable back to the same ranks
    reparsed = previous_ranks(md)
    assert reparsed["agnostic"] == 45
    assert reparsed["stoic"] is None


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
