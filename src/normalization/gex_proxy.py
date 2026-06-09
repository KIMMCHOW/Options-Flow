from __future__ import annotations

from typing import Any, Dict, List, Optional


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _contract_to_level(contract: Any, spot: Optional[float]) -> Optional[Dict[str, Any]]:
    if not isinstance(contract, list) or len(contract) < 4:
        return None

    strike = _number(contract[0])
    current_value = _number(contract[3])
    if strike is None or current_value is None:
        return None

    lookback_values = contract[4] if len(contract) > 4 and isinstance(contract[4], list) else []
    distance = None if spot is None else strike - spot
    return {
        "strike": strike,
        "current_value": current_value,
        "gamma": current_value,
        "abs_value": abs(current_value),
        "abs_gamma": abs(current_value),
        "side": "positive" if current_value > 0 else "negative" if current_value < 0 else "neutral",
        "distance_from_spot": distance,
        "distance_percent": None if distance is None or not spot else distance / spot * 100,
        "lookback_values": lookback_values,
        "dte_values": lookback_values,
        "raw_row": contract,
    }


def _largest(levels: List[Dict[str, Any]], side: str) -> Optional[Dict[str, Any]]:
    filtered = [level for level in levels if level["side"] == side]
    if not filtered:
        return None
    return max(filtered, key=lambda item: item["abs_gamma"])


def _zero_gamma_proxy(levels: List[Dict[str, Any]], spot: Optional[float]) -> Optional[float]:
    if not levels:
        return None

    sorted_levels = sorted(levels, key=lambda item: item["strike"])
    for previous, current in zip(sorted_levels, sorted_levels[1:]):
        prev_gamma = previous["gamma"]
        current_gamma = current["gamma"]
        if prev_gamma == 0:
            return previous["strike"]
        if (prev_gamma < 0 < current_gamma) or (prev_gamma > 0 > current_gamma):
            span = current["strike"] - previous["strike"]
            if span == 0:
                return current["strike"]
            ratio = abs(prev_gamma) / (abs(prev_gamma) + abs(current_gamma))
            return previous["strike"] + span * ratio

    if spot is not None:
        return min(sorted_levels, key=lambda item: abs(item["strike"] - spot))["strike"]
    return sorted_levels[0]["strike"]


def build_gex_proxy_model(payload: Dict[str, Any]) -> Dict[str, Any]:
    spot = _number(payload.get("spot"))
    levels = [
        level
        for level in (_contract_to_level(contract, spot) for contract in payload.get("mini_contracts", []))
        if level is not None
    ]
    levels.sort(key=lambda item: item["strike"])

    positive_gamma = sum(level["gamma"] for level in levels if level["gamma"] > 0)
    negative_gamma = sum(level["gamma"] for level in levels if level["gamma"] < 0)
    net_gamma = positive_gamma + negative_gamma
    largest_positive = _largest(levels, "positive")
    largest_negative = _largest(levels, "negative")

    return {
        "timestamp": payload.get("timestamp"),
        "ticker": payload.get("ticker"),
        "spot": spot,
        "min_dte": payload.get("min_dte"),
        "sec_min_dte": payload.get("sec_min_dte"),
        "major_positive": payload.get("major_positive"),
        "major_negative": payload.get("major_negative"),
        "major_long_gamma": payload.get("major_long_gamma"),
        "major_short_gamma": payload.get("major_short_gamma"),
        "metrics": {
            "levels_count": len(levels),
            "positive_gamma": positive_gamma,
            "negative_gamma": negative_gamma,
            "net_gamma": net_gamma,
            "absolute_gamma": sum(level["abs_gamma"] for level in levels),
            "zero_gamma_proxy": _zero_gamma_proxy(levels, spot),
            "largest_positive_strike": largest_positive["strike"] if largest_positive else None,
            "largest_negative_strike": largest_negative["strike"] if largest_negative else None,
        },
        "ladder": levels,
    }


def build_gex_proxy_models(items: Dict[str, Any]) -> Dict[str, Any]:
    models: Dict[str, Any] = {}
    for ticker, payload in items.items():
        if isinstance(payload, dict) and isinstance(payload.get("mini_contracts"), list):
            models[ticker] = build_gex_proxy_model(payload)
    return models
