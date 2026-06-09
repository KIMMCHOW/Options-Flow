from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, List

from config.settings import SpotGammaSettings
from spotgamma.client import SpotGammaError


def _extract_candidates(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if isinstance(payload, dict):
        for key in ("squeeze_candidates", "candidates", "data", "rows", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]

    raise SpotGammaError("SpotGamma manual import must contain a list of candidate objects")


def load_manual_candidates(settings: SpotGammaSettings) -> Dict[str, Any]:
    if settings.mode != "manual":
        if settings.session_file is not None and not Path(settings.session_file).exists():
            raise SpotGammaError("SpotGamma session file not found")
        if settings.mode in {"http", "authenticated_http"}:
            raise SpotGammaError("SpotGamma authenticated HTTP mode should be handled by the HTTP client")
        if settings.mode in {"playwright", "browser"}:
            raise SpotGammaError("SpotGamma Playwright browser export mode is a placeholder; use manual mode for now")
        raise SpotGammaError(f"Unsupported SpotGamma mode: {settings.mode}")

    if settings.manual_input is None:
        raise SpotGammaError("SpotGamma mode is manual but input file is missing")

    path = Path(settings.manual_input)
    if not path.exists():
        raise SpotGammaError(f"SpotGamma manual input file not found: {path}")

    suffix = path.suffix.lower()
    if suffix == ".json":
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        return {"source_file": str(path), "candidates": _extract_candidates(payload)}

    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            rows = list(csv.DictReader(file))
        return {"source_file": str(path), "candidates": rows}

    raise SpotGammaError("SpotGamma manual import supports only .json and .csv files")
