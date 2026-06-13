#!/usr/bin/env python3
"""
Scheduled rank tracking — turn aso_rank_check's one-shot reads into a time series.

This is the watch loop the paid trackers (Astro/AppTweak) charge a subscription
for. It runs aso_rank_check for an app's keywords, appends a dated snapshot to
`marketing/aso/<app>/ranks.md`, and computes the delta vs. the previous snapshot
(↑ improved, ↓ dropped, `new`, `lost`, `—` unchanged) — so a glance tells you
what the last metadata change actually did.

Designed to be run on a schedule (weekly cron). Stateless across runs except for
the ranks.md log it reads back to compute deltas — git is the history.

Usage:
    python3 aso_rank_monitor.py --app heathen --bundle app.airowe.clarity \
        --keywords "agnostic,aurelius,stoic,mindfulness" --root /path/to/repo
    # keywords default to the previous run's keyword set if --keywords omitted
    python3 aso_rank_monitor.py --app heathen --bundle app.airowe.clarity \
        --root . --json     # emit the digest as JSON instead of writing ranks.md

Exit codes: 0 ok · 1 bad args · 4 all keywords failed (nothing logged).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aso_rank_check import ranks_for, Rank  # noqa: E402


@dataclass
class Delta:
    keyword: str
    rank: int | None        # this run
    prev: int | None        # previous run (None if first-seen or was absent)
    symbol: str             # ↑ / ↓ / — / new / lost / err
    competitors: int

    def to_dict(self) -> dict:
        return {"keyword": self.keyword, "rank": self.rank, "prev": self.prev,
                "delta": self.symbol, "competitors": self.competitors}


# ── ranks.md parsing (read back the previous snapshot's table) ───────────────
# A snapshot block looks like:
#   ## 2026-06-11 · US · App Store
#   | keyword | rank | Δ vs prev | competitors |
#   |---------|------|-----------|-------------|
#   | agnostic | #45 | ... | 52 |
_ROW = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(#?\d+|—|-)\s*\|", re.M)
_HEADER = re.compile(r"^##\s+\d{4}-\d{2}-\d{2}", re.M)


def _parse_rank_cell(cell: str) -> int | None:
    cell = cell.strip().lstrip("#")
    return int(cell) if cell.isdigit() else None


def previous_ranks(ranks_md: str) -> dict[str, int | None]:
    """Return {keyword: rank} from the most recent snapshot block in ranks.md.
    Empty dict if there is no prior snapshot."""
    headers = list(_HEADER.finditer(ranks_md))
    if not headers:
        return {}
    # the latest block is from the last header to EOF
    block = ranks_md[headers[-1].start():]
    out: dict[str, int | None] = {}
    for m in _ROW.finditer(block):
        kw = m.group(1).strip()
        if kw.lower() in ("keyword",) or set(kw) <= {"-", " "}:
            continue  # skip header / separator rows
        out[kw] = _parse_rank_cell(m.group(2))
    return out


def compute_deltas(current: list[Rank], prev: dict[str, int | None]) -> list[Delta]:
    deltas = []
    for r in current:
        if r.error:
            deltas.append(Delta(r.keyword, None, prev.get(r.keyword), "err",
                                r.total_results))
            continue
        had_prev = r.keyword in prev
        pv = prev.get(r.keyword)
        if not had_prev:
            sym = "new" if r.rank is not None else "—"
        elif pv is None and r.rank is not None:
            sym = "new"          # was absent, now ranks
        elif pv is not None and r.rank is None:
            sym = "lost"         # was ranking, now gone
        elif pv is None and r.rank is None:
            sym = "—"
        elif r.rank < pv:        # type: ignore[operator]
            sym = f"↑ +{pv - r.rank}"   # lower number = better
        elif r.rank > pv:        # type: ignore[operator]
            sym = f"↓ -{r.rank - pv}"
        else:
            sym = "—"
        deltas.append(Delta(r.keyword, r.rank, pv, sym, r.total_results))
    return deltas


# ── ranks.md writing ─────────────────────────────────────────────────────────
def render_snapshot(date: str, country: str, deltas: list[Delta]) -> str:
    lines = [f"## {date} · {country} · App Store", "",
             "| keyword | rank | Δ vs prev | competitors |",
             "|---------|------|-----------|-------------|"]
    for d in deltas:
        rank = f"#{d.rank}" if d.rank else "—"
        lines.append(f"| {d.keyword} | {rank} | {d.symbol} | {d.competitors} |")
    lines.append("")
    return "\n".join(lines)


def ranks_md_path(root: Path, app: str) -> Path:
    return root / "marketing" / "aso" / app / "ranks.md"


def digest_line(deltas: list[Delta]) -> str:
    """A one-line human summary: how many moved up/down/new/lost."""
    up = sum(1 for d in deltas if d.symbol.startswith("↑"))
    down = sum(1 for d in deltas if d.symbol.startswith("↓"))
    new = sum(1 for d in deltas if d.symbol == "new")
    lost = sum(1 for d in deltas if d.symbol == "lost")
    err = sum(1 for d in deltas if d.symbol == "err")
    parts = []
    if up: parts.append(f"↑{up}")
    if down: parts.append(f"↓{down}")
    if new: parts.append(f"new {new}")
    if lost: parts.append(f"lost {lost}")
    if err: parts.append(f"err {err}")
    return ", ".join(parts) if parts else "no change"


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Scheduled App Store rank monitor")
    ap.add_argument("--app", required=True, help="app slug (names the ranks.md dir)")
    ap.add_argument("--bundle", required=True, help="bundle id")
    ap.add_argument("--keywords", help="comma/newline keywords; default = last run's set")
    ap.add_argument("--country", default="US")
    ap.add_argument("--root", default=".", help="repo root (default cwd)")
    ap.add_argument("--date", required=True,
                    help="snapshot date YYYY-MM-DD (passed in; no clock in lib)")
    ap.add_argument("--json", action="store_true",
                    help="print the digest as JSON, do NOT write ranks.md")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    path = ranks_md_path(root, args.app)
    existing = path.read_text() if path.exists() else ""
    prev = previous_ranks(existing)

    if args.keywords:
        kws = [p.strip() for chunk in args.keywords.splitlines()
               for p in chunk.split(",") if p.strip()]
    else:
        kws = list(prev.keys())
    if not kws:
        print("no keywords (none given and no prior ranks.md to reuse)", file=sys.stderr)
        return 1

    current = ranks_for(args.bundle, kws, country=args.country)
    if all(r.error for r in current):
        print("all keyword fetches failed — nothing logged", file=sys.stderr)
        return 4

    deltas = compute_deltas(current, prev)

    if args.json:
        print(json.dumps({"app": args.app, "date": args.date,
                          "digest": digest_line(deltas),
                          "deltas": [d.to_dict() for d in deltas]}, indent=2))
        return 0

    snapshot = render_snapshot(args.date, args.country, deltas)
    path.parent.mkdir(parents=True, exist_ok=True)
    if existing and not existing.endswith("\n"):
        existing += "\n"
    if not existing:
        existing = (f"# {args.app} — App Store organic rank log\n\n"
                    f"Bundle: {args.bundle}. Generated by aso-rank-monitor "
                    f"(free iTunes Search API). Each block is one dated snapshot; "
                    f"deltas are vs. the previous block.\n\n")
    path.write_text(existing + snapshot + "\n")
    print(f"{args.app} {args.date}: {digest_line(deltas)}  →  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
