#!/usr/bin/env python3
"""
Unit tests for the Google Keyword Planner client.

No network, no credentials: a mock `transport` records calls and returns
recorded-shape payloads. Run:  python3 google_keyword_volume_test.py
(zero deps — plain asserts, exits non-zero on failure.)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from google_keyword_volume import (  # noqa: E402
    GoogleKeywordPlanner,
    GoogleAdsError,
    MissingCredentials,
    KeywordVolume,
    normalize_to_volume,
    LANG_EN,
    GEO_US,
)


class MockTransport:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, url, payload, headers, *, form=False, timeout=30):
        self.calls.append({"url": url, "payload": payload, "headers": headers,
                           "form": form})
        if not self._responses:
            raise AssertionError(f"unexpected extra call to {url}")
        return self._responses.pop(0)


TOKEN_RESP = {"access_token": "ya29.tok", "expires_in": 3600}


def _client(*api_responses):
    t = MockTransport([TOKEN_RESP, *api_responses])
    c = GoogleKeywordPlanner(
        developer_token="dev-tok", customer_id="123-456-7890",
        client_id="cid.apps", client_secret="secret",
        refresh_token="1//refresh", transport=t)
    return c, t


def _result(text, searches, competition="MEDIUM", idx=None):
    m = {"avgMonthlySearches": searches, "competition": competition}
    if idx is not None:
        m["competitionIndex"] = idx
    return {"text": text, "keywordMetrics": m}


# ── auth ─────────────────────────────────────────────────────────────────────
def test_oauth_refresh_request_shape():
    c, t = _client({"results": []})
    c.volume(["x"])
    tok = t.calls[0]
    assert tok["url"] == "https://oauth2.googleapis.com/token"
    assert tok["form"] is True
    p = tok["payload"]
    assert p["grant_type"] == "refresh_token"
    assert p["refresh_token"] == "1//refresh"
    assert p["client_id"] == "cid.apps" and p["client_secret"] == "secret"


def test_api_headers_carry_token_devtoken_logincid():
    c, t = _client({"results": []})
    c.volume(["x"])
    h = t.calls[1]["headers"]
    assert h["Authorization"] == "Bearer ya29.tok"
    assert h["developer-token"] == "dev-tok"
    assert h["login-customer-id"] == "1234567890", "dashes stripped from customer id"


def test_customer_id_dashes_stripped_in_url():
    c, t = _client({"results": []})
    c.volume(["x"])
    assert "customers/1234567890:generateKeywordHistoricalMetrics" in t.calls[1]["url"]


def test_token_reused_across_calls():
    c, t = _client({"results": []}, {"results": []})
    c.volume(["a"]); c.volume(["b"])
    token_calls = [x for x in t.calls if "oauth2" in x["url"]]
    assert len(token_calls) == 1


def test_static_access_token_skips_refresh():
    t = MockTransport([{"results": []}])  # no token resp queued
    c = GoogleKeywordPlanner("dev", "999", access_token="static", transport=t)
    c.volume(["x"])
    assert t.calls[0]["headers"]["Authorization"] == "Bearer static"


def test_from_env_requires_developer_token():
    try:
        GoogleKeywordPlanner.from_env({"GADS_CUSTOMER_ID": "1", "GADS_ACCESS_TOKEN": "t"})
    except MissingCredentials as e:
        assert "DEVELOPER_TOKEN" in str(e); return
    raise AssertionError("expected MissingCredentials")


def test_from_env_requires_customer_id():
    try:
        GoogleKeywordPlanner.from_env({"GADS_DEVELOPER_TOKEN": "d", "GADS_ACCESS_TOKEN": "t"})
    except MissingCredentials as e:
        assert "CUSTOMER_ID" in str(e); return
    raise AssertionError("expected MissingCredentials")


def test_from_env_requires_token_or_refresh_triple():
    try:
        GoogleKeywordPlanner.from_env({"GADS_DEVELOPER_TOKEN": "d", "GADS_CUSTOMER_ID": "1"})
    except MissingCredentials:
        return
    raise AssertionError("expected MissingCredentials")


def test_login_customer_id_defaults_to_customer_id():
    c = GoogleKeywordPlanner("d", "111-222-3333", access_token="t")
    assert c.login_customer_id == "1112223333"


# ── request body ──────────────────────────────────────────────────────────────
def test_request_body_shape():
    c, t = _client({"results": []})
    c.volume(["recipe app", "meal planner"])
    body = t.calls[1]["payload"]
    assert body["keywords"] == ["recipe app", "meal planner"]
    assert body["language"] == LANG_EN
    assert body["geoTargetConstants"] == [GEO_US]
    assert body["keywordPlanNetwork"] == "GOOGLE_SEARCH"


def test_custom_geo_and_language():
    c, t = _client({"results": []})
    c.volume(["x"], language="languageConstants/1001",
             geo_targets=["geoTargetConstants/2826"])  # de, GB
    body = t.calls[1]["payload"]
    assert body["language"] == "languageConstants/1001"
    assert body["geoTargetConstants"] == ["geoTargetConstants/2826"]


def test_empty_keywords_short_circuits_no_call():
    t = MockTransport([])
    c = GoogleKeywordPlanner("d", "1", access_token="t", transport=t)
    assert c.volume([]) == []
    assert c.volume(["", "  "]) == []
    assert t.calls == []


# ── response parsing ──────────────────────────────────────────────────────────
def test_parses_avg_monthly_searches():
    resp = {"results": [
        _result("recipe app", 40500, "HIGH", 88),
        _result("meal planner", 8100, "MEDIUM", 47),
    ]}
    c, _ = _client(resp)
    out = {k.keyword: k for k in c.volume(["recipe app", "meal planner"])}
    assert out["recipe app"].avg_monthly_searches == 40500
    assert out["recipe app"].competition == "HIGH"
    assert out["meal planner"].avg_monthly_searches == 8100


def test_competition_index_preferred_for_difficulty():
    resp = {"results": [_result("x", 100, "HIGH", 30)]}
    c, _ = _client(resp)
    (k,) = c.volume(["x"])
    # index 30 overrides the HIGH bucket (which would be 85)
    assert k.difficulty == 30


def test_difficulty_falls_back_to_competition_bucket():
    resp = {"results": [_result("x", 100, "LOW")]}  # no index
    c, _ = _client(resp)
    (k,) = c.volume(["x"])
    assert k.difficulty == 25  # LOW bucket


def test_omitted_keyword_returns_zero_volume():
    # Google omits keywords with no data; we surface 0 (real: no volume).
    resp = {"results": [_result("recipe app", 40500)]}
    c, _ = _client(resp)
    out = {k.keyword: k for k in c.volume(["recipe app", "ultra obscure term"])}
    assert out["ultra obscure term"].avg_monthly_searches == 0
    assert out["ultra obscure term"].difficulty == 50  # UNKNOWN bucket


def test_zero_volume_competition_unknown():
    c, _ = _client({"results": []})
    (k,) = c.volume(["nothing"])
    assert k.avg_monthly_searches == 0
    assert k.competition == "UNKNOWN"


def test_http_error_propagates():
    def boom(*a, **k):
        raise GoogleAdsError("HTTP 401: invalid dev token")
    c = GoogleKeywordPlanner("d", "1", access_token="t", transport=boom)
    try:
        c.volume(["x"])
    except GoogleAdsError as e:
        assert "401" in str(e); return
    raise AssertionError("expected GoogleAdsError")


def test_to_dict_serializable():
    k = KeywordVolume("x", 1000, "MEDIUM", 50)
    assert k.to_dict() == {
        "keyword": "x", "avg_monthly_searches": 1000, "competition": "MEDIUM",
        "competition_index": 50, "difficulty": 50}


# ── volume normalization (feeds the ASO score) ───────────────────────────────
def test_normalize_is_log_scaled_and_clamped():
    assert normalize_to_volume(0) == 0.0
    assert normalize_to_volume(100_000) == 100.0
    # log scale: 1000 searches is well above half, not 1% (linear would give 1.0)
    mid = normalize_to_volume(1000)
    assert 50 < mid < 75, f"log midpoint off: {mid}"
    # monotonic
    assert normalize_to_volume(100) < normalize_to_volume(10_000)
    # over-ceiling clamps to 100
    assert normalize_to_volume(5_000_000) == 100.0


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
