from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Dict, Optional

import requests

from config.gexbot_endpoints import ENDPOINTS, GexbotEndpoint
from config.settings import GexbotSettings


class GexbotError(Exception):
    pass


@dataclass
class GexbotResponse:
    ok: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    status_code: Optional[int] = None


class GexbotClient:
    def __init__(self, settings: GexbotSettings, timeout_seconds: int = 30, max_attempts: int = 3) -> None:
        self.settings = settings
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max_attempts

    def _headers(self, requires_auth: bool) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "options-data-fetcher/0.1",
        }
        if requires_auth:
            if not self.settings.api_key:
                raise GexbotError("GEXBOT_API_KEY is missing")
            headers["Authorization"] = f"Bearer {self.settings.api_key}"
        return headers

    def _get(self, endpoint: GexbotEndpoint, **path_args: str) -> GexbotResponse:
        url = f"{self.settings.base_url}{endpoint.path(**path_args)}"
        try:
            headers = self._headers(endpoint.requires_auth)
        except GexbotError as exc:
            return GexbotResponse(ok=False, error=str(exc))

        last_error: Optional[str] = None
        response: Optional[requests.Response] = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                response = requests.get(
                    url,
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
                if response.status_code < 500:
                    break
                last_error = f"HTTP {response.status_code}: {response.text[:500]}"
            except requests.RequestException as exc:
                last_error = str(exc)

            if attempt < self.max_attempts:
                time.sleep(0.75 * attempt)

        if response is None:
            return GexbotResponse(ok=False, error=f"Gexbot request failed: {last_error}")

        if response.status_code >= 400:
            return GexbotResponse(
                ok=False,
                status_code=response.status_code,
                error=f"Gexbot request failed with HTTP {response.status_code}: {response.text[:500]}",
            )

        try:
            data = response.json()
        except ValueError:
            return GexbotResponse(
                ok=False,
                status_code=response.status_code,
                error="Gexbot response was not valid JSON",
            )

        return GexbotResponse(ok=True, data=data, status_code=response.status_code)

    def fetch_tickers(self) -> GexbotResponse:
        return self._get(ENDPOINTS["tickers"])

    def fetch_classic_levels(self, ticker: str) -> GexbotResponse:
        return self._get(
            ENDPOINTS["classic_majors"],
            ticker=ticker,
            category=self.settings.classic_category,
        )

    def fetch_classic_chart(self, ticker: str) -> GexbotResponse:
        return self._get(
            ENDPOINTS["classic_chart"],
            ticker=ticker,
            category=self.settings.classic_category,
        )

    def fetch_state_greeks(self, ticker: str) -> GexbotResponse:
        return self._get(
            ENDPOINTS["state_chart"],
            ticker=ticker,
            category=self.settings.state_category,
        )

    def fetch_orderflow(self, ticker: str) -> GexbotResponse:
        return self._get(
            ENDPOINTS["orderflow"],
            ticker=ticker,
            category=self.settings.orderflow_category,
        )
