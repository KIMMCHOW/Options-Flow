from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GexbotEndpoint:
    name: str
    path_template: str
    requires_auth: bool

    def path(self, **kwargs: str) -> str:
        return self.path_template.format(**kwargs)


ENDPOINTS = {
    "tickers": GexbotEndpoint("tickers", "/tickers", False),
    "classic_chart": GexbotEndpoint("classic_chart", "/{ticker}/classic/{category}", True),
    "classic_majors": GexbotEndpoint("classic_majors", "/{ticker}/classic/{category}/majors", True),
    "state_chart": GexbotEndpoint("state_chart", "/{ticker}/state/{category}", True),
    "state_majors": GexbotEndpoint("state_majors", "/{ticker}/state/{category}/majors", True),
    "orderflow": GexbotEndpoint("orderflow", "/{ticker}/orderflow/{category}", True),
}
