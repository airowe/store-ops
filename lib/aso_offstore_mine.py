#!/usr/bin/env python3
"""
Mine OFF-STORE sources for the language real users use to talk about your app's
category — keyword candidates + competitor mentions to feed aso-keyword-research.

The on-store sibling, aso-review-mine, reads YOUR App Store reviews. This reads
the *outside* conversation: "best <category> apps" review articles and YouTube
videos, where people use discovery language ("free", "sleep timer", "guided
meditation") and name the competitors they compare you to.

Sources (free, no paid data API — same posture as the rest of store-ops):
  • web      — any article/listicle, via Jina Reader (https://r.jina.ai/<url>),
               which renders + cleans a page to markdown with no API key.
  • youtube  — auto-captions via yt-dlp (review/comparison videos).

Reddit/X/etc. need cookie auth or a proxy — out of scope here; point users at
Agent-Reach (github.com/Panniantong/Agent-Reach) to add those once configured,
then pipe the text in via --text-file.

DESIGN: fetching (network/subprocess) is separated from mining (pure text →
keywords), so the whole scoring core unit-tests with no network. The CLI wires
the fetchers; mine_sources() is pure.

Usage:
    # fetch + mine in one shot (network):
    python3 aso_offstore_mine.py --app clarity \\
        --url "https://www.example.com/best-meditation-apps" \\
        --youtube "https://youtube.com/watch?v=XXXX" \\
        --competitors Calm,Headspace,Hallow --json

    # or mine text you already gathered (e.g. via Agent-Reach), no network:
    python3 aso_offstore_mine.py --app clarity --text-file notes.txt

Exit codes: 0 ok · 1 bad args · 2 no usable source text.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from collections import Counter
from dataclasses import dataclass, asdict, field
from pathlib import Path

JINA_BASE = "https://r.jina.ai/"

# words that carry no ASO signal (superset of review-mine's, plus article cruft)
_STOP = set("""
the a an and or but nor for so yet of to in on at by with from as is are was were
be been being it its this that these those i you he she they we me my your our their
have has had do does did will would can could should may might must not no yes if
then than too very just really also app apps use used using get got love best review
reviews video channel subscribe watch like new top some all one two more most about
into out up down over under here there what when where how why who which you're we're
they're it's that's per com www http https link android ios merchant offers such year
""".split())


@dataclass
class Source:
    """A fetched off-store text blob, tagged by where it came from."""
    kind: str   # "web" | "youtube" | "text"
    url: str
    text: str


@dataclass
class MineResult:
    app: str
    n_sources: int
    by_kind: dict
    keyword_candidates: list[tuple[str, int]]   # (term, count)
    competitor_mentions: list[tuple[str, int]]  # (name, count)
    bigram_phrases: list[tuple[str, int]]
    sources: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("keyword_candidates", "competitor_mentions", "bigram_phrases"):
            d[k] = [list(t) for t in d[k]]
        return d


# ── source-text normalization ─────────────────────────────────────────────────

def _strip_vtt(vtt: str) -> str:
    """WebVTT captions → plain text (drop timestamps, cue numbers, inline tags)."""
    lines = []
    for ln in vtt.splitlines():
        s = ln.strip()
        if not s or "-->" in s or s.isdigit():
            continue
        if s.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        ln = re.sub(r"<[^>]+>", "", ln)        # <c>, <00:00:04.000>, etc.
        lines.append(ln)
    # collapse the consecutive-duplicate lines auto-captions love to emit
    out: list[str] = []
    for ln in lines:
        if not out or ln.strip() != out[-1].strip():
            out.append(ln)
    return " ".join(out)


def _strip_markdown_noise(md: str) -> str:
    """Drop URLs / link cruft from Jina markdown so they don't pollute tokens."""
    md = re.sub(r"https?://\S+", " ", md)
    md = re.sub(r"\bwww\.\S+", " ", md)
    md = re.sub(r"\b\S+\.(?:com|org|net|io|app|co)\b", " ", md)
    md = re.sub(r"[#*_>`\[\]()|]", " ", md)    # markdown punctuation
    return md


# ── tokenize ───────────────────────────────────────────────────────────────────

def _tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z][a-z'\-]{2,}", text.lower())
    return [w for w in words if w not in _STOP and len(w) >= 3]


def _bigrams(tokens: list[str]) -> list[str]:
    return [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]


# ── mining (pure) ───────────────────────────────────────────────────────────────

def mine_sources(
    sources: list[Source],
    *,
    app: str,
    top: int = 20,
    competitors: list[str] | None = None,
) -> MineResult:
    """Pure: fetched Sources → keyword candidates + competitor mentions."""
    uni: Counter = Counter()
    big: Counter = Counter()
    by_kind: Counter = Counter()
    comp_counter: Counter = Counter()
    comp_lower = {c.lower(): c for c in (competitors or [])}

    for s in sources:
        by_kind[s.kind] += 1
        text = s.text
        if s.kind == "youtube" and "-->" in text:
            text = _strip_vtt(text)
        text = _strip_markdown_noise(text)
        toks = _tokens(text)
        uni.update(toks)
        big.update(_bigrams(toks))
        low = text.lower()
        for cl, original in comp_lower.items():
            n = low.count(cl)
            if n:
                comp_counter[original] += n

    # candidates: unigrams + bigrams that recur (>1), ranked by frequency
    merged = uni + big
    kw = [(t, c) for t, c in merged.most_common(top * 3) if c > 1][:top]
    bigrams = [(t, c) for t, c in big.most_common(top) if c > 1][:top]
    comp = comp_counter.most_common(top)

    return MineResult(
        app=app,
        n_sources=len(sources),
        by_kind=dict(by_kind),
        keyword_candidates=kw,
        competitor_mentions=comp,
        bigram_phrases=bigrams,
        sources=[s.url for s in sources],
    )


def render_md(res: MineResult) -> str:
    def _rows(pairs):
        return "\n".join(f"| {t} | {c} |" for t, c in pairs) or "| _(none)_ | |"
    kinds = ", ".join(f"{k}×{v}" for k, v in sorted(res.by_kind.items())) or "none"
    return f"""# {res.app} — off-store keyword mining

{res.n_sources} off-store source(s) ({kinds}). The discovery language people use
when they talk about this category — feed these into aso-keyword-research
alongside on-store review mining.

## Keyword candidates (discovery language, by frequency)

| term | count |
|------|-------|
{_rows(res.keyword_candidates)}

## Phrases (bigrams users actually type)

| phrase | count |
|--------|-------|
{_rows(res.bigram_phrases)}

## Competitor mentions (who you're compared to off-store)

| competitor | mentions |
|------------|----------|
{_rows(res.competitor_mentions)}
"""


# ── fetchers (network / subprocess — thin, not unit-tested) ─────────────────────

def fetch_jina(url: str, *, timeout: int = 30) -> str:
    """Fetch a page as clean markdown via Jina Reader (no API key)."""
    req = urllib.request.Request(
        JINA_BASE + url,
        headers={"User-Agent": "Mozilla/5.0 (store-ops aso-offstore-mine)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read().decode("utf-8", "replace")


def fetch_youtube_transcript(url: str, *, timeout: int = 60) -> str:
    """Pull auto-captions for a YouTube URL via yt-dlp (returns VTT text)."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        out = str(Path(d) / "sub")
        subprocess.run(
            ["yt-dlp", "--write-auto-sub", "--sub-lang", "en", "--skip-download",
             "--sub-format", "vtt", "-o", out, url],
            check=True, capture_output=True, timeout=timeout,
        )
        vtts = list(Path(d).glob("*.vtt"))
        if not vtts:
            raise RuntimeError("yt-dlp produced no captions (none available?)")
        return vtts[0].read_text(encoding="utf-8", errors="replace")


# ── CLI ─────────────────────────────────────────────────────────────────────────

def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Mine off-store sources for ASO keywords")
    ap.add_argument("--app", required=True, help="app slug (for the output file)")
    ap.add_argument("--url", action="append", default=[], help="web page (via Jina Reader); repeatable")
    ap.add_argument("--youtube", action="append", default=[], help="YouTube URL (transcript); repeatable")
    ap.add_argument("--text-file", action="append", default=[],
                    help="pre-gathered text (e.g. from Agent-Reach); repeatable")
    ap.add_argument("--competitors", default="", help="comma-separated competitor names to count")
    ap.add_argument("--root", default=".")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    competitors = [c.strip() for c in args.competitors.split(",") if c.strip()]
    sources: list[Source] = []

    for u in args.url:
        try:
            sources.append(Source("web", u, fetch_jina(u)))
        except Exception as e:  # noqa: BLE001
            print(f"warn: web fetch failed for {u}: {e}", file=sys.stderr)
    for y in args.youtube:
        try:
            sources.append(Source("youtube", y, fetch_youtube_transcript(y)))
        except Exception as e:  # noqa: BLE001
            print(f"warn: youtube fetch failed for {y}: {e}", file=sys.stderr)
    for f in args.text_file:
        sources.append(Source("text", f, Path(f).read_text(encoding="utf-8", errors="replace")))

    if not sources or all(not s.text.strip() for s in sources):
        print("no usable off-store source text — pass --url / --youtube / --text-file",
              file=sys.stderr)
        return 2

    res = mine_sources(sources, app=args.app, top=args.top, competitors=competitors)
    if args.json:
        print(json.dumps(res.to_dict(), indent=2))
        return 0
    path = Path(args.root).resolve() / "marketing" / "aso" / args.app / "offstore-keywords.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_md(res))
    print(f"{args.app}: mined {res.n_sources} off-store source(s)  →  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
