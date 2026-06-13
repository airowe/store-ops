#!/usr/bin/env python3
"""
Scaffold a per-app `context.md` from real data — the shared input every ASO skill
reads. Pulls the app's LIVE App Store listing (name, category, description) via
the free iTunes Lookup API to pre-fill what it can, optionally enriches the brand
block via context.dev when CONTEXT_DEV_API_KEY is set, and writes the file in the
canonical template shape. Fields it can't infer are left as TODO placeholders for
a human (or the keyword-research skill) to complete.

Usage:
    python3 aso_context_gen.py --app heathen --bundle app.airowe.clarity --root .
    python3 aso_context_gen.py --app swoop --bundle com.chat.swoop --root . \
        --brand-domain swoop.example   # enrich brand block via context.dev
    python3 aso_context_gen.py --app heathen --bundle app.airowe.clarity --stdout

Exit codes: 0 ok · 1 bad args · 2 listing not found.
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
USER_AGENT = "Mozilla/5.0 (Macintosh; aso-context-gen)"

# common English stop-ish words we don't want as seeds
_STOP = {
    "the", "and", "for", "with", "your", "you", "our", "are", "that", "this",
    "from", "all", "can", "get", "app", "apps", "free", "now", "just", "out",
    "what", "when", "who", "how", "any", "has", "have", "into", "its", "his",
    "her", "their", "they", "them", "was", "but", "not", "use", "one", "two",
    "more", "most", "than", "then", "also", "will", "make", "made", "every",
}


def _fetch_listing(bundle_id: str, country: str = "US") -> dict | None:
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


def derive_seeds(name: str, description: str, genres: list[str], n: int = 6) -> list[str]:
    """Cheap seed extraction: most frequent meaningful words in name+description,
    plus genre words. Not authoritative — a starting point the human refines."""
    text = f"{name} {description}".lower()
    words = [w.strip(".,!?:;\"'()[]") for w in text.split()]
    freq: dict[str, int] = {}
    for w in words:
        if len(w) < 4 or w in _STOP or not w.isalpha():
            continue
        freq[w] = freq.get(w, 0) + 1
    ranked = sorted(freq, key=lambda w: (-freq[w], w))
    genre_words = [g.lower() for g in genres if g.lower() not in _STOP]
    seeds: list[str] = []
    for w in genre_words + ranked:
        if w not in seeds:
            seeds.append(w)
        if len(seeds) >= n:
            break
    return seeds


def _yaml_list(items: list[str], indent: str = "  ") -> str:
    if not items:
        return f"{indent}- \"TODO\""
    return "\n".join(f'{indent}- "{i}"' for i in items)


def build_context(app: str, bundle: str, listing: dict | None,
                  brand: dict | None = None) -> str:
    name = ((listing or {}).get("trackName", "") or "").replace('"', "'")
    genres = (listing or {}).get("genres", []) or []
    category = genres[0] if genres else "TODO"
    subcategory = genres[1] if len(genres) > 1 else ""
    desc = (listing or {}).get("description", "")
    one_liner = desc.split("\n")[0].strip()[:120] if desc else "TODO"
    # escape double-quotes so the YAML string stays valid
    one_liner = one_liner.replace('"', "'")
    seeds = derive_seeds(name, desc, genres) if listing else []
    brand_name = name.split(":")[0].split("-")[0].strip() if name else app

    # brand enrichment (context.dev) — optional
    brand_block = ""
    if brand:
        socials = brand.get("socials") or {}
        colors = brand.get("colors") or []
        brand_block = (
            "\n# brand assets (auto-filled via context.dev)\n"
            f"brand_description: \"{brand.get('description','')}\"\n"
            f"brand_industry: \"{brand.get('industry','')}\"\n"
        )
        if colors:
            brand_block += f"brand_colors: [{', '.join(colors[:4])}]\n"
        if socials:
            brand_block += "brand_socials:\n" + "\n".join(
                f'  {k}: "{v}"' for k, v in list(socials.items())[:4]) + "\n"

    return f"""# ASO context — {app}

Auto-scaffolded by aso-context-gen from the live App Store listing. Review the
TODOs and fill in competitors + audience (the skills read this to sharpen keyword
expansion, relevance scoring, and competitor analysis).

```yaml
app: {app}
display_name: "{name or 'TODO'}"
category: "{category}"
subcategory: "{subcategory}"
one_liner: "{one_liner}"
audience: "TODO — who is this for?"
platforms: [appstore, playstore]
store_ids:
  appstore: ""        # resolve via asc-id-resolver
  playstore: "{bundle}"

# 3–5 real competitors — TODO: fill from `aso-competitor-watch` or store search
competitors:
  - "TODO"

# seed keywords — auto-derived from the listing (refine these)
seeds:
{_yaml_list(seeds)}

# brand terms (always keep, never optimize away)
brand_terms:
  - "{brand_name}"

# tone for generated copy
voice: "TODO — e.g. clear and practical / playful / premium"
```
{brand_block}"""


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Scaffold a per-app ASO context.md")
    ap.add_argument("--app", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--country", default="US")
    ap.add_argument("--root", default=".")
    ap.add_argument("--brand-domain", help="enrich brand block via context.dev (needs key)")
    ap.add_argument("--stdout", action="store_true", help="print instead of writing the file")
    ap.add_argument("--force", action="store_true", help="overwrite an existing context.md")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    listing = _fetch_listing(args.bundle, args.country)
    if listing is None:
        print(f"no live listing for {args.bundle} — writing a bare scaffold",
              file=sys.stderr)

    brand = None
    if args.brand_domain:
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import context_scrape as cs  # noqa: E402
            if cs.available():
                brand = cs.brand_data(args.brand_domain).to_dict()
            else:
                print("context.dev key not set — skipping brand enrichment",
                      file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"brand enrichment failed (continuing without): {e}", file=sys.stderr)

    content = build_context(args.app, args.bundle, listing, brand)

    if args.stdout:
        print(content)
        return 0

    path = Path(args.root).resolve() / "marketing" / "aso" / args.app / "context.md"
    if path.exists() and not args.force:
        print(f"{path} exists — use --force to overwrite", file=sys.stderr)
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    print(f"wrote {path}")
    return 0 if listing else 2


if __name__ == "__main__":
    raise SystemExit(main())
