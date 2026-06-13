#!/usr/bin/env python3
"""
CLI: fetch real Apple Search Ads Search Popularity (5–100) for keywords.

This is what the `aso-keyword-research` skill shells out to when a credential
is present — replacing the autocomplete-rank proxy with Apple's own demand data.

Usage:
    python3 asa_popularity_cli.py "recipe app, meal planner, grocery list"
    python3 asa_popularity_cli.py --market GB --json "recipe,cooking,timer"
    cat seeds.txt | python3 asa_popularity_cli.py -

Credentials come from the environment (loaded from a .env you control — never
committed). Set EITHER:
    ASA_ORG_ID + ASA_ACCESS_TOKEN
  or
    ASA_ORG_ID + ASA_CLIENT_ID + ASA_CLIENT_SECRET

Exit codes: 0 ok · 2 missing credentials · 3 API error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apple_search_popularity import (  # noqa: E402
    AppleSearchAdsClient,
    AppleSearchAdsError,
    MissingCredentials,
    normalize_to_volume,
)


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader — only sets vars not already in the environment."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


def _keywords_from(arg: str | None) -> list[str]:
    if arg in (None, "-"):
        raw = sys.stdin.read()
    else:
        raw = arg
    parts = [p.strip() for chunk in raw.splitlines() for p in chunk.split(",")]
    return [p for p in parts if p]


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Apple Search Ads keyword popularity")
    ap.add_argument("keywords", nargs="?",
                    help="comma/newline-separated keywords, or '-' for stdin")
    ap.add_argument("--market", default="US", help="market area / country (default US)")
    ap.add_argument("--match", default="EXACT", choices=["EXACT", "BROAD"],
                    help="match type (default EXACT)")
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
        client = AppleSearchAdsClient.from_env()
    except MissingCredentials as e:
        print(f"missing credentials: {e}\n"
              "  set ASA_ORG_ID + (ASA_ACCESS_TOKEN | ASA_CLIENT_ID+ASA_CLIENT_SECRET)",
              file=sys.stderr)
        return 2

    try:
        results = client.popularity(keywords, market_area=args.market,
                                    match_type=args.match)
    except AppleSearchAdsError as e:
        print(f"Apple Search Ads API error: {e}", file=sys.stderr)
        return 3

    if args.json:
        payload = [{**r.to_dict(), "volume": normalize_to_volume(r.score)}
                   for r in results]
        print(json.dumps(payload, indent=2))
        return 0

    # table
    print(f"{'keyword':32} {'SP':>4}  {'volume':>6}  note")
    print("-" * 60)
    for r in results:
        sp = str(r.score) if r.reported else "—"
        vol = f"{normalize_to_volume(r.score):.0f}"
        note = "below SP 35 (low, not zero)" if r.below_threshold else ""
        print(f"{r.keyword[:32]:32} {sp:>4}  {vol:>6}  {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
