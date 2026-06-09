from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import json
from pathlib import Path
import time
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

from config.settings import SpotGammaSettings


SCANNER_ENDPOINT = "v1/equityScanners"
LOGIN_ENDPOINT = "v1/login"
ME_ENDPOINT = "v1/me/user"
DETAIL_ENDPOINT = "v3/equitiesBySyms"
DEFAULT_JSON_WEB_TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpYXQiOjE2NjgxMjgyNDJ9."
    "0VtbQW99MELrgb4JW56xtbRdh1LAbDBlB1T78dJlILA"
)

SQUEEZE_KEYS = {
    "squeeze",
    "squeeze_scanner",
    "squeezeScanner",
    "squeezeCandidates",
    "squeeze_candidates",
}

SQUEEZE_FIELD_HINTS = {
    "sym",
    "ticker",
    "cws",
    "pws",
    "keyg",
    "keyd",
    "maxfs",
    "next_exp_g",
    "next_exp_d",
    "max_exp_g_date",
    "max_exp_d_date",
    "ne_call_volume",
    "ne_put_volume",
    "put_call_ratio",
    "gamma_ratio",
    "delta_ratio",
    "tca_score",
}

TOKEN_KEYS = ("token", "access_token", "accessToken", "jwt", "id_token", "idToken")


class SpotGammaError(Exception):
    pass


@dataclass
class SpotGammaFetchResult:
    raw_payload: Dict[str, Any]
    candidates: List[Dict[str, Any]]


class SpotGammaClient:
    def __init__(self, settings: SpotGammaSettings, timeout_seconds: int = 30, max_attempts: int = 3) -> None:
        self.settings = settings
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max_attempts
        self.session = requests.Session()
        self.token: Optional[str] = None

    def fetch_squeeze_candidates(self) -> SpotGammaFetchResult:
        self._load_or_login()
        scanner_payload = self._get_json(SCANNER_ENDPOINT)
        scanner_candidates = extract_squeeze_candidates(scanner_payload)
        tickers = [ticker for ticker in unique_tickers(scanner_candidates) if ticker]
        detail_date = previous_market_date()
        details_payload: Any = {}

        if tickers:
            details_payload = self.fetch_details(tickers, detail_date)

        merged_candidates = merge_candidates(scanner_candidates, details_payload)
        return SpotGammaFetchResult(
            raw_payload={
                "mode": "http",
                "scanner_endpoint": SCANNER_ENDPOINT,
                "detail_endpoint": DETAIL_ENDPOINT,
                "detail_date": detail_date,
                "scanner": scanner_payload,
                "details": details_payload,
            },
            candidates=merged_candidates,
        )

    def fetch_details(self, tickers: Iterable[str], detail_date: str) -> Any:
        encoded = quote(",".join(tickers), safe=",")
        return self._get_json(f"{DETAIL_ENDPOINT}?syms={encoded}&date={detail_date}")

    def _load_or_login(self) -> None:
        if self.settings.session_file is not None and self.settings.session_file.exists():
            token = load_session_token(self.settings.session_file)
            if token:
                self.token = token
                try:
                    self._get_json(ME_ENDPOINT)
                    return
                except SpotGammaError:
                    self.token = None

        self.token = self._login()
        if self.settings.session_file is not None:
            save_session_token(self.settings.session_file, self.token)

    def _login(self) -> str:
        if not self.settings.username:
            raise SpotGammaError("SPOTGAMMA_USERNAME is missing")
        if not self.settings.password:
            raise SpotGammaError("SPOTGAMMA_PASSWORD is missing")

        payload = {"username": self.settings.username, "password": self.settings.password}
        response = self._request("POST", LOGIN_ENDPOINT, json_payload=payload, include_auth=False)
        try:
            data = response.json()
        except ValueError as exc:
            raise SpotGammaError("SpotGamma login response was not valid JSON") from exc

        token = find_token(data)
        if not token:
            raise SpotGammaError("SpotGamma login succeeded but no auth token was returned")
        return token

    def _get_json(self, endpoint: str) -> Any:
        response = self._request("GET", endpoint, include_auth=True)
        try:
            return response.json()
        except ValueError as exc:
            raise SpotGammaError(f"SpotGamma response from {endpoint} was not valid JSON") from exc

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        json_payload: Optional[Dict[str, Any]] = None,
        include_auth: bool,
    ) -> requests.Response:
        url = f"{self.settings.base_url}/{endpoint.lstrip('/')}"
        last_error: Optional[str] = None
        response: Optional[requests.Response] = None

        for attempt in range(1, self.max_attempts + 1):
            try:
                response = self.session.request(
                    method,
                    url,
                    headers=self._headers(include_auth),
                    json=json_payload,
                    timeout=self.timeout_seconds,
                )
                if response.status_code < 500:
                    break
                last_error = f"HTTP {response.status_code}: {response.text[:300]}"
            except requests.RequestException as exc:
                last_error = str(exc)

            if attempt < self.max_attempts:
                time.sleep(0.75 * attempt)

        if response is None:
            raise SpotGammaError(f"SpotGamma request failed: {last_error}")

        if response.status_code == 401:
            raise SpotGammaError("SpotGamma request failed with HTTP 401: login failed or session expired")
        if response.status_code == 403:
            raise SpotGammaError("SpotGamma request failed with HTTP 403: account does not have access to this endpoint")
        if response.status_code >= 400:
            raise SpotGammaError(
                f"SpotGamma request failed with HTTP {response.status_code}: {response.text[:300]}"
            )

        return response

    def _headers(self, include_auth: bool) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "App-Type": "web",
            "Version": "5455",
            "User-Agent": "options-data-fetcher/0.1",
            "x-json-web-token": DEFAULT_JSON_WEB_TOKEN,
        }
        if include_auth:
            if not self.token:
                raise SpotGammaError("SpotGamma auth token is missing")
            headers["Authorization"] = f"Bearer {self.token}"
        return headers


def find_token(payload: Any) -> Optional[str]:
    if isinstance(payload, str):
        return payload if looks_like_token(payload) else None
    if isinstance(payload, list):
        for item in payload:
            token = find_token(item)
            if token:
                return token
    if isinstance(payload, dict):
        for key in TOKEN_KEYS:
            value = payload.get(key)
            if isinstance(value, str) and looks_like_token(value):
                return value
        for value in payload.values():
            token = find_token(value)
            if token:
                return token
    return None


def looks_like_token(value: str) -> bool:
    return len(value) > 20 and "." in value


def load_session_token(path: Path) -> Optional[str]:
    if not path.exists():
        raise SpotGammaError("SpotGamma session file not found")
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError) as exc:
        raise SpotGammaError("SpotGamma session file could not be read") from exc

    token = find_token(payload)
    return token


def save_session_token(path: Path, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"token": token, "saved_at": datetime.utcnow().isoformat() + "Z"}
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
        file.write("\n")


def previous_market_date() -> str:
    current = datetime.now(ZoneInfo("America/New_York")).date() - timedelta(days=1)
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current.isoformat()


def unique_tickers(items: Iterable[Dict[str, Any]]) -> List[str]:
    tickers: List[str] = []
    seen = set()
    for item in items:
        raw = item.get("sym") or item.get("ticker") or item.get("symbol")
        if raw is None:
            continue
        ticker = str(raw).strip().upper()
        if ticker and ticker not in seen:
            tickers.append(ticker)
            seen.add(ticker)
    return tickers


def extract_squeeze_candidates(payload: Any) -> List[Dict[str, Any]]:
    candidates = _extract_from_named_squeeze(payload)
    if candidates:
        return candidates

    fallback = _extract_candidate_rows(payload)
    if fallback:
        return fallback

    raise SpotGammaError("SpotGamma Squeeze Candidates were not found in scanner response")


def _extract_from_named_squeeze(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            candidates = _extract_from_named_squeeze(item)
            if candidates:
                return candidates
        return []

    if not isinstance(payload, dict):
        return []

    for key, value in payload.items():
        if key in SQUEEZE_KEYS or "squeeze" in key.lower():
            rows = _coerce_rows(value)
            if rows:
                return rows

    label = " ".join(str(payload.get(key, "")) for key in ("name", "title", "id", "type", "scanner", "slug"))
    if "squeeze" in label.lower():
        rows = _coerce_rows(payload)
        if rows:
            return rows

    for value in payload.values():
        candidates = _extract_from_named_squeeze(value)
        if candidates:
            return candidates

    return []


def _extract_candidate_rows(payload: Any) -> List[Dict[str, Any]]:
    rows = _coerce_rows(payload)
    if rows:
        hinted = [row for row in rows if _is_squeeze_candidate(row)]
        if hinted:
            return hinted

    if isinstance(payload, dict):
        for value in payload.values():
            nested = _extract_candidate_rows(value)
            if nested:
                return nested
    if isinstance(payload, list):
        for value in payload:
            nested = _extract_candidate_rows(value)
            if nested:
                return nested

    return []


def _coerce_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("rows", "data", "items", "candidates", "results", "squeeze_candidates"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _is_squeeze_candidate(row: Dict[str, Any]) -> bool:
    keys = set(row.keys())
    return bool(keys.intersection(SQUEEZE_FIELD_HINTS)) and bool({"sym", "ticker", "symbol"}.intersection(keys))


def merge_candidates(scanner_candidates: List[Dict[str, Any]], details_payload: Any) -> List[Dict[str, Any]]:
    details_by_ticker = flatten_details(details_payload)
    merged: List[Dict[str, Any]] = []
    for candidate in scanner_candidates:
        ticker = str(candidate.get("sym") or candidate.get("ticker") or candidate.get("symbol") or "").upper()
        detail = details_by_ticker.get(ticker, {})
        merged.append({**candidate, **detail})
    return merged


def flatten_details(payload: Any) -> Dict[str, Dict[str, Any]]:
    output: Dict[str, Dict[str, Any]] = {}

    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, dict):
                ticker = str(value.get("sym") or value.get("ticker") or value.get("symbol") or key).upper()
                output[ticker] = value
            elif isinstance(value, list):
                output.update(flatten_details(value))
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                ticker = str(item.get("sym") or item.get("ticker") or item.get("symbol") or "").upper()
                if ticker:
                    output[ticker] = item

    return output
