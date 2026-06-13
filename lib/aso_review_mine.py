#!/usr/bin/env python3
"""
Mine your app's App Store reviews for the language real users use — keyword
candidates + recurring themes the listing should speak to.

Data source: the authenticated App Store Connect API via the `asc reviews` CLI
(`asc reviews --app <id> --json`). This is the reliable path — Apple's public
customer-reviews RSS feed is effectively dead (returns empty for all apps now),
so we use the owned, authenticated source instead. Scoped to YOUR apps (you can't
read competitors' review bodies — nobody can, via any API).

What it extracts:
  • keyword candidates — meaningful words/bigrams users actually type, ranked by
    frequency, weighted toward positive reviews (the words happy users use to
    describe the app are the words to rank for).
  • pain themes — frequent terms in low-star reviews (what to fix / address in
    copy).

Feeds aso-keyword-research with ground-truth user language.

Usage (reviews JSON piped in, or read from asc):
    asc reviews --app 6759360137 --paginate --json | \
        python3 aso_review_mine.py --app heathen --stdin
    python3 aso_review_mine.py --app heathen --reviews-file reviews.json --json

Exit codes: 0 ok · 1 bad args · 2 no reviews.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path

# words that carry no ASO signal
_STOP = set("""
the a an and or but for nor so yet of to in on at by with from as is are was were
be been being it its this that these those i you he she they we me my your our their
have has had do does did will would can could should may might must not no yes if
then than too very just really also app apps use used using get got really love
""".split())


@dataclass
class MineResult:
    app: str
    n_reviews: int
    avg_rating: float
    keyword_candidates: list[tuple[str, int]]   # (term, count)
    pain_themes: list[tuple[str, int]]
    positive_terms: list[tuple[str, int]]

    def to_dict(self) -> dict:
        d = asdict(self)
        # tuples → lists for clean JSON
        for k in ("keyword_candidates", "pain_themes", "positive_terms"):
            d[k] = [list(t) for t in d[k]]
        return d


def _reviews_from_asc(payload: dict) -> list[dict]:
    """Normalize `asc reviews` JSON to [{rating, title, body}]."""
    out = []
    for r in payload.get("data", []) or []:
        a = r.get("attributes", {}) if isinstance(r, dict) else {}
        out.append({
            "rating": int(a.get("rating", 0) or 0),
            "title": a.get("title", "") or "",
            "body": a.get("body", "") or "",
        })
    return out


def _tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z][a-z'\-]{2,}", text.lower())
    return [w for w in words if w not in _STOP and len(w) >= 3]


def _bigrams(tokens: list[str]) -> list[str]:
    return [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]


def mine(reviews: list[dict], *, app: str, top: int = 20) -> MineResult:
    pos_counter: Counter = Counter()
    neg_counter: Counter = Counter()
    all_counter: Counter = Counter()
    ratings = []
    for r in reviews:
        rating = r.get("rating", 0)
        ratings.append(rating)
        text = f"{r.get('title','')} {r.get('body','')}"
        toks = _tokens(text)
        grams = toks + _bigrams(toks)
        all_counter.update(grams)
        if rating >= 4:
            pos_counter.update(grams)
        elif rating and rating <= 2:
            neg_counter.update(grams)
    avg = round(sum(ratings) / len(ratings), 2) if ratings else 0.0
    # keyword candidates: overall frequency, but require it to appear >1 time
    kw = [(t, c) for t, c in all_counter.most_common(top * 2) if c > 1][:top]
    pain = [(t, c) for t, c in neg_counter.most_common(top) if c > 1][:top]
    pos = [(t, c) for t, c in pos_counter.most_common(top) if c > 1][:top]
    return MineResult(app=app, n_reviews=len(reviews), avg_rating=avg,
                      keyword_candidates=kw, pain_themes=pain, positive_terms=pos)


def render_md(res: MineResult) -> str:
    def _rows(pairs):
        return "\n".join(f"| {t} | {c} |" for t, c in pairs) or "| _(none)_ | |"
    return f"""# {res.app} — review keyword mining

{res.n_reviews} reviews · avg {res.avg_rating}★. Source: App Store Connect
(`asc reviews`). The words real users use — feed these into aso-keyword-research.

## Keyword candidates (user language, by frequency)

| term | count |
|------|-------|
{_rows(res.keyword_candidates)}

## What positive reviewers say (4–5★) — lean into these

| term | count |
|------|-------|
{_rows(res.positive_terms)}

## Pain themes (1–2★) — address in copy / fix

| term | count |
|------|-------|
{_rows(res.pain_themes)}
"""


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Mine App Store reviews for keywords")
    ap.add_argument("--app", required=True, help="app slug (for the output file)")
    ap.add_argument("--stdin", action="store_true", help="read asc reviews JSON from stdin")
    ap.add_argument("--reviews-file", help="path to asc reviews JSON")
    ap.add_argument("--root", default=".")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.stdin:
        raw = sys.stdin.read()
    elif args.reviews_file:
        raw = Path(args.reviews_file).read_text()
    else:
        print("provide --stdin (pipe `asc reviews ... --json`) or --reviews-file",
              file=sys.stderr)
        return 1
    try:
        payload = json.loads(raw, strict=False)
    except json.JSONDecodeError as e:
        print(f"could not parse reviews JSON: {e}", file=sys.stderr)
        return 1

    reviews = _reviews_from_asc(payload)
    if not reviews:
        print(f"no reviews for {args.app} (asc returned 0) — nothing to mine",
              file=sys.stderr)
        return 2

    res = mine(reviews, app=args.app, top=args.top)
    if args.json:
        print(json.dumps(res.to_dict(), indent=2))
        return 0
    path = Path(args.root).resolve() / "marketing" / "aso" / args.app / "review-keywords.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_md(res))
    print(f"{args.app}: mined {res.n_reviews} reviews ({res.avg_rating}★)  →  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
