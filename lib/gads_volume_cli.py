#!/usr/bin/env python3
"""
CLI: fetch real Google Keyword Planner search volume for keywords.

What the `aso-keyword-research` skill shells out to when a Google Ads credential
is present — real average monthly searches + competition, replacing the
autocomplete-rank proxy.

Usage:
    python3 gads_volume_cli.py "recipe app, meal planner, grocery list"
    python3 gads_volume_cli.py --geo 2826 --lang 1001 --json "recipe,cooking"
    cat seeds.txt | python3 gads_volume_cli.py -

Credentials from the environment (loaded from a .env you control — never
committed):
    GADS_DEVELOPER_TOKEN, GADS_CUSTOMER_ID, and either
    GADS_ACCESS_TOKEN, or GADS_REFRESH_TOKEN + GADS_CLIENT_ID + GADS_CLIENT_SECRET
    GADS_LOGIN_CUSTOMER_ID (optional, for MCC accounts)

Exit codes: 0 ok · 2 missing credentials · 3 API error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from google_keyword_volume import (  # noqa: E402
    GoogleKeywordPlanner,
    GoogleAdsError,
    MissingCredentials,
    normalize_to_volume,
)


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _keywords_from(arg: str | None) -> list[str]:
    raw = sys.stdin.read() if arg in (None, "-") else arg
    parts = [p.strip() for chunk in raw.splitlines() for p in chunk.split(",")]
    return [p for p in parts if p]


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Google Keyword Planner search volume")
    ap.add_argument("keywords", nargs="?",
                    help="comma/newline-separated keywords, or '-' for stdin")
    ap.add_argument("--geo", default="2840", help="geo target constant id (default 2840=US)")
    ap.add_argument("--lang", default="1000", help="language constant id (default 1000=en)")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    ap.add_argument("--env", default=str(Path(__file__).resolve().parents[1] / ".env"),
                    help="path to .env (default: repo-root .env)")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    _load_dotenv(Path(args.env))
    keywords = _keywords_from(args.keywords)
    if not keywords:
        print("no keywords given", file=sys.stderr)
        return 1

    try:
        client = GoogleKeywordPlanner.from_env()
    except MissingCredentials as e:
        print(f"missing credentials: {e}\n"
              "  set GADS_DEVELOPER_TOKEN + GADS_CUSTOMER_ID + "
              "(GADS_ACCESS_TOKEN | GADS_REFRESH_TOKEN+GADS_CLIENT_ID+GADS_CLIENT_SECRET)",
              file=sys.stderr)
        return 2

    try:
        results = client.volume(
            keywords,
            language=f"languageConstants/{args.lang}",
            geo_targets=[f"geoTargetConstants/{args.geo}"])
    except GoogleAdsError as e:
        print(f"Google Ads API error: {e}", file=sys.stderr)
        return 3

    if args.json:
        payload = [{**r.to_dict(), "volume": normalize_to_volume(r.avg_monthly_searches)}
                   for r in results]
        print(json.dumps(payload, indent=2))
        return 0

    print(f"{'keyword':32} {'searches/mo':>12} {'comp':>6} {'vol':>5}")
    print("-" * 60)
    for r in results:
        print(f"{r.keyword[:32]:32} {r.avg_monthly_searches:>12,} "
              f"{r.competition[:6]:>6} {normalize_to_volume(r.avg_monthly_searches):>5.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
