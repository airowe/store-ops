#!/usr/bin/env python3
"""
Google Ads Keyword Planner client for *real* keyword search volume.

The second grounding source for the `aso-keyword-research` skill (alongside the
Apple Search Popularity client). Where Apple gives a normalized 5-100 score,
Google gives **actual average monthly searches** — a raw integer — plus a
competition signal. This is the ASO analogue of grounding the sportswriter on
real stats before it writes.

Why Google over Apple SP (the pivot): Apple's account/credential path is
brutal, and since Oct-2025 Apple withholds SP < 35. Google Keyword Planner has
a slower-but-saner setup (a dev-token approval gate, no Apple-ID gymnastics) and
returns real volumes with no withholding floor.

API (confirmed against the v24 docs):
  - OAuth2 user creds: client_id + client_secret + refresh_token -> access_token
    via https://oauth2.googleapis.com/token
  - POST https://googleads.googleapis.com/v24/customers/{cid}:generateKeywordHistoricalMetrics
  - Headers: Authorization: Bearer <token>, developer-token: <dt>,
             login-customer-id: <mcc or cid>
  - Body: { keywords[], language, geoTargetConstants[], keywordPlanNetwork,
            historicalMetricsOptions }
  - Response: results[].keywordMetrics.{avgMonthlySearches, competition,
            competitionIndex, low/highTopOfPageBidMicros, monthlySearchVolumes}

NO secrets in this file. Credentials come from the environment:
    GADS_DEVELOPER_TOKEN, GADS_CLIENT_ID, GADS_CLIENT_SECRET,
    GADS_REFRESH_TOKEN, GADS_CUSTOMER_ID  (digits only, no dashes)
    GADS_LOGIN_CUSTOMER_ID  (optional; defaults to GADS_CUSTOMER_ID)
or GADS_ACCESS_TOKEN directly to skip the refresh exchange.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterable

# ── Endpoints / constants (Google, confirmed) ───────────────────────────────
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_VERSION = os.environ.get("GADS_API_VERSION", "v24")
API_HOST = "https://googleads.googleapis.com"

# Common resource-name constants (override per call).
LANG_EN = "languageConstants/1000"
GEO_US = "geoTargetConstants/2840"

# Google's competition enum → a 0-100 difficulty proxy for the ASO score.
_COMPETITION_DIFFICULTY = {
    "LOW": 25, "MEDIUM": 55, "HIGH": 85,
    "UNSPECIFIED": 50, "UNKNOWN": 50,
}


class GoogleAdsError(RuntimeError):
    """Any failure talking to the Google Ads API."""


class MissingCredentials(GoogleAdsError):
    """Required env credentials were not set."""


@dataclass
class KeywordVolume:
    """One keyword's Google Keyword Planner metrics.

    `avg_monthly_searches` is the real headline number. Google buckets exact
    volumes into ranges for low-traffic terms, so treat small values as
    order-of-magnitude, not exact.
    """

    keyword: str
    avg_monthly_searches: int
    competition: str = "UNKNOWN"
    competition_index: int | None = None
    low_top_bid_micros: int | None = None
    high_top_bid_micros: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def difficulty(self) -> int:
        """0-100 difficulty proxy from Google's competition signal.

        Prefer the precise competitionIndex (0-100) when present; fall back to
        the LOW/MEDIUM/HIGH bucket."""
        if self.competition_index is not None:
            return int(max(0, min(100, self.competition_index)))
        return _COMPETITION_DIFFICULTY.get(self.competition.upper(), 50)

    def to_dict(self) -> dict[str, Any]:
        return {
            "keyword": self.keyword,
            "avg_monthly_searches": self.avg_monthly_searches,
            "competition": self.competition,
            "competition_index": self.competition_index,
            "difficulty": self.difficulty,
        }


# ── HTTP helper (stdlib only, matching repo house style) ─────────────────────
def _request(url: str, payload: dict | str, headers: dict[str, str],
             *, form: bool = False, timeout: int = 30) -> dict[str, Any]:
    if form:
        data = urllib.parse.urlencode(payload).encode()  # type: ignore[arg-type]
        headers = {**headers, "Content-Type": "application/x-www-form-urlencoded"}
    else:
        data = json.dumps(payload).encode()
        headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        raise GoogleAdsError(f"HTTP {e.code} from {url}: {detail}") from e
    except urllib.error.URLError as e:
        raise GoogleAdsError(f"network error to {url}: {e.reason}") from e
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError as e:
        raise GoogleAdsError(f"non-JSON response from {url}: {body[:200]}") from e


class GoogleKeywordPlanner:
    """Thin client for the one thing we need: real keyword search volume.

    Pass credentials explicitly or via `from_env()`. For tests, inject
    `transport` — a callable (url, payload, headers, form) -> dict — to bypass
    the network entirely.
    """

    def __init__(self, developer_token: str, customer_id: str,
                 client_id: str = "", client_secret: str = "",
                 refresh_token: str = "", access_token: str = "",
                 login_customer_id: str = "", *, transport=None):
        self.developer_token = developer_token
        self.customer_id = self._digits(customer_id)
        self.login_customer_id = self._digits(login_customer_id) or self.customer_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self._token = access_token
        self._token_exp = 0.0
        self._transport = transport or _request

    @staticmethod
    def _digits(s: str) -> str:
        return "".join(ch for ch in str(s) if ch.isdigit())

    # -- construction -------------------------------------------------------
    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, *, transport=None):
        env = env or dict(os.environ)
        dt = env.get("GADS_DEVELOPER_TOKEN", "").strip()
        cid = env.get("GADS_CUSTOMER_ID", "").strip()
        if not dt:
            raise MissingCredentials("GADS_DEVELOPER_TOKEN is required")
        if not cid:
            raise MissingCredentials("GADS_CUSTOMER_ID is required")
        token = env.get("GADS_ACCESS_TOKEN", "").strip()
        refresh = env.get("GADS_REFRESH_TOKEN", "").strip()
        client_id = env.get("GADS_CLIENT_ID", "").strip()
        secret = env.get("GADS_CLIENT_SECRET", "").strip()
        if not token and not (refresh and client_id and secret):
            raise MissingCredentials(
                "set GADS_ACCESS_TOKEN, or all of "
                "GADS_REFRESH_TOKEN + GADS_CLIENT_ID + GADS_CLIENT_SECRET")
        return cls(dt, cid, client_id, secret, refresh, token,
                   env.get("GADS_LOGIN_CUSTOMER_ID", "").strip(),
                   transport=transport)

    # -- auth ---------------------------------------------------------------
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        if not (self.refresh_token and self.client_id and self.client_secret):
            if self._token:  # static token, no refresh material — use as-is
                return self._token
            raise MissingCredentials("no refresh_token/client creds to mint a token")
        resp = self._transport(
            TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            {"Host": "oauth2.googleapis.com"},
            form=True,
        )
        token = resp.get("access_token")
        if not token:
            raise GoogleAdsError(f"token response missing access_token: {resp}")
        self._token = token
        self._token_exp = time.time() + int(resp.get("expires_in", 3600))
        return token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._access_token()}",
            "developer-token": self.developer_token,
            "login-customer-id": self.login_customer_id,
        }

    # -- the one call we need ----------------------------------------------
    def volume(self, keywords: Iterable[str], *, language: str = LANG_EN,
               geo_targets: list[str] | None = None,
               network: str = "GOOGLE_SEARCH") -> list[KeywordVolume]:
        """Return average monthly search volume for each keyword.

        Google returns metrics only for keywords with data; terms it omits come
        back with avg_monthly_searches=0 (genuinely no/low data — unlike Apple's
        SP withholding, a 0 here means Google has no volume to report)."""
        terms = [k.strip() for k in keywords if k and k.strip()]
        if not terms:
            return []
        payload = {
            "keywords": terms,
            "language": language,
            "geoTargetConstants": geo_targets or [GEO_US],
            "keywordPlanNetwork": network,
            "historicalMetricsOptions": {"includeAverageCpc": True},
        }
        url = f"{API_HOST}/{API_VERSION}/customers/{self.customer_id}:generateKeywordHistoricalMetrics"
        resp = self._transport(url, payload, self._headers())
        return self._parse(resp, terms)

    # -- response parsing ---------------------------------------------------
    @staticmethod
    def _parse(resp: dict, requested: list[str]) -> list[KeywordVolume]:
        rows = resp.get("results") or []
        by_kw: dict[str, KeywordVolume] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            text = str(row.get("text", "")).strip()
            m = row.get("keywordMetrics") or {}
            if not text:
                continue
            by_kw[text.lower()] = KeywordVolume(
                keyword=text,
                avg_monthly_searches=int(m.get("avgMonthlySearches", 0) or 0),
                competition=str(m.get("competition", "UNKNOWN")),
                competition_index=(int(m["competitionIndex"])
                                   if m.get("competitionIndex") is not None else None),
                low_top_bid_micros=m.get("lowTopOfPageBidMicros"),
                high_top_bid_micros=m.get("highTopOfPageBidMicros"),
                raw=row,
            )
        # Every requested keyword gets a row; ones Google omitted = 0 volume.
        out: list[KeywordVolume] = []
        for t in requested:
            hit = by_kw.get(t.lower())
            out.append(hit if hit is not None
                       else KeywordVolume(keyword=t, avg_monthly_searches=0))
        return out


def normalize_to_volume(avg_monthly_searches: int,
                        *, ceiling: int = 100_000) -> float:
    """Map raw monthly searches → the 0-100 `volume` axis the ASO skill scores on.

    Search volume is heavy-tailed (a few head terms dwarf everything), so a
    linear scale would crush the mid/long tail to ~0. We use a log scale: 0
    searches → 0; `ceiling` searches → 100; everything between scaled by log.
    """
    import math
    v = max(0, int(avg_monthly_searches))
    if v <= 0:
        return 0.0
    score = (math.log10(v + 1) / math.log10(ceiling + 1)) * 100
    return float(max(0.0, min(100.0, score)))
