#!/usr/bin/env python3
"""
context.dev client — clean competitor-listing + brand-data scraping for ASO.

This is an *optional accelerator* for the EXPANSION leg of aso-keyword-research,
not a required dependency. The skill's core path scrapes competitor listings via
WebFetch / Crawl4AI (free, always available). When a CONTEXT_DEV_API_KEY is
present, this client does the same job more reliably — context.dev is built to
turn any URL (incl. JS-heavy, anti-bot App Store / Play pages) into clean
LLM-ready markdown in one call, and to extract brand data (logos, colors,
industry, socials) from a domain to auto-fill the context.md brand block.

Positioning guardrail: the plugin's differentiator is "no paid data API
REQUIRED." context.dev is to the *scrape* leg what Apple/Google are to the
*volume* leg — a credentialed upgrade with a free fallback, never a gate. If no
key is set, this module's helpers return None and the caller falls back.

Endpoint shape (verified against docs.context.dev v1; env-overridable so a shift
is a constant change, not a rewrite):
  • GET {BASE}/web/scrape/markdown?url=...   → {"markdown": "...", ...}
  • GET {BASE}/brand/retrieve?domain=...      → {"brand": {title,description,
      colors[].hex, logos[].url, socials[].url, industries.eic[].industry}, ...}
  • Auth: Authorization: Bearer <key> (header/prefix overridable via env).

NO secrets in this file. Set CONTEXT_DEV_API_KEY in your .env (never committed).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from typing import Any

# ── Config (env-overridable; defaults are the real docs.context.dev v1 API) ──
# Both endpoints are GET with query params, Bearer auth, JSON responses.
#   GET {BASE}/web/scrape/markdown?url=...   -> {"markdown": "...", ...}
#   GET {BASE}/brand/retrieve?domain=...     -> {"brand": {...}, ...}
API_BASE = os.environ.get("CONTEXT_DEV_API_BASE", "https://api.context.dev/v1")
SCRAPE_PATH = os.environ.get("CONTEXT_DEV_SCRAPE_PATH", "/web/scrape/markdown")
BRAND_PATH = os.environ.get("CONTEXT_DEV_BRAND_PATH", "/brand/retrieve")
# How the key is presented. Default to a Bearer Authorization header; override
# CONTEXT_DEV_AUTH_HEADER (e.g. "x-api-key") if context.dev expects a raw key.
AUTH_HEADER = os.environ.get("CONTEXT_DEV_AUTH_HEADER", "Authorization")
AUTH_PREFIX = os.environ.get("CONTEXT_DEV_AUTH_PREFIX", "Bearer ")
ENV_KEY = "CONTEXT_DEV_API_KEY"


class ContextDevError(Exception):
    pass


@dataclass
class BrandData:
    domain: str
    name: str = ""
    description: str = ""
    industry: str = ""
    colors: list[str] | None = None
    logos: list[str] | None = None
    socials: dict[str, str] | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def available() -> bool:
    """True iff a context.dev key is configured. Callers branch on this and
    fall back to the free scrape path when it's False."""
    return bool(os.environ.get(ENV_KEY, "").strip())


def _get(path: str, params: dict) -> dict:
    """GET {API_BASE}{path}?params with Bearer auth → parsed JSON."""
    key = os.environ.get(ENV_KEY, "").strip()
    if not key:
        raise ContextDevError(f"{ENV_KEY} not set — use the free fallback path")
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(
        f"{API_BASE}{path}?{qs}",
        headers={
            "Accept": "application/json",
            # context.dev's edge (Cloudflare) blocks requests with no real
            # browser signature (error 1010), so send a normal UA + lang.
            "User-Agent": os.environ.get(
                "CONTEXT_DEV_USER_AGENT",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"),
            "Accept-Language": "en-US,en;q=0.9",
            AUTH_HEADER: f"{AUTH_PREFIX}{key}",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise ContextDevError(f"HTTP {e.code} from {path}: {detail}") from e
    except Exception as e:  # noqa: BLE001 — uniform surface for any net failure
        raise ContextDevError(f"request to {path} failed: {e}") from e


def _first(d: dict, *keys: str, default: Any = "") -> Any:
    """Tolerate field-name drift in the response shape."""
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


def scrape_markdown(url: str, *, main_content_only: bool = True) -> str:
    """Return the page at `url` as clean markdown via GET /web/scrape/markdown.
    Raises ContextDevError on failure (caller falls back to WebFetch/Crawl4AI)."""
    data = _get(SCRAPE_PATH, {
        "url": url,
        "useMainContentOnly": str(main_content_only).lower(),
    })
    # real shape: {"success": true, "markdown": "...", ...}; keep fallbacks for drift
    md = _first(data, "markdown", "content", "text")
    if isinstance(md, dict):
        md = _first(md, "markdown", "content", "text")
    if not md:
        raise ContextDevError(f"no markdown in response for {url}: {list(data)[:6]}")
    return md


def brand_data(domain: str) -> BrandData:
    """Extract brand fields for `domain` via GET /brand/retrieve. Response nests
    everything under `brand` (title/description/colors[].hex/logos[].url/
    socials[].url/industries.eic[]). Raises ContextDevError on failure."""
    data = _get(BRAND_PATH, {"domain": domain})
    b = data.get("brand", data) if isinstance(data, dict) else {}
    # colors are [{hex,name}] -> list of hex strings
    colors = [c.get("hex") for c in (b.get("colors") or []) if isinstance(c, dict) and c.get("hex")]
    # logos are [{url,...}] -> list of url strings
    logos = [l.get("url") for l in (b.get("logos") or []) if isinstance(l, dict) and l.get("url")]
    # socials are [{type,url}] -> {type: url}
    socials = {s.get("type"): s.get("url")
               for s in (b.get("socials") or [])
               if isinstance(s, dict) and s.get("type") and s.get("url")}
    # industries.eic[0].industry is the top industry label
    eic = ((b.get("industries") or {}).get("eic") or [])
    industry = eic[0].get("industry", "") if eic and isinstance(eic[0], dict) else ""
    return BrandData(
        domain=domain,
        name=_first(b, "title", "name", "brandName"),
        description=_first(b, "description", "slogan", "summary"),
        industry=industry,
        colors=colors or None,
        logos=logos or None,
        socials=socials or None,
    )


# ── CLI: scrape a URL or pull brand data, for the skill to shell out to ──────
def _load_dotenv(path: str) -> None:
    from pathlib import Path
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main(argv=None) -> int:
    import argparse
    from pathlib import Path
    ap = argparse.ArgumentParser(description="context.dev scrape / brand-data (optional ASO accelerator)")
    ap.add_argument("target", help="a URL to scrape, or a domain with --brand")
    ap.add_argument("--brand", action="store_true",
                    help="extract brand data for a domain instead of scraping a URL")
    ap.add_argument("--env", default=str(Path(__file__).resolve().parents[1] / ".env"),
                    help="path to .env (default: repo-root .env)")
    args = ap.parse_args(argv)
    _load_dotenv(args.env)

    if not available():
        print(f"{ENV_KEY} not set — the skill falls back to WebFetch/Crawl4AI "
              "for this; context.dev is optional.", file=__import__("sys").stderr)
        return 2
    try:
        if args.brand:
            print(json.dumps(brand_data(args.target).to_dict(), indent=2))
        else:
            print(scrape_markdown(args.target))
    except ContextDevError as e:
        print(f"context.dev error: {e}", file=__import__("sys").stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
