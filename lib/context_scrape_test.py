#!/usr/bin/env python3
"""
Unit tests for the context.dev client (optional scrape accelerator).

No network, no key required for most: urllib.request.urlopen is monkeypatched.
The availability gate is tested by toggling the env var. Run:
    python3 context_scrape_test.py
(zero deps — plain asserts, exits non-zero on failure.)
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import context_scrape as cs  # noqa: E402
from context_scrape import (  # noqa: E402
    BrandData, ContextDevError, available, scrape_markdown, brand_data, ENV_KEY,
)


class FakeResp:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def _patch_urlopen(item):
    """item: FakeResp or Exception. Records the request URL for assertions."""
    rec = {"url": None, "headers": None}

    def fake_urlopen(req, timeout=45):
        rec["url"] = req.full_url
        rec["headers"] = req.headers
        if isinstance(item, Exception):
            raise item
        return item

    cs.urllib.request.urlopen = fake_urlopen  # type: ignore[attr-defined]
    return rec


def _with_key(fn):
    """Run fn with a key set in env, restoring afterward."""
    prev = os.environ.get(ENV_KEY)
    os.environ[ENV_KEY] = "ctx_testkey"
    try:
        return fn()
    finally:
        if prev is None:
            os.environ.pop(ENV_KEY, None)
        else:
            os.environ[ENV_KEY] = prev


# ── availability gate ────────────────────────────────────────────────────────
def test_available_false_without_key():
    prev = os.environ.pop(ENV_KEY, None)
    try:
        assert available() is False
    finally:
        if prev is not None:
            os.environ[ENV_KEY] = prev


def test_available_true_with_key():
    _with_key(lambda: (_ for _ in ()).throw(AssertionError) if not available() else None)


def test_calls_without_key_raise():
    os.environ.pop(ENV_KEY, None)
    try:
        scrape_markdown("https://x.com")
        assert False, "should raise without key"
    except ContextDevError as e:
        assert ENV_KEY in str(e)


# ── scrape markdown ──────────────────────────────────────────────────────────
def test_scrape_returns_markdown_field():
    rec = _patch_urlopen(FakeResp(json.dumps(
        {"success": True, "markdown": "# Hello\n\nbody", "url": "https://x.com"})))
    md = _with_key(lambda: scrape_markdown("https://apps.apple.com/app/id1"))
    assert md == "# Hello\n\nbody"
    # GET to the real path with the url query param + bearer auth
    assert "/web/scrape/markdown" in rec["url"]
    assert "url=https" in rec["url"]


def test_scrape_sends_bearer_auth():
    rec = _patch_urlopen(FakeResp(json.dumps({"markdown": "x"})))
    _with_key(lambda: scrape_markdown("https://x.com"))
    # urllib normalizes header keys to Title-Case
    auth = rec["headers"].get("Authorization")
    assert auth == "Bearer ctx_testkey", auth


def test_scrape_sends_browser_user_agent():
    # context.dev's Cloudflare edge 403s requests with no real browser UA
    # (error 1010) — the client must send a browser-like User-Agent.
    rec = _patch_urlopen(FakeResp(json.dumps({"markdown": "x"})))
    _with_key(lambda: scrape_markdown("https://x.com"))
    ua = rec["headers"].get("User-agent") or rec["headers"].get("User-Agent")
    assert ua and "Mozilla" in ua, ua


def test_scrape_main_content_param():
    rec = _patch_urlopen(FakeResp(json.dumps({"markdown": "x"})))
    _with_key(lambda: scrape_markdown("https://x.com", main_content_only=True))
    assert "useMainContentOnly=true" in rec["url"]


def test_scrape_empty_markdown_raises():
    _patch_urlopen(FakeResp(json.dumps({"success": True, "markdown": ""})))
    try:
        _with_key(lambda: scrape_markdown("https://x.com"))
        assert False, "empty markdown should raise"
    except ContextDevError:
        pass


def test_scrape_http_error_wrapped():
    err = urllib.error.HTTPError("http://x", 402, "Payment Required",
                                 hdrs={}, fp=io.BytesIO(b"out of credits"))
    _patch_urlopen(err)
    try:
        _with_key(lambda: scrape_markdown("https://x.com"))
        assert False
    except ContextDevError as e:
        assert "402" in str(e)


# ── brand data (real nested shape) ───────────────────────────────────────────
_BRAND_BODY = json.dumps({
    "status": "ok",
    "brand": {
        "domain": "swoop.example",
        "title": "Swoop",
        "description": "Meet people near you",
        "slogan": "Chat & Meet IRL",
        "colors": [{"hex": "#e63946", "name": "red"}, {"hex": "#1d3557", "name": "navy"}],
        "logos": [{"url": "https://cdn/logo.png", "type": "logo"},
                  {"url": "https://cdn/icon.png", "type": "icon"}],
        "socials": [{"type": "x", "url": "https://x.com/swoop"},
                    {"type": "instagram", "url": "https://ig.com/swoop"}],
        "industries": {"eic": [{"industry": "Social Networking",
                                 "subindustry": "Dating"}]},
    },
    "code": 200,
})


def test_brand_parses_nested_shape():
    _patch_urlopen(FakeResp(_BRAND_BODY))
    b = _with_key(lambda: brand_data("swoop.example"))
    assert isinstance(b, BrandData)
    assert b.name == "Swoop"
    assert b.description == "Meet people near you"
    assert b.industry == "Social Networking"
    assert b.colors == ["#e63946", "#1d3557"]
    assert b.logos == ["https://cdn/logo.png", "https://cdn/icon.png"]
    assert b.socials == {"x": "https://x.com/swoop", "instagram": "https://ig.com/swoop"}


def test_brand_uses_brand_retrieve_path_with_domain():
    rec = _patch_urlopen(FakeResp(_BRAND_BODY))
    _with_key(lambda: brand_data("swoop.example"))
    assert "/brand/retrieve" in rec["url"]
    assert "domain=swoop.example" in rec["url"]


def test_brand_tolerates_missing_fields():
    _patch_urlopen(FakeResp(json.dumps({"brand": {"domain": "d", "title": "T"}})))
    b = _with_key(lambda: brand_data("d"))
    assert b.name == "T"
    assert b.colors is None and b.logos is None and b.socials is None
    assert b.industry == ""


def test_brand_to_dict_roundtrips():
    _patch_urlopen(FakeResp(_BRAND_BODY))
    b = _with_key(lambda: brand_data("swoop.example"))
    d = b.to_dict()
    assert d["name"] == "Swoop" and d["domain"] == "swoop.example"


def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn(); print(f"  ok   {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1; print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
