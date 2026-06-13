#!/usr/bin/env python3
"""
Unit tests for aso-review-mine — pure logic (tokenize, mine, render).
No network. Run:  python3 aso_review_mine_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_review_mine import (  # noqa: E402
    _tokens, _bigrams, _reviews_from_asc, mine, render_md,
)


def _rev(rating, title, body):
    return {"rating": rating, "title": title, "body": body}


# ── tokenize ─────────────────────────────────────────────────────────────────
def test_tokens_drop_stopwords():
    toks = _tokens("the app is really great for you and me")
    for s in ("the", "app", "really", "for", "you", "and", "me"):
        assert s not in toks


def test_tokens_min_length():
    toks = _tokens("go to a big meditation")
    assert "go" not in toks and "to" not in toks
    assert "big" in toks and "meditation" in toks


def test_bigrams():
    assert _bigrams(["daily", "stoic", "readings"]) == ["daily stoic", "stoic readings"]


# ── asc normalization ────────────────────────────────────────────────────────
def test_reviews_from_asc_shape():
    payload = {"data": [
        {"attributes": {"rating": 5, "title": "T", "body": "B"}},
        {"attributes": {"rating": 1, "title": "X", "body": "Y"}},
    ]}
    out = _reviews_from_asc(payload)
    assert out == [{"rating": 5, "title": "T", "body": "B"},
                   {"rating": 1, "title": "X", "body": "Y"}]


def test_reviews_from_asc_empty():
    assert _reviews_from_asc({"data": []}) == []
    assert _reviews_from_asc({}) == []


def test_reviews_from_asc_tolerates_missing_fields():
    out = _reviews_from_asc({"data": [{"attributes": {"rating": 3}}]})
    assert out[0]["title"] == "" and out[0]["body"] == ""


# ── mining ───────────────────────────────────────────────────────────────────
def _sample():
    return [
        _rev(5, "Love meditation", "meditation meditation focus stoic"),
        _rev(5, "Great focus", "focus meditation stoic calm"),
        _rev(4, "Good", "focus meditation sessions"),
        _rev(2, "Crashes", "the app crashes crashes bug timer"),
        _rev(1, "Broken", "crashes bug login login broken"),
    ]


def test_mine_counts_and_avg():
    res = mine(_sample(), app="x")
    assert res.n_reviews == 5
    assert res.avg_rating == round((5 + 5 + 4 + 2 + 1) / 5, 2)


def test_mine_keyword_candidates_rank_by_freq():
    res = mine(_sample(), app="x")
    terms = [t for t, _ in res.keyword_candidates]
    assert "meditation" in terms and "focus" in terms
    # meditation appears more than sessions
    counts = dict(res.keyword_candidates)
    assert counts["meditation"] > counts.get("sessions", 0)


def test_mine_positive_vs_pain_separation():
    res = mine(_sample(), app="x")
    pos = [t for t, _ in res.positive_terms]
    pain = [t for t, _ in res.pain_themes]
    assert "meditation" in pos and "focus" in pos
    assert "crashes" in pain and "bug" in pain
    # positive terms shouldn't be dominated by crash language
    assert "crashes" not in pos


def test_mine_requires_freq_above_one():
    # a term appearing once must not surface as a candidate
    res = mine([_rev(5, "", "unique singleton meditation meditation")], app="x")
    terms = [t for t, _ in res.keyword_candidates]
    assert "singleton" not in terms     # count 1, filtered
    assert "meditation" in terms        # count 2, kept


def test_mine_empty_reviews():
    res = mine([], app="x")
    assert res.n_reviews == 0 and res.avg_rating == 0.0
    assert res.keyword_candidates == []


# ── render ───────────────────────────────────────────────────────────────────
def test_render_md_includes_sections():
    md = render_md(mine(_sample(), app="heathen"))
    assert "Keyword candidates" in md
    assert "Pain themes" in md
    assert "positive reviewers" in md
    assert "heathen" in md


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
