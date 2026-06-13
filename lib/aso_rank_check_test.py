#!/usr/bin/env python3
"""
Unit tests for the App Store rank checker.

No network: urllib.request.urlopen is monkeypatched to return recorded-shape
payloads (and to raise HTTPError to exercise retry/backoff). Sleeping is
patched out. Run:  python3 aso_rank_check_test.py
(zero deps — plain asserts, exits non-zero on failure.)
"""
from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aso_rank_check as rc  # noqa: E402
from aso_rank_check import (  # noqa: E402
    Rank, RankCheckError, rank_for, ranks_for, _keywords_from, MAX_LIMIT,
)


# ── fakes ────────────────────────────────────────────────────────────────────
class FakeResp:
    """Mimics the context-manager object urlopen returns."""
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def _listing(*bundles_named, result_count=None):
    """Build an iTunes-search-shaped JSON body from (bundleId, trackName) pairs."""
    results = [{"bundleId": b, "trackName": n} for b, n in bundles_named]
    payload = {"resultCount": result_count if result_count is not None else len(results),
               "results": results}
    return json.dumps(payload)


def _patch_urlopen(monkey_seq):
    """monkey_seq: a list of either FakeResp or Exception. Each call pops one."""
    seq = list(monkey_seq)
    calls = {"n": 0}

    def fake_urlopen(req, timeout=20):
        calls["n"] += 1
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    rc.urllib.request.urlopen = fake_urlopen  # type: ignore[attr-defined]
    return calls


# patch sleep out globally for the suite (retry backoff shouldn't slow tests)
rc._sleep = lambda *_a, **_k: None


def _http_error(code, retry_after=None):
    hdrs = {}
    if retry_after is not None:
        hdrs["Retry-After"] = str(retry_after)
    return urllib.error.HTTPError(
        url="http://x", code=code, msg="err", hdrs=hdrs, fp=io.BytesIO(b""))


# ── rank parsing ─────────────────────────────────────────────────────────────
def test_rank_found_at_position():
    _patch_urlopen([FakeResp(_listing(
        ("com.other.a", "A"), ("com.airowe.clarity", "Heathen"), ("com.other.b", "B")))])
    r = rank_for("com.airowe.clarity", "stoic")
    assert r.rank == 2, r.rank
    assert r.found_name == "Heathen"
    assert r.total_results == 3
    assert r.error == ""


def test_rank_not_found_returns_none():
    _patch_urlopen([FakeResp(_listing(("com.other.a", "A"), result_count=150))])
    r = rank_for("com.airowe.clarity", "meditation")
    assert r.rank is None
    assert r.found_name == ""
    assert r.total_results == 150


def test_first_position_is_rank_1_not_0():
    _patch_urlopen([FakeResp(_listing(("com.me.app", "Me")))])
    r = rank_for("com.me.app", "x")
    assert r.rank == 1, "rank must be 1-based"


# ── limit capping ────────────────────────────────────────────────────────────
def test_limit_capped_at_max():
    _patch_urlopen([FakeResp(_listing(("com.me.app", "Me")))])
    r = rank_for("com.me.app", "x", limit=99999)
    assert r.limit == MAX_LIMIT


def test_limit_floored_at_one():
    _patch_urlopen([FakeResp(_listing(("com.me.app", "Me")))])
    r = rank_for("com.me.app", "x", limit=0)
    assert r.limit == 1


# ── Apple's control-char JSON ────────────────────────────────────────────────
def test_parses_json_with_raw_control_chars():
    # Apple embeds literal newlines inside description strings -> strict=False
    body = '{"resultCount":1,"results":[{"bundleId":"com.me.app",' \
           '"trackName":"Me","description":"line1\nline2"}]}'
    _patch_urlopen([FakeResp(body)])
    r = rank_for("com.me.app", "x")
    assert r.rank == 1


# ── retry / backoff ──────────────────────────────────────────────────────────
def test_retries_on_429_then_succeeds():
    calls = _patch_urlopen([
        _http_error(429),
        _http_error(429),
        FakeResp(_listing(("com.me.app", "Me"))),
    ])
    r = rank_for("com.me.app", "x")
    assert r.rank == 1
    assert calls["n"] == 3, "should have retried twice then succeeded"


def test_retries_on_503():
    calls = _patch_urlopen([_http_error(503), FakeResp(_listing(("com.me.app", "Me")))])
    r = rank_for("com.me.app", "x")
    assert r.rank == 1 and calls["n"] == 2


def test_gives_up_after_max_retries():
    # MAX_RETRIES retries -> MAX_RETRIES+1 attempts, all 429
    _patch_urlopen([_http_error(429)] * (rc.MAX_RETRIES + 1))
    try:
        rank_for("com.me.app", "x")
        assert False, "should have raised after exhausting retries"
    except RankCheckError as e:
        assert "429" in str(e)


def test_non_retryable_4xx_raises_immediately():
    calls = _patch_urlopen([_http_error(400), FakeResp(_listing(("com.me.app", "Me")))])
    try:
        rank_for("com.me.app", "x")
        assert False, "400 should not be retried"
    except RankCheckError:
        assert calls["n"] == 1, "must not retry a 400"


def test_retry_after_header_is_honored():
    seen = {"wait": None}
    rc._sleep = lambda s: seen.__setitem__("wait", s)
    _patch_urlopen([_http_error(429, retry_after=7),
                    FakeResp(_listing(("com.me.app", "Me")))])
    rank_for("com.me.app", "x")
    rc._sleep = lambda *_a, **_k: None  # restore no-op
    assert seen["wait"] == 7.0, seen["wait"]


# ── batch resilience ─────────────────────────────────────────────────────────
def test_batch_one_keyword_errors_others_survive():
    # kw1 ok; kw2 hard-fails all retries; kw3 ok
    seq = [FakeResp(_listing(("com.me.app", "Me")))]
    seq += [_http_error(500)] * (rc.MAX_RETRIES + 1)
    seq += [FakeResp(_listing(("com.me.app", "Me")))]
    _patch_urlopen(seq)
    out = ranks_for("com.me.app", ["a", "b", "c"], pause=0)
    assert len(out) == 3
    assert out[0].rank == 1 and out[0].error == ""
    assert out[1].rank is None and out[1].error != ""   # errored, didn't abort
    assert out[2].rank == 1 and out[2].error == ""


# ── keyword input parsing ────────────────────────────────────────────────────
def test_keywords_from_comma_and_newline():
    assert _keywords_from("a, b,c") == ["a", "b", "c"]
    assert _keywords_from("a\nb\nc") == ["a", "b", "c"]
    assert _keywords_from("a,\n b ,\nc,") == ["a", "b", "c"]


def test_keywords_from_strips_empties():
    assert _keywords_from(",, a ,,") == ["a"]


def test_rank_to_dict_has_error_field():
    r = Rank(keyword="x", rank=None, found_name="", total_results=0, limit=200)
    d = r.to_dict()
    assert "error" in d and d["error"] == ""


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
