#!/usr/bin/env python3
"""
Unit tests for the Apple Search Ads popularity client.

No network, no credentials: a mock `transport` records calls and returns
recorded-shape payloads. Run:  python3 apple_search_popularity_test.py
(zero deps — plain asserts, exits non-zero on failure.)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apple_search_popularity import (  # noqa: E402
    AppleSearchAdsClient,
    AppleSearchAdsError,
    MissingCredentials,
    Popularity,
    SP_FLOOR,
    normalize_to_volume,
)


class MockTransport:
    """Records (url, payload, headers, form) and replays queued responses."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, url, payload, headers, *, form=False, timeout=30):
        self.calls.append({"url": url, "payload": payload, "headers": headers,
                           "form": form})
        if not self._responses:
            raise AssertionError(f"unexpected extra call to {url}")
        return self._responses.pop(0)


TOKEN_RESP = {"access_token": "tok_abc123", "expires_in": 3600, "token_type": "Bearer"}


def _client(*api_responses):
    """Client primed with a token response then the given API responses."""
    t = MockTransport([TOKEN_RESP, *api_responses])
    c = AppleSearchAdsClient("22251290", "client.x", "secret.y", transport=t)
    return c, t


# ── auth ────────────────────────────────────────────────────────────────────
def test_oauth_request_shape():
    c, t = _client({"data": []})
    c.popularity(["x"])
    tok = t.calls[0]
    assert tok["url"] == "https://appleid.apple.com/auth/oauth2/token"
    assert tok["form"] is True, "token call must be form-encoded"
    p = tok["payload"]
    assert p["grant_type"] == "client_credentials"
    assert p["scope"] == "searchadsorg"
    assert p["client_id"] == "client.x" and p["client_secret"] == "secret.y"


def test_api_headers_carry_bearer_and_org_context():
    c, t = _client({"data": []})
    c.popularity(["x"])
    api = t.calls[1]
    assert api["headers"]["Authorization"] == "Bearer tok_abc123"
    assert api["headers"]["X-AP-Context"] == "orgId=22251290"
    assert api["url"].endswith("/keywords/recommendations")


def test_token_is_reused_not_reminted():
    c, t = _client({"data": []}, {"data": []})
    c.popularity(["a"])
    c.popularity(["b"])
    token_calls = [x for x in t.calls if "oauth2/token" in x["url"]]
    assert len(token_calls) == 1, "token should be cached across calls"


def test_static_access_token_skips_token_exchange():
    t = MockTransport([{"data": []}])  # NO token response queued
    c = AppleSearchAdsClient("22251290", access_token="static_tok", transport=t)
    c.popularity(["x"])
    assert t.calls[0]["headers"]["Authorization"] == "Bearer static_tok"


def test_from_env_requires_org():
    try:
        AppleSearchAdsClient.from_env({"ASA_CLIENT_ID": "a", "ASA_CLIENT_SECRET": "b"})
    except MissingCredentials:
        return
    raise AssertionError("expected MissingCredentials without ASA_ORG_ID")


def test_from_env_requires_token_or_clientsecret():
    try:
        AppleSearchAdsClient.from_env({"ASA_ORG_ID": "22251290"})
    except MissingCredentials:
        return
    raise AssertionError("expected MissingCredentials without token/secret")


# ── popularity parsing ────────────────────────────────────────────────────────
def test_parses_scores_from_searchVolume_field():
    resp = {"data": [
        {"keyword": "recipe app", "searchVolume": 72},
        {"keyword": "meal planner", "searchVolume": 41},
    ]}
    c, _ = _client(resp)
    out = {p.keyword: p for p in c.popularity(["recipe app", "meal planner"])}
    assert out["recipe app"].score == 72
    assert out["recipe app"].reported is True
    assert out["meal planner"].score == 41


def test_alternate_field_names_popularity_and_text():
    resp = {"data": [{"text": "grocery list", "popularity": 58}]}
    c, _ = _client(resp)
    (p,) = c.popularity(["grocery list"])
    assert p.keyword == "grocery list" and p.score == 58


def test_nested_data_recommendations_shape():
    resp = {"data": {"recommendations": [
        {"keyword": "pantry tracker", "searchVolume": 37}]}}
    c, _ = _client(resp)
    (p,) = c.popularity(["pantry tracker"])
    assert p.score == 37


def test_below_threshold_keyword_omitted_by_apple_is_not_zero():
    # Apple (post Oct-2025) returns NOTHING for SP < 35.
    resp = {"data": [{"keyword": "recipe app", "searchVolume": 72}]}
    c, _ = _client(resp)
    out = {p.keyword: p for p in c.popularity(["recipe app", "obscure niche term"])}
    miss = out["obscure niche term"]
    assert miss.score is None
    assert miss.below_threshold is True
    assert miss.reported is False
    # critical: never reported as 0 demand
    assert miss.to_dict()["score"] is None


def test_low_score_below_floor_marked_below_threshold():
    resp = {"data": [{"keyword": "edge term", "searchVolume": 20}]}  # < SP_FLOOR
    c, _ = _client(resp)
    (p,) = c.popularity(["edge term"])
    assert p.score == 20
    assert p.below_threshold is True, f"score {p.score} < {SP_FLOOR} is below threshold"


def test_market_area_passed_through_and_recorded():
    c, t = _client({"data": []})
    c.popularity(["x"], market_area="GB")
    assert t.calls[1]["payload"]["marketArea"] == "GB"


def test_request_uses_exact_match_keyword_selector():
    c, t = _client({"data": []})
    c.popularity(["recipe app"], match_type="EXACT")
    sel = t.calls[1]["payload"]["selector"]["keywords"]
    assert sel == [{"text": "recipe app", "matchType": "EXACT"}]


def test_empty_keyword_list_short_circuits_no_call():
    t = MockTransport([])  # nothing queued; must not call transport
    c = AppleSearchAdsClient("22251290", access_token="t", transport=t)
    assert c.popularity([]) == []
    assert c.popularity(["", "  "]) == []
    assert t.calls == []


def test_http_error_raises_appleSearchAdsError():
    def boom(*a, **k):
        raise AppleSearchAdsError("HTTP 401: invalid_client")
    c = AppleSearchAdsClient("22251290", "a", "b", transport=boom)
    try:
        c.popularity(["x"])
    except AppleSearchAdsError as e:
        assert "401" in str(e)
        return
    raise AssertionError("expected AppleSearchAdsError to propagate")


# ── volume normalization (feeds the ASO score) ───────────────────────────────
def test_normalize_clamps_and_floors():
    assert normalize_to_volume(72) == 72.0
    assert normalize_to_volume(100) == 100.0
    assert normalize_to_volume(3) == 5.0          # clamp to SP min
    assert normalize_to_volume(None) == 15.0      # below_threshold floor, not 0
    assert normalize_to_volume(None) > 0          # never zero


def test_popularity_to_dict_is_serializable():
    p = Popularity("x", 50, market_area="US")
    d = p.to_dict()
    assert d == {"keyword": "x", "score": 50, "below_threshold": False,
                 "market_area": "US"}


# ── runner ────────────────────────────────────────────────────────────────────
def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {fn.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
