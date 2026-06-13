#!/usr/bin/env python3
"""
Localized ASO research — run the keyword + rank tooling per market/locale.

The Google and Apple volume clients already take geo/language params, and the
rank checker takes a country — but using them per-locale means hand-looking-up
Google's numeric geoTargetConstant / languageConstant ids, which is error-prone.
This is the missing registry + glue: name a locale (de-DE, ja-JP, …) and get the
right ids for every tool, plus a per-locale rank snapshot, so the localize step
isn't a manual lookup exercise. Unlocks the asc-localize-metadata skill.

Usage:
    python3 aso_locale.py --list                       # show supported locales
    python3 aso_locale.py --locale de-DE               # resolve ids for one locale
    python3 aso_locale.py --locale de-DE --bundle app.airowe.clarity \
        --keywords "meditation,achtsamkeit" --ranks    # localized rank snapshot

Exit codes: 0 ok · 1 bad args / unknown locale.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_rank_check import ranks_for  # noqa: E402


@dataclass(frozen=True)
class Locale:
    code: str            # BCP-47-ish, e.g. de-DE
    name: str
    itunes_country: str  # 2-letter country for iTunes APIs (rank, lookup, reviews)
    google_geo: int      # Google Ads geoTargetConstant id
    google_lang: int     # Google Ads languageConstant id
    apple_market: str    # Apple Search Ads market area code

    def to_dict(self) -> dict:
        d = asdict(self)
        d["google_geo_constant"] = f"geoTargetConstants/{self.google_geo}"
        d["google_lang_constant"] = f"languageConstants/{self.google_lang}"
        return d


# A focused registry of high-value App Store markets. Google ids are the stable
# public constants; extend as needed. (geo = country, lang = language.)
LOCALES: dict[str, Locale] = {
    "en-US": Locale("en-US", "English (US)", "US", 2840, 1000, "US"),
    "en-GB": Locale("en-GB", "English (UK)", "GB", 2826, 1000, "GB"),
    "en-CA": Locale("en-CA", "English (Canada)", "CA", 2124, 1000, "CA"),
    "en-AU": Locale("en-AU", "English (Australia)", "AU", 2036, 1000, "AU"),
    "de-DE": Locale("de-DE", "German", "DE", 2276, 1001, "DE"),
    "fr-FR": Locale("fr-FR", "French", "FR", 2250, 1002, "FR"),
    "es-ES": Locale("es-ES", "Spanish (Spain)", "ES", 2724, 1003, "ES"),
    "es-MX": Locale("es-MX", "Spanish (Mexico)", "MX", 2484, 1003, "MX"),
    "it-IT": Locale("it-IT", "Italian", "IT", 2380, 1004, "IT"),
    "pt-BR": Locale("pt-BR", "Portuguese (Brazil)", "BR", 2076, 1014, "BR"),
    "nl-NL": Locale("nl-NL", "Dutch", "NL", 2528, 1010, "NL"),
    "ja-JP": Locale("ja-JP", "Japanese", "JP", 2392, 1005, "JP"),
    "ko-KR": Locale("ko-KR", "Korean", "KR", 2410, 1012, "KR"),
    "zh-CN": Locale("zh-CN", "Chinese (Simplified)", "CN", 2156, 1017, "CN"),
}


def resolve(code: str) -> Locale:
    loc = LOCALES.get(code)
    if loc is None:
        raise KeyError(code)
    return loc


def localized_ranks(loc: Locale, bundle_id: str, keywords: list[str]) -> list[dict]:
    """Rank snapshot for one locale (uses the locale's iTunes country)."""
    results = ranks_for(bundle_id, keywords, country=loc.itunes_country)
    return [r.to_dict() for r in results]


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Localized ASO research helper")
    ap.add_argument("--list", action="store_true", help="list supported locales")
    ap.add_argument("--locale", help="locale code, e.g. de-DE")
    ap.add_argument("--bundle", help="bundle id (for --ranks)")
    ap.add_argument("--keywords", help="comma/newline keywords (for --ranks)")
    ap.add_argument("--ranks", action="store_true", help="run a localized rank snapshot")
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if args.list:
        if args.json:
            print(json.dumps([l.to_dict() for l in LOCALES.values()], indent=2))
        else:
            print(f"{'code':7} {'country':8} {'g-geo':6} {'g-lang':6} name")
            print("-" * 50)
            for l in LOCALES.values():
                print(f"{l.code:7} {l.itunes_country:8} {l.google_geo:<6} "
                      f"{l.google_lang:<6} {l.name}")
        return 0

    if not args.locale:
        print("give --locale <code> (or --list)", file=sys.stderr)
        return 1
    try:
        loc = resolve(args.locale)
    except KeyError:
        print(f"unknown locale '{args.locale}'. Run --list for supported codes.",
              file=sys.stderr)
        return 1

    if args.ranks:
        if not args.bundle or not args.keywords:
            print("--ranks needs --bundle and --keywords", file=sys.stderr)
            return 1
        kws = [p.strip() for chunk in args.keywords.splitlines()
               for p in chunk.split(",") if p.strip()]
        rows = localized_ranks(loc, args.bundle, kws)
        if args.json:
            print(json.dumps({"locale": loc.code, "ranks": rows}, indent=2))
        else:
            print(f"=== {loc.name} ({loc.code}) ranks ===")
            for r in rows:
                rank = f"#{r['rank']}" if r["rank"] else "—"
                print(f"  {r['keyword'][:30]:30} {rank}")
        return 0

    # default: just resolve and show the ids for this locale
    if args.json:
        print(json.dumps(loc.to_dict(), indent=2))
    else:
        d = loc.to_dict()
        print(f"{loc.name} ({loc.code})")
        print(f"  iTunes country:  {loc.itunes_country}")
        print(f"  Google geo:      {d['google_geo_constant']}")
        print(f"  Google language: {d['google_lang_constant']}")
        print(f"  Apple market:    {loc.apple_market}")
        print(f"\n  e.g. gads_volume_cli.py --geo {loc.google_geo} "
              f"--lang {loc.google_lang} \"<keywords>\"")
        print(f"       asa_popularity_cli.py --market {loc.apple_market} \"<keywords>\"")
        print(f"       aso_rank_check.py --bundle <id> --country "
              f"{loc.itunes_country} \"<keywords>\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
