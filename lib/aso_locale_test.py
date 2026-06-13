#!/usr/bin/env python3
"""
Unit tests for aso-locale — pure logic (registry + resolution).
No network. Run:  python3 aso_locale_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_locale import LOCALES, resolve, Locale  # noqa: E402


def test_resolve_known_locale():
    loc = resolve("de-DE")
    assert loc.itunes_country == "DE"
    assert loc.google_geo == 2276
    assert loc.google_lang == 1001
    assert loc.apple_market == "DE"


def test_resolve_unknown_raises():
    try:
        resolve("xx-XX")
        assert False, "should raise KeyError"
    except KeyError:
        pass


def test_us_default_constants_match_clients():
    # these must match the GEO_US / LANG_EN defaults in google_keyword_volume
    us = resolve("en-US")
    assert us.google_geo == 2840 and us.google_lang == 1000


def test_to_dict_adds_constant_strings():
    d = resolve("fr-FR").to_dict()
    assert d["google_geo_constant"] == "geoTargetConstants/2250"
    assert d["google_lang_constant"] == "languageConstants/1002"


def test_all_locales_well_formed():
    for code, loc in LOCALES.items():
        assert isinstance(loc, Locale)
        assert loc.code == code
        assert len(loc.itunes_country) == 2, code
        assert loc.google_geo > 0 and loc.google_lang > 0, code
        assert loc.apple_market, code


def test_registry_has_key_markets():
    for code in ("en-US", "de-DE", "ja-JP", "fr-FR", "es-MX", "pt-BR", "ko-KR"):
        assert code in LOCALES, f"missing {code}"


def test_english_variants_share_language():
    # en-US/en-GB/en-CA all use language 1000 but differ in geo/country
    en = [resolve(c) for c in ("en-US", "en-GB", "en-CA", "en-AU")]
    assert len({l.google_lang for l in en}) == 1   # same language
    assert len({l.google_geo for l in en}) == 4     # distinct geos


def test_localized_ranks_uses_locale_country(monkey=None):
    import aso_locale
    captured = {}

    def fake_ranks_for(bundle, kws, *, country="US"):
        captured["country"] = country
        captured["kws"] = kws

        class R:
            def to_dict(self):
                return {"keyword": "k", "rank": None}
        return [R()]

    orig = aso_locale.ranks_for
    aso_locale.ranks_for = fake_ranks_for
    try:
        aso_locale.localized_ranks(resolve("ja-JP"), "com.x", ["a", "b"])
        assert captured["country"] == "JP"
        assert captured["kws"] == ["a", "b"]
    finally:
        aso_locale.ranks_for = orig


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
