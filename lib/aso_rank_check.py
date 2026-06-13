#!/usr/bin/env python3
"""
Read an app's organic search rank for a set of keywords — no paid ASO API.

This is the watch half of the ASO loop (the part Astro / the rank-trackers
charge for). The keyword-research skill *picks* keywords and the optimization
skill *ships* them; this tells you whether the picks actually moved the needle.

How it works — for free, no auth:
  • App Store: the public iTunes Search API
    (`itunes.apple.com/search?term=...&entity=software`) returns apps in the
    store's own relevance/ranking order. Your app's index in that list IS its
    organic rank for that term.
  • Google Play: the public completion/search endpoint is fragile and
    rate-limited; Play ranking is left to the optional Chrome path in the skill.
    This client covers the App Store, which is where the keyword field lives.

Usage:
    python3 aso_rank_check.py --bundle com.airowe.heathen \
        "stoic,meditation,stoic journal,philosophy app" --json
    python3 aso_rank_check.py --bundle com.chat.swoop --country US "meet people,events nearby"
    cat keywords.txt | python3 aso_rank_check.py --bundle com.x.y -

Exit codes: 0 ok (incl. partial — some keywords may carry .error) · 1 bad args
· 3 network error · 4 every keyword failed.

Resilience: transient failures (429 / 5xx / timeout) are retried with backoff
(honoring Retry-After); a single keyword that still fails comes back as a Rank
with .error set rather than aborting the whole batch.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict, field

SEARCH_URL = "https://itunes.apple.com/search"
# Apple returns at most 200 software results; rank beyond that is "not found".
MAX_LIMIT = 200
USER_AGENT = "Mozilla/5.0 (Macintosh; aso-rank-check)"
# Retry transient failures (rate-limit / 5xx / timeout) with exponential backoff.
MAX_RETRIES = 3
BACKOFF_BASE = 1.5      # seconds; 1.5, 3.0, 6.0
RETRY_STATUS = {429, 500, 502, 503, 504}


class RankCheckError(Exception):
    pass


@dataclass
class Rank:
    keyword: str
    rank: int | None        # 1-based position, or None if not in top `limit`
    found_name: str         # the app's listed name at that rank (sanity check)
    total_results: int      # how many apps competed for this term
    limit: int              # how deep we looked
    error: str = ""         # non-empty if this keyword's fetch failed (batch goes on)

    def to_dict(self) -> dict:
        return asdict(self)


def _sleep(seconds: float) -> None:
    """Indirection so tests can monkeypatch out real sleeping."""
    time.sleep(seconds)


def _fetch(term: str, country: str, limit: int) -> dict:
    """Fetch one term's results, retrying transient failures (429/5xx/timeout)
    with exponential backoff. Honors a Retry-After header on 429 when present.
    Raises RankCheckError only after retries are exhausted."""
    qs = urllib.parse.urlencode({
        "term": term,
        "country": country,
        "entity": "software",
        "limit": max(1, min(limit, MAX_LIMIT)),
    })
    req = urllib.request.Request(f"{SEARCH_URL}?{qs}",
                                 headers={"User-Agent": USER_AGENT})
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            # Apple's JSON has raw newlines inside description strings → strict=False.
            return json.loads(raw, strict=False)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in RETRY_STATUS and attempt < MAX_RETRIES:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                wait = (float(retry_after) if retry_after and retry_after.isdigit()
                        else BACKOFF_BASE * (2 ** attempt))
                _sleep(wait)
                continue
            raise RankCheckError(f"fetch failed for {term!r}: HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            if attempt < MAX_RETRIES:
                _sleep(BACKOFF_BASE * (2 ** attempt))
                continue
            raise RankCheckError(f"fetch failed for {term!r}: {e}") from e
    # unreachable, but keep the type checker happy
    raise RankCheckError(f"fetch failed for {term!r}: {last_err}")


def rank_for(bundle_id: str, keyword: str, *, country: str = "US",
             limit: int = MAX_LIMIT) -> Rank:
    capped = max(1, min(limit, MAX_LIMIT))
    data = _fetch(keyword, country, capped)
    results = data.get("results", []) or []
    total = data.get("resultCount", len(results))
    for idx, app in enumerate(results, start=1):
        if app.get("bundleId") == bundle_id:
            return Rank(keyword=keyword, rank=idx,
                        found_name=app.get("trackName", ""),
                        total_results=total, limit=capped)
    return Rank(keyword=keyword, rank=None, found_name="",
                total_results=total, limit=capped)


def ranks_for(bundle_id: str, keywords: list[str], *, country: str = "US",
              limit: int = MAX_LIMIT, pause: float = 0.3) -> list[Rank]:
    """Rank each keyword. One keyword's failure does NOT abort the batch — it
    comes back as a Rank with .error set, so a single 429 can't lose a whole run."""
    capped = max(1, min(limit, MAX_LIMIT))
    out: list[Rank] = []
    for i, kw in enumerate(keywords):
        try:
            out.append(rank_for(bundle_id, kw, country=country, limit=capped))
        except RankCheckError as e:
            out.append(Rank(keyword=kw, rank=None, found_name="",
                            total_results=0, limit=capped, error=str(e)))
        if i + 1 < len(keywords):
            _sleep(pause)  # be polite to the public endpoint
    return out


def _keywords_from(arg: str | None) -> list[str]:
    raw = sys.stdin.read() if arg in (None, "-") else arg
    parts = [p.strip() for chunk in raw.splitlines() for p in chunk.split(",")]
    return [p for p in parts if p]


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="App Store organic keyword rank (no paid API)")
    ap.add_argument("keywords", nargs="?",
                    help="comma/newline-separated keywords, or '-' for stdin")
    ap.add_argument("--bundle", required=True, help="the app's bundle id (e.g. com.airowe.heathen)")
    ap.add_argument("--country", default="US", help="App Store country (default US)")
    ap.add_argument("--limit", type=int, default=MAX_LIMIT,
                    help=f"how deep to scan, 1..{MAX_LIMIT} (default {MAX_LIMIT})")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    keywords = _keywords_from(args.keywords)
    if not keywords:
        print("no keywords given", file=sys.stderr)
        return 1

    try:
        results = ranks_for(args.bundle, keywords, country=args.country,
                            limit=args.limit)
    except RankCheckError as e:
        print(f"rank check error: {e}", file=sys.stderr)
        return 3

    if args.json:
        print(json.dumps([r.to_dict() for r in results], indent=2))
        return 0

    print(f"{'keyword':32} {'rank':>6}  {'of':>5}  note")
    print("-" * 64)
    for r in results:
        rank = f"#{r.rank}" if r.rank else "—"
        if r.error:
            note = f"⚠ {r.error[:30]}"
        elif r.rank is None:
            note = "not in top %d" % r.limit
        else:
            note = r.found_name[:24]
        print(f"{r.keyword[:32]:32} {rank:>6}  {r.total_results:>5}  {note}")
    # exit 4 if every keyword errored (total failure); 0 otherwise (partial ok)
    return 4 if results and all(r.error for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
