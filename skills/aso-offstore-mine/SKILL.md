---
name: aso-offstore-mine
description: Mine OFF-STORE sources — "best <category> apps" review articles and YouTube videos — for the discovery language people use when they talk about your category, plus the competitors they compare you to. The off-store sibling of aso-review-mine: where review-mine reads your own App Store reviews, this reads the outside conversation. Sources via Jina Reader (web) and yt-dlp (YouTube captions). Feeds aso-keyword-research and aso-competitor-watch. No paid API.
---

# aso-offstore-mine

**aso-review-mine** reads the words *your* users use, inside the store. This
reads the words *everyone else* uses, outside it — the "best meditation apps"
listicles, comparison articles, and review videos where people describe the
category in discovery language ("free", "sleep timer", "guided meditation") and
name the apps they're choosing between.

That off-store vocabulary is exactly what a searcher types before they've found
you. It's a different, complementary signal to your own reviews — and it
surfaces **competitor names** that articles compare you to, feeding
aso-competitor-watch.

## Sources (free, no paid data API)

- **web** — any article/listicle, fetched as clean markdown via **Jina Reader**
  (`https://r.jina.ai/<url>`). No API key. URL/markdown cruft is stripped so it
  doesn't pollute the keyword counts.
- **youtube** — auto-captions via **yt-dlp** (review / "top N apps" videos). VTT
  timestamps + tags are stripped to plain text.
- **text** — pre-gathered text via `--text-file`. This is the hook for
  Reddit/X/etc.: those need cookie auth or a proxy, so gather them with a tool
  like [Agent-Reach](https://github.com/Panniantong/Agent-Reach) and pipe the
  text in — the mining is the same.

## Usage

```bash
# fetch a review article + a YouTube comparison, count competitor mentions:
python3 lib/aso_offstore_mine.py --app clarity \
    --url "https://www.example.com/best-meditation-apps" \
    --youtube "https://youtube.com/watch?v=XXXX" \
    --competitors "Calm,Headspace,Insight Timer" --json

# mine text you already gathered (e.g. Reddit threads via Agent-Reach), no network:
python3 lib/aso_offstore_mine.py --app clarity --text-file reddit-notes.txt
```

Multiple `--url` / `--youtube` / `--text-file` flags are allowed; a source that
fails to fetch is warned and skipped, not fatal.

## What it extracts

- **Keyword candidates** — unigrams + bigrams that recur across sources (a term
  must appear >1 time), ranked by frequency. The discovery language to consider
  for title / subtitle / keyword field.
- **Phrases** — the bigrams people actually type ("guided meditation", "sleep
  timer").
- **Competitor mentions** — of the names you pass in `--competitors`, which ones
  the off-store sources actually mention, and how often → hand to
  **aso-competitor-watch**.

Writes `marketing/aso/<app>/offstore-keywords.md`; chains into
**aso-keyword-research** (treat recurring discovery terms as seeds) and
**aso-competitor-watch** (the surfaced competitor names).

## Honest limits

- **Source quality is everything.** A "best <category> apps 2025" *review*
  article yields discovery keywords + competitors; a piece of *content* (e.g. a
  guided-meditation video) yields content words, not search terms. Pick
  review/comparison sources.
- **Reddit / X / Instagram are not fetched here** — they need cookie auth or a
  proxy. Gather them separately (Agent-Reach) and pass via `--text-file`.
- Frequency mining is a starting signal, not semantic ranking — pair it with
  aso-keyword-research's scoring (volume / difficulty / relevance).
- Jina Reader and YouTube can rate-limit or block a given URL; the skill warns
  and continues with whatever it did fetch.

## Dependencies

Standard-library Python + **Jina Reader** (a public URL, no key) and **yt-dlp**
(`brew install yt-dlp` / `pip install yt-dlp`) for the YouTube path. No paid
data/scraping SaaS. The mining core is pure and unit-tested with no network.
