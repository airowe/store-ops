#!/usr/bin/env python3
"""
Scaffold a canonical `aso-copy.md` stub for an app, pre-filled with its CURRENT
live App Store metadata as the baseline. The "Proposed" rows are left for
aso-metadata-optimization to fill — this just standardizes the structure and
grounds it on what's actually live, so no app starts from a blank page.

One canonical shape (matches the hand-authored weatherthere/clearcost files):
  App name · Subtitle · Promotional text · Keywords · Description · What's New,
  each with the char limit, a Current value, and a Proposed slot.

Usage:
    python3 aso_copy_stub.py --app heathen --bundle app.airowe.clarity --root .
    python3 aso_copy_stub.py --app mangia --bundle com.airowe.mangia --stdout

Exit codes: 0 ok · 1 file exists (use --force) · 2 no live listing (bare stub).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LOOKUP_URL = "https://itunes.apple.com/lookup"
USER_AGENT = "Mozilla/5.0 (Macintosh; aso-copy-stub)"

# App Store field char limits
LIMITS = {"name": 30, "subtitle": 30, "promotional_text": 170,
          "keywords": 100, "description": 4000}


def fetch_listing(bundle_id: str, country: str = "US") -> dict | None:
    qs = urllib.parse.urlencode({"bundleId": bundle_id, "country": country})
    req = urllib.request.Request(f"{LOOKUP_URL}?{qs}",
                                 headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"),
                              strict=False)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    results = data.get("results") or []
    return results[0] if results else None


def _section(title: str, limit: int | None, current: str, note: str = "") -> str:
    lim = f" ({limit} char limit)" if limit else ""
    cur = current if current else "_(not set)_"
    cur_len = f" ({len(current)} chars)" if current else ""
    body = [f"## {title}{lim}", "",
            f"**Current:** `{cur}`{cur_len}" if current else f"**Current:** {cur}",
            "", "**Proposed:**", "```", "TODO — run aso-metadata-optimization", "```"]
    if note:
        body.append(f"\n*{note}*")
    body.append("\n---\n")
    return "\n".join(body)


def build_stub(app: str, bundle: str, listing: dict | None) -> str:
    name = (listing or {}).get("trackName", "")
    genres = ", ".join((listing or {}).get("genres", []) or [])
    version = (listing or {}).get("version", "")
    desc = (listing or {}).get("description", "")
    live = bool(listing)

    head = [f"# {name or app} — App Store Optimization Copy", ""]
    if live:
        head.append(f"Canonical ASO-copy stub. Live baseline pulled from the App "
                    f"Store ({genres}, v{version}). Fill the **Proposed** slots "
                    f"via `aso-metadata-optimization` (reads "
                    f"`marketing/aso/{app}/context.md` + keyword research).")
    else:
        head.append(f"Canonical ASO-copy stub. No public App Store listing found "
                    f"for `{bundle}` yet — fill in once it's live or from the "
                    f"app's fastlane metadata.")
    head += ["", f"- **app:** `{app}`  ·  **bundle:** `{bundle}`",
             "", "---", ""]

    # iTunes Lookup exposes name + description; subtitle/keywords/promo are not
    # public, so those Current slots are blank (to be filled from ASC/fastlane).
    sections = [
        _section("App name", LIMITS["name"], name),
        _section("Subtitle", LIMITS["subtitle"], "",
                 "Not exposed by the public API — paste from App Store Connect."),
        _section("Promotional text", LIMITS["promotional_text"], "",
                 "Editable any time without resubmitting; appears above description."),
        _section("Keywords field", LIMITS["keywords"], "",
                 "Private (not in the public API) — paste from ASC. "
                 "Comma-separated, no spaces, no title/subtitle dupes."),
        _section("Description", LIMITS["description"],
                 (desc[:300] + " …") if len(desc) > 300 else desc,
                 "Current shown truncated; full text lives in the live listing."),
        _section("What's New", None, "",
                 "Per-version release notes."),
    ]
    return "\n".join(head) + "\n".join(sections)


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Scaffold a canonical aso-copy.md stub")
    ap.add_argument("--app", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--country", default="US")
    ap.add_argument("--root", default=".")
    ap.add_argument("--stdout", action="store_true")
    ap.add_argument("--force", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    listing = fetch_listing(args.bundle, args.country)
    content = build_stub(args.app, args.bundle, listing)
    if args.stdout:
        print(content)
        return 0
    path = Path(args.root).resolve() / "marketing" / "aso" / args.app / "aso-copy.md"
    if path.exists() and not args.force:
        print(f"{path} exists — use --force to overwrite", file=sys.stderr)
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    print(f"wrote {path}")
    return 0 if listing else 2


if __name__ == "__main__":
    raise SystemExit(main())
