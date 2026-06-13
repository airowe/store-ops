#!/usr/bin/env python3
"""
Watch competitors' App Store listings for changes over time — no paid API.

When a competitor renames, rewrites their subtitle, or reshuffles keywords, it's
a signal: they found something in the data, or they're chasing a term. This pulls
each competitor's current listing (name, subtitle, description, version, price,
rating) via the free iTunes Lookup API and diffs it against the last snapshot in
`marketing/aso/<app>/competitors.md`, flagging what changed.

The iTunes API does NOT expose a competitor's keyword field (that's private), so
we watch the *visible* fields — which is exactly what users see and where most
ASO moves show up anyway.

Usage:
    python3 aso_competitor_watch.py --app swoop --root . --date 2026-06-11 \
        --ids 1573000000,1499000000          # competitor App Store track ids
    python3 aso_competitor_watch.py --app swoop --root . --date 2026-06-11 \
        --bundles com.bumble.app,com.hinge.app
    # ids/bundles default to the previous snapshot's set if omitted
    python3 aso_competitor_watch.py --app swoop --root . --json   # digest only

Exit codes: 0 ok · 1 bad args · 4 all lookups failed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path

LOOKUP_URL = "https://itunes.apple.com/lookup"
USER_AGENT = "Mozilla/5.0 (Macintosh; aso-competitor-watch)"
MAX_RETRIES = 3
BACKOFF_BASE = 1.5
RETRY_STATUS = {429, 500, 502, 503, 504}
# the visible listing fields we track for change
WATCH_FIELDS = ("name", "subtitle", "version", "price", "rating", "genres")


class CompetitorWatchError(Exception):
    pass


@dataclass
class Listing:
    key: str                # the id or bundle we looked up by
    name: str = ""
    subtitle: str = ""      # iTunes rarely returns subtitle; kept for completeness
    version: str = ""
    price: str = ""
    rating: str = ""
    genres: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def watched(self) -> dict:
        return {f: getattr(self, f) for f in WATCH_FIELDS}


def _sleep(s: float) -> None:
    time.sleep(s)


def _fetch(params: dict) -> dict:
    qs = urllib.parse.urlencode({**params, "country": params.get("country", "US")})
    req = urllib.request.Request(f"{LOOKUP_URL}?{qs}",
                                 headers={"User-Agent": USER_AGENT})
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"),
                                  strict=False)
        except urllib.error.HTTPError as e:
            if e.code in RETRY_STATUS and attempt < MAX_RETRIES:
                _sleep(BACKOFF_BASE * (2 ** attempt)); continue
            raise CompetitorWatchError(f"HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < MAX_RETRIES:
                _sleep(BACKOFF_BASE * (2 ** attempt)); continue
            raise CompetitorWatchError(str(e)) from e
    raise CompetitorWatchError("retries exhausted")


def _result_to_listing(key: str, r: dict) -> Listing:
    price = r.get("formattedPrice") or (f"${r.get('price')}" if r.get("price") else "Free")
    rating = ""
    if r.get("averageUserRating") is not None:
        rating = f"{round(float(r['averageUserRating']), 1)} ({r.get('userRatingCount', 0)})"
    return Listing(
        key=key,
        name=r.get("trackName", ""),
        version=r.get("version", ""),
        price=price,
        rating=rating,
        genres=", ".join(r.get("genres", []) or []),
    )


def lookup(key: str, *, by: str = "id", country: str = "US") -> Listing:
    """Look up one competitor by App Store id or bundleId."""
    params = {"country": country}
    params["id" if by == "id" else "bundleId"] = key
    try:
        data = _fetch(params)
    except CompetitorWatchError as e:
        return Listing(key=key, error=str(e))
    results = data.get("results") or []
    if not results:
        return Listing(key=key, error="not found")
    return _result_to_listing(key, results[0])


def resolve_name_to_id(name: str, *, country: str = "US") -> str | None:
    """Resolve a competitor app NAME to its App Store track id via iTunes search
    (returns the top software result's id, or None). Lets a context.md list
    competitors by name instead of forcing the user to find ids."""
    search_url = "https://itunes.apple.com/search"
    qs = urllib.parse.urlencode({"term": name, "country": country,
                                 "entity": "software", "limit": 1})
    req = urllib.request.Request(f"{search_url}?{qs}",
                                 headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"),
                              strict=False)
    except Exception:  # noqa: BLE001
        return None
    results = data.get("results") or []
    tid = results[0].get("trackId") if results else None
    return str(tid) if tid else None


def lookup_all(keys: list[str], *, by: str = "id", country: str = "US",
               pause: float = 0.3) -> list[Listing]:
    out = []
    for i, k in enumerate(keys):
        out.append(lookup(k, by=by, country=country))
        if i + 1 < len(keys):
            _sleep(pause)
    return out


# ── snapshot parsing / diffing ───────────────────────────────────────────────
_HEADER = re.compile(r"^##\s+\d{4}-\d{2}-\d{2}", re.M)
# each competitor line: "- `<key>` · name: ... · version: ... · ..."
_LINE = re.compile(r"^- `([^`]+)`\s*·\s*(.*)$", re.M)
_FIELD = re.compile(r"(\w+):\s*([^·]*?)(?=\s*·|\s*$)")


def previous_listings(md: str) -> dict[str, dict]:
    """Return {key: {field: value}} from the latest snapshot block."""
    headers = list(_HEADER.finditer(md))
    if not headers:
        return {}
    block = md[headers[-1].start():]
    out: dict[str, dict] = {}
    for m in _LINE.finditer(block):
        key, rest = m.group(1), m.group(2)
        fields = {fm.group(1): fm.group(2).strip() for fm in _FIELD.finditer(rest)}
        out[key] = fields
    return out


def diff(current: list[Listing], prev: dict[str, dict]) -> list[dict]:
    """Per competitor, list which watched fields changed since last snapshot."""
    changes = []
    for c in current:
        if c.error:
            changes.append({"key": c.key, "status": "error", "detail": c.error})
            continue
        pv = prev.get(c.key)
        cur = c.watched()
        if pv is None:
            changes.append({"key": c.key, "status": "new", "name": c.name})
            continue
        diffs = {f: {"from": pv.get(f, ""), "to": cur[f]}
                 for f in WATCH_FIELDS
                 if str(pv.get(f, "")) != str(cur[f]) and cur[f] != ""}
        if diffs:
            changes.append({"key": c.key, "status": "changed",
                            "name": c.name, "fields": diffs})
        else:
            changes.append({"key": c.key, "status": "same", "name": c.name})
    return changes


# ── rendering ────────────────────────────────────────────────────────────────
def render_snapshot(date: str, country: str, current: list[Listing]) -> str:
    lines = [f"## {date} · {country}", ""]
    for c in current:
        if c.error:
            lines.append(f"- `{c.key}` · error: {c.error}")
            continue
        lines.append(f"- `{c.key}` · name: {c.name} · version: {c.version} · "
                     f"price: {c.price} · rating: {c.rating} · genres: {c.genres}")
    lines.append("")
    return "\n".join(lines)


def digest_line(changes: list[dict]) -> str:
    chg = sum(1 for c in changes if c["status"] == "changed")
    new = sum(1 for c in changes if c["status"] == "new")
    err = sum(1 for c in changes if c["status"] == "error")
    parts = []
    if chg: parts.append(f"{chg} changed")
    if new: parts.append(f"{new} new")
    if err: parts.append(f"{err} err")
    return ", ".join(parts) if parts else "no changes"


def md_path(root: Path, app: str) -> Path:
    return root / "marketing" / "aso" / app / "competitors.md"


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Watch competitor App Store listings")
    ap.add_argument("--app", required=True)
    ap.add_argument("--ids", help="comma-separated App Store track ids")
    ap.add_argument("--bundles", help="comma-separated bundle ids")
    ap.add_argument("--country", default="US")
    ap.add_argument("--root", default=".")
    ap.add_argument("--date", required=True, help="snapshot date YYYY-MM-DD")
    ap.add_argument("--json", action="store_true")
    return ap.parse_args(argv)


def _split(s: str | None) -> list[str]:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def main(argv=None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    path = md_path(root, args.app)
    existing = path.read_text() if path.exists() else ""
    prev = previous_listings(existing)

    ids, bundles = _split(args.ids), _split(args.bundles)
    if not ids and not bundles:
        # reuse prior set: keys that look numeric = ids, else bundles
        keys = list(prev.keys())
        ids = [k for k in keys if k.isdigit()]
        bundles = [k for k in keys if not k.isdigit()]
    if not ids and not bundles:
        print("no competitors (none given and no prior competitors.md)", file=sys.stderr)
        return 1

    current = lookup_all(ids, by="id", country=args.country) + \
        lookup_all(bundles, by="bundleId", country=args.country)
    if all(c.error for c in current):
        print("all competitor lookups failed — nothing logged", file=sys.stderr)
        return 4

    changes = diff(current, prev)

    if args.json:
        print(json.dumps({"app": args.app, "date": args.date,
                          "digest": digest_line(changes), "changes": changes}, indent=2))
        return 0

    snapshot = render_snapshot(args.date, args.country, current)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not existing:
        existing = (f"# {args.app} — competitor listing watch\n\n"
                    f"Visible App Store listing fields per competitor, dated. "
                    f"Generated by aso-competitor-watch (free iTunes Lookup API). "
                    f"Diffs are vs. the previous block.\n\n")
    elif not existing.endswith("\n"):
        existing += "\n"
    path.write_text(existing + snapshot + "\n")
    print(f"{args.app} {args.date}: {digest_line(changes)}  →  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
