#!/usr/bin/env python3
"""
Unit tests for aso-context-gen — pure logic (seed derivation, context render),
no network. Run:  python3 aso_context_gen_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_context_gen import derive_seeds, build_context  # noqa: E402


# ── seed derivation ──────────────────────────────────────────────────────────
def test_seeds_include_genre_words_first():
    seeds = derive_seeds("Heathen", "meditation app for calm", ["Lifestyle"])
    assert "lifestyle" in seeds


def test_seeds_drop_stopwords():
    seeds = derive_seeds("The App", "this is the best app for you and your friends", [])
    for stop in ("the", "this", "app", "for", "you", "and", "your"):
        assert stop not in seeds, f"stopword leaked: {stop}"


def test_seeds_drop_short_and_nonalpha():
    seeds = derive_seeds("X", "go go 123 meditation meditation calm", [])
    assert "go" not in seeds       # too short
    assert "123" not in seeds      # non-alpha
    assert "meditation" in seeds


def test_seeds_ranked_by_frequency():
    seeds = derive_seeds("", "recipe recipe recipe planner planner grocery", [])
    # recipe (3) should come before grocery (1)
    assert seeds.index("recipe") < seeds.index("grocery")


def test_seeds_respect_count_limit():
    # alpha-only words (derive_seeds filters non-alpha), each repeated to qualify
    alpha = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf",
             "hotel", "india", "juliet"]
    text = " ".join(f"{w} {w}" for w in alpha)
    seeds = derive_seeds("", text, [], n=5)
    assert len(seeds) == 5


def test_seeds_dedup():
    seeds = derive_seeds("Meditation", "meditation meditation", ["Meditation"])
    assert seeds.count("meditation") == 1


# ── context render ───────────────────────────────────────────────────────────
def test_build_context_from_listing():
    listing = {"trackName": "Heathen - Secular Meditation",
               "genres": ["Lifestyle", "Health & Fitness"],
               "description": "A secular meditation app.\nMore text."}
    md = build_context("heathen", "app.airowe.clarity", listing)
    assert "display_name: \"Heathen - Secular Meditation\"" in md
    assert "category: \"Lifestyle\"" in md
    assert "subcategory: \"Health & Fitness\"" in md
    assert "playstore: \"app.airowe.clarity\"" in md
    assert "one_liner: \"A secular meditation app.\"" in md


def test_build_context_brand_term_from_name():
    listing = {"trackName": "Swoop: Chat & Meet IRL", "genres": ["Social Networking"],
               "description": "x"}
    md = build_context("swoop", "com.chat.swoop", listing)
    assert "- \"Swoop\"" in md   # brand term derived from name before the colon


def test_build_context_handles_no_listing():
    md = build_context("mystery", "com.x.y", None)
    assert "display_name: \"TODO\"" in md
    assert "category: \"TODO\"" in md
    assert "playstore: \"com.x.y\"" in md


def test_build_context_brand_enrichment():
    listing = {"trackName": "Swoop", "genres": ["Social"], "description": "x"}
    brand = {"description": "Meet people nearby", "industry": "Social Networking",
             "colors": ["#e63946", "#1d3557"],
             "socials": {"x": "https://x.com/swoop"}}
    md = build_context("swoop", "com.chat.swoop", listing, brand)
    assert "context.dev" in md
    assert "brand_industry: \"Social Networking\"" in md
    assert "#e63946" in md
    assert "https://x.com/swoop" in md


def test_build_context_no_brand_block_when_absent():
    listing = {"trackName": "X", "genres": ["Y"], "description": "z"}
    md = build_context("x", "com.x", listing, None)
    assert "auto-filled via context.dev" not in md


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
