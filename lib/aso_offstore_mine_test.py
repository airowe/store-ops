#!/usr/bin/env python3
"""
Unit tests for aso-offstore-mine — pure logic (tokenize, mine, render, source
normalization). No network: fetchers are injected, so the core is tested with
in-memory text. Run:  python3 aso_offstore_mine_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_offstore_mine import (  # noqa: E402
    _tokens,
    _bigrams,
    _strip_vtt,
    _strip_markdown_noise,
    Source,
    mine_sources,
    render_md,
)


def _src(kind, url, text):
    return Source(kind=kind, url=url, text=text)


# ── tokenize ─────────────────────────────────────────────────────────────────
def test_tokens_drop_stopwords_and_short():
    toks = _tokens("the best free meditation app for you")
    assert "the" not in toks and "for" not in toks and "you" not in toks
    assert "free" in toks and "meditation" in toks


def test_bigrams():
    assert _bigrams(["guided", "meditation", "timer"]) == [
        "guided meditation",
        "meditation timer",
    ]


# ── source normalization ─────────────────────────────────────────────────────
def test_strip_vtt_removes_timestamps_and_tags():
    vtt = (
        "WEBVTT\nKind: captions\nLanguage: en\n\n"
        "00:00:01.000 --> 00:00:03.000\n"
        "<c>take a</c> deep breath\n\n"
        "00:00:03.000 --> 00:00:05.000\n"
        "and <00:00:04.000>relax now\n"
    )
    out = _strip_vtt(vtt)
    assert "-->" not in out
    assert "WEBVTT" not in out
    assert "<c>" not in out and "<00:00" not in out
    assert "deep breath" in out and "relax now" in out


def test_strip_markdown_noise_drops_urls_and_link_cruft():
    md = "Try Headspace (https://example.com/x) and www.foo.com — great app"
    out = _strip_markdown_noise(md)
    assert "https" not in out and "www" not in out and "example.com" not in out
    assert "Headspace" in out and "great app" in out


# ── mining ───────────────────────────────────────────────────────────────────
def _sources():
    return [
        _src("web", "https://r.jina.ai/x", "Best free meditation apps: guided meditation, "
             "sleep timer, mindfulness. Headspace and Calm are popular."),
        _src("web", "https://r.jina.ai/y", "A free meditation app with a sleep timer and "
             "guided meditation beats a paid one. Mindfulness matters."),
        _src("youtube", "https://youtu.be/z", "guided meditation guided meditation sleep "
             "timer mindfulness free app"),
    ]


def test_mine_surfaces_repeated_terms_as_candidates():
    res = mine_sources(_sources(), app="clarity", top=10)
    terms = [t for t, _ in res.keyword_candidates]
    # appears across multiple sources → must surface
    assert "meditation" in terms
    assert "free" in terms
    # a bigram users actually type
    assert any(t == "guided meditation" for t, _ in res.keyword_candidates)


def test_mine_requires_more_than_one_occurrence():
    # a term appearing exactly once must not be a candidate
    res = mine_sources([_src("web", "u", "uniqueword appears once only here")], app="x", top=10)
    terms = [t for t, _ in res.keyword_candidates]
    assert "uniqueword" not in terms


def test_mine_detects_competitor_names_when_seeded():
    res = mine_sources(
        _sources(), app="clarity", top=10, competitors=["Headspace", "Calm", "Hallow"]
    )
    found = {c.lower() for c, _ in res.competitor_mentions}
    assert "headspace" in found
    assert "calm" in found
    assert "hallow" not in found  # not mentioned in the sources


def test_mine_counts_sources_by_kind():
    res = mine_sources(_sources(), app="clarity")
    assert res.n_sources == 3
    assert res.by_kind == {"web": 2, "youtube": 1}


def test_mine_empty_sources_is_safe():
    res = mine_sources([], app="x")
    assert res.n_sources == 0
    assert res.keyword_candidates == []


# ── render ───────────────────────────────────────────────────────────────────
def test_render_md_has_sections_and_app():
    md = render_md(mine_sources(_sources(), app="clarity", competitors=["Headspace"]))
    assert "clarity" in md
    assert "Keyword candidates" in md
    assert "Competitor" in md
    assert "off-store" in md.lower()


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
