#!/usr/bin/env python3
"""
Apple Search Ads API client for *real* keyword Search Popularity (5–100).

This grounds the `aso-keyword-research` skill on Apple's own demand signal —
the same 5–100 Search Popularity score that powers the Apple Search Ads
dashboard — instead of the autocomplete-rank proxy the skill falls back to when
no credential is present.

Auth (confirmed against Apple's OAuth docs):
  - OAuth2 client-credentials grant at https://appleid.apple.com/auth/oauth2/token
  - grant_type=client_credentials, scope=searchadsorg
  - returns a Bearer access_token (~1h TTL)
  - every API call carries two headers:
        Authorization: Bearer <token>
        X-AP-Context:  orgId=<orgId>
  - API base: https://api.searchads.apple.com/api/v5

Search Popularity reality (Apple changed this in Oct 2025):
  - SP is a 5–100 score: a 7-day moving average of search impressions,
    normalized across all App Store keywords, on an EXPONENTIAL scale
    (SP 50→60 is a far bigger jump than SP 20→30).
  - Since Oct 2025 Apple only returns SP for keywords with SP >= 35. Keywords
    below that return NO popularity data. We surface that as
    `below_threshold` — NEVER as 0 — so the ASO skill doesn't mistake
    "Apple won't tell us" for "nobody searches this".

Endpoint portability:
  - The popularity score is delivered by the keyword-recommendations / search-
    match tooling. Apple gates the exact path behind JS docs and has renamed it
    across versions, so the request path and the response field names are
    CONFIGURABLE (POPULARITY_PATH + the field-name candidate lists below).
    If Apple's shape shifts, it's a constant change here, not a rewrite — and
    the unit tests pin the parsing against a recorded-shape mock.

NO secrets live in this file. Credentials come from the environment:
    ASA_ORG_ID, ASA_CLIENT_ID, ASA_CLIENT_SECRET
(or ASA_ACCESS_TOKEN directly, to skip the token exchange).
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

# ── Endpoints / constants (Apple, confirmed) ────────────────────────────────
TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token"
API_BASE = "https://api.searchads.apple.com/api/v5"
OAUTH_SCOPE = "searchadsorg"

# The keyword-recommendations / search-match path that carries the SP score.
# Overridable via ASA_POPULARITY_PATH if Apple renames it.
POPULARITY_PATH = os.environ.get("ASA_POPULARITY_PATH", "/keywords/recommendations")

# Apple stopped returning SP < 35 in Oct 2025; below this, the API is silent.
SP_FLOOR = 35

# Response field-name candidates (Apple has used several across versions).
_POPULARITY_FIELDS = ("searchVolume", "popularity", "volume", "searchPopularity")
_KEYWORD_FIELDS = ("keyword", "text", "term", "keywordText")


class AppleSearchAdsError(RuntimeError):
    """Any failure talking to the Apple Search Ads API."""


class MissingCredentials(AppleSearchAdsError):
    """Required env credentials were not set."""


@dataclass
class Popularity:
    """One keyword's Search Popularity result.

    `score` is 5–100 when Apple returns it; None means below_threshold
    (Apple withholds SP < 35) — which is NOT zero demand, just unreported.
    """

    keyword: str
    score: int | None
    below_threshold: bool = False
    market_area: str = "US"
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def reported(self) -> bool:
        return self.score is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "keyword": self.keyword,
            "score": self.score,
            "below_threshold": self.below_threshold,
            "market_area": self.market_area,
        }


# ── HTTP helper (stdlib only, matching repo house style) ─────────────────────
def _post_json(url: str, payload: dict | str, headers: dict[str, str],
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
        detail = e.read().decode(errors="replace")[:500]
        raise AppleSearchAdsError(f"HTTP {e.code} from {url}: {detail}") from e
    except urllib.error.URLError as e:
        raise AppleSearchAdsError(f"network error to {url}: {e.reason}") from e
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise AppleSearchAdsError(f"non-JSON response from {url}: {body[:200]}") from e


class AppleSearchAdsClient:
    """Thin client for the one thing we need: keyword Search Popularity.

    Pass credentials explicitly, or call `from_env()`. For tests, inject
    `transport` — a callable (url, payload, headers, form) -> dict — to bypass
    the network entirely.
    """

    def __init__(self, org_id: str, client_id: str = "", client_secret: str = "",
                 access_token: str = "", *, transport=None):
        self.org_id = str(org_id)
        self.client_id = client_id
        self.client_secret = client_secret
        self._token = access_token
        self._token_exp = 0.0
        self._transport = transport or _post_json

    # -- construction -------------------------------------------------------
    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, *, transport=None):
        env = env or dict(os.environ)
        org = env.get("ASA_ORG_ID", "").strip()
        if not org:
            raise MissingCredentials("ASA_ORG_ID is required")
        token = env.get("ASA_ACCESS_TOKEN", "").strip()
        cid = env.get("ASA_CLIENT_ID", "").strip()
        secret = env.get("ASA_CLIENT_SECRET", "").strip()
        if not token and not (cid and secret):
            raise MissingCredentials(
                "set ASA_ACCESS_TOKEN, or both ASA_CLIENT_ID and ASA_CLIENT_SECRET")
        return cls(org, cid, secret, token, transport=transport)

    # -- auth ---------------------------------------------------------------
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        if not (self.client_id and self.client_secret):
            if self._token:  # static token, no refresh material — use as-is
                return self._token
            raise MissingCredentials("no client_id/client_secret to mint a token")
        resp = self._transport(
            TOKEN_URL,
            {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": OAUTH_SCOPE,
            },
            {"Host": "appleid.apple.com"},
            form=True,
        )
        token = resp.get("access_token")
        if not token:
            raise AppleSearchAdsError(f"token response missing access_token: {resp}")
        self._token = token
        self._token_exp = time.time() + int(resp.get("expires_in", 3600))
        return token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._access_token()}",
            "X-AP-Context": f"orgId={self.org_id}",
        }

    # -- the one call we need ----------------------------------------------
    def popularity(self, keywords: Iterable[str], *, market_area: str = "US",
                   match_type: str = "EXACT") -> list[Popularity]:
        """Return Search Popularity (5–100) for each keyword.

        Keywords Apple withholds (SP < 35 since Oct 2025) come back with
        score=None, below_threshold=True — never 0.
        """
        terms = [k.strip() for k in keywords if k and k.strip()]
        if not terms:
            return []
        payload = {
            "selector": {
                "keywords": [{"text": t, "matchType": match_type} for t in terms]
            },
            "marketArea": market_area,
        }
        resp = self._transport(
            API_BASE + POPULARITY_PATH, payload, self._headers())
        return self._parse(resp, terms, market_area)

    # -- response parsing (defensive across Apple's field renames) ----------
    @staticmethod
    def _pick(d: dict, names: tuple[str, ...]):
        for n in names:
            if n in d and d[n] is not None:
                return d[n]
        return None

    @classmethod
    def _parse(cls, resp: dict, requested: list[str],
               market_area: str) -> list[Popularity]:
        rows = resp.get("data")
        if isinstance(rows, dict):  # some shapes nest under data.recommendations
            rows = rows.get("recommendations") or rows.get("keywords") or [rows]
        if not isinstance(rows, list):
            rows = []

        by_kw: dict[str, Popularity] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            kw = cls._pick(row, _KEYWORD_FIELDS)
            score = cls._pick(row, _POPULARITY_FIELDS)
            if kw is None:
                continue
            kw_s = str(kw).strip()
            iscore = None
            if score is not None:
                try:
                    iscore = int(round(float(score)))
                except (TypeError, ValueError):
                    iscore = None
            by_kw[kw_s.lower()] = Popularity(
                keyword=kw_s,
                score=iscore,
                below_threshold=(iscore is None or iscore < SP_FLOOR),
                market_area=market_area,
                raw=row,
            )

        # Every requested keyword gets a result row; ones Apple omitted entirely
        # are below_threshold (its Oct-2025 behavior), not errors.
        out: list[Popularity] = []
        for t in requested:
            hit = by_kw.get(t.lower())
            if hit is not None:
                out.append(hit)
            else:
                out.append(Popularity(keyword=t, score=None,
                                      below_threshold=True,
                                      market_area=market_area))
        return out


def normalize_to_volume(score: int | None) -> float:
    """Map a 5–100 SP score → the 0–100 `volume` axis the ASO skill scores on.

    SP is exponential, so a raw linear pass would understate the gap between
    head and tail terms. We keep the identity-ish mapping (SP already 0–100-ish)
    but floor unreported keywords at a small non-zero value: Apple withholding
    SP < 35 means "low, not none" — a winnable long-tail signal, not dead.
    """
    if score is None:
        return 15.0  # below_threshold: real but low; not 0
    return float(max(5, min(100, score)))
