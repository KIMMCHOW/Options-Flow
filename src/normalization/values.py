from __future__ import annotations

from datetime import datetime
import math
import re
from typing import Any, Dict, Iterable, List, Optional


SPOTGAMMA_FIELDS = [
    "ticker",
    "company_name",
    "current_price",
    "daily_change_percent",
    "previous_close",
    "earnings_date",
    "call_wall",
    "put_wall",
    "skew_rank",
    "iv_rank",
    "call_gamma",
    "put_gamma",
    "top_gamma_exp",
    "top_delta_exp",
    "call_volume",
    "put_volume",
    "put_call_oi_ratio",
    "one_month_rv",
    "one_month_iv",
    "garch_rank",
    "options_implied_move",
]


FIELD_ALIASES = {
    "ticker": "ticker",
    "symbol": "ticker",
    "sym": "ticker",
    "company": "company_name",
    "company_name": "company_name",
    "company name": "company_name",
    "companyname": "company_name",
    "companyName": "company_name",
    "company_name_full": "company_name",
    "name": "company_name",
    "current_price": "current_price",
    "current price": "current_price",
    "price": "current_price",
    "upx": "current_price",
    "daily_change": "daily_change_percent",
    "daily change": "daily_change_percent",
    "daily_change_percent": "daily_change_percent",
    "daily change percent": "daily_change_percent",
    "dailychange": "daily_change_percent",
    "dailyChange": "daily_change_percent",
    "daily_pct_change": "daily_change_percent",
    "pct_change": "daily_change_percent",
    "percent_change": "daily_change_percent",
    "previous_close": "previous_close",
    "previous close": "previous_close",
    "prev_close": "previous_close",
    "prevclose": "previous_close",
    "prevClose": "previous_close",
    "previousClose": "previous_close",
    "earnings_date": "earnings_date",
    "earnings date": "earnings_date",
    "earningsdate": "earnings_date",
    "earningsDate": "earnings_date",
    "earnings_utc": "earnings_date",
    "call_wall": "call_wall",
    "call wall": "call_wall",
    "callwall": "call_wall",
    "callWall": "call_wall",
    "cws": "call_wall",
    "put_wall": "put_wall",
    "put wall": "put_wall",
    "putwall": "put_wall",
    "putWall": "put_wall",
    "pws": "put_wall",
    "skew_rank": "skew_rank",
    "skew rank": "skew_rank",
    "skewrank": "skew_rank",
    "skewRank": "skew_rank",
    "skew": "skew_rank",
    "ne_skew": "skew_rank",
    "iv_rank": "iv_rank",
    "iv rank": "iv_rank",
    "ivrank": "iv_rank",
    "ivRank": "iv_rank",
    "call_gamma": "call_gamma",
    "call gamma": "call_gamma",
    "callgamma": "call_gamma",
    "callGamma": "call_gamma",
    "atmgc": "call_gamma",
    "call_gamma_abs": "call_gamma",
    "put_gamma": "put_gamma",
    "put gamma": "put_gamma",
    "putgamma": "put_gamma",
    "putGamma": "put_gamma",
    "atmgp": "put_gamma",
    "put_gamma_abs": "put_gamma",
    "top_gamma_exp": "top_gamma_exp",
    "top gamma exp": "top_gamma_exp",
    "topgammaexp": "top_gamma_exp",
    "topGammaExp": "top_gamma_exp",
    "max_exp_g_date": "top_gamma_exp",
    "top_delta_exp": "top_delta_exp",
    "top delta exp": "top_delta_exp",
    "topdeltaexp": "top_delta_exp",
    "topDeltaExp": "top_delta_exp",
    "max_exp_d_date": "top_delta_exp",
    "call_volume": "call_volume",
    "call volume": "call_volume",
    "callvolume": "call_volume",
    "callVolume": "call_volume",
    "cv": "call_volume",
    "put_volume": "put_volume",
    "put volume": "put_volume",
    "putvolume": "put_volume",
    "putVolume": "put_volume",
    "pv": "put_volume",
    "put_call_oi_ratio": "put_call_oi_ratio",
    "put/call oi ratio": "put_call_oi_ratio",
    "put call oi ratio": "put_call_oi_ratio",
    "put_call_ratio": "put_call_oi_ratio",
    "putcallratio": "put_call_oi_ratio",
    "putCallRatio": "put_call_oi_ratio",
    "1_m_rv": "one_month_rv",
    "1 m rv": "one_month_rv",
    "1m rv": "one_month_rv",
    "one_month_rv": "one_month_rv",
    "rv30": "one_month_rv",
    "1_m_iv": "one_month_iv",
    "1 m iv": "one_month_iv",
    "1m iv": "one_month_iv",
    "one_month_iv": "one_month_iv",
    "iv30": "one_month_iv",
    "atm_iv30": "one_month_iv",
    "garch_rank": "garch_rank",
    "garch rank": "garch_rank",
    "garchrank": "garch_rank",
    "garchRank": "garch_rank",
    "options_implied_move": "options_implied_move",
    "options implied move": "options_implied_move",
    "optionsimpliedmove": "options_implied_move",
    "optionsImpliedMove": "options_implied_move",
}


DATE_FIELDS = {"earnings_date", "top_gamma_exp", "top_delta_exp"}
TEXT_FIELDS = {"ticker", "company_name"}


def parse_number_series(value: Any) -> List[float]:
    value = normalize_missing(value)
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        raw_items = value
    else:
        raw_items = str(value).split(",")

    numbers: List[float] = []
    for item in raw_items:
        number = normalize_number(item)
        if number is not None:
            numbers.append(float(number))
    return numbers


def normalize_key(key: str) -> str:
    cleaned = str(key).strip().replace("-", " ").replace(".", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    snake = cleaned.lower().replace("/", " ").replace("%", " percent")
    snake = re.sub(r"[^a-z0-9]+", "_", snake).strip("_")
    return FIELD_ALIASES.get(cleaned.lower(), FIELD_ALIASES.get(snake, snake))


def normalize_missing(value: Any) -> Optional[Any]:
    if value is None:
        return None
    if isinstance(value, str) and value.strip() in {"", "-"}:
        return None
    return value


def normalize_number(value: Any) -> Optional[float]:
    value = normalize_missing(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return value

    text = str(value).strip()
    if text in {"", "-"}:
        return None

    multiplier = 1
    if text[-1:].upper() in {"K", "M", "B", "T"}:
        suffix = text[-1:].upper()
        multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000, "T": 1_000_000_000_000}[suffix]
        text = text[:-1]

    text = text.replace("$", "").replace(",", "").replace("%", "").strip()
    text = text.replace("+", "")
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]

    try:
        result = float(text) * multiplier
    except ValueError:
        return None

    if float(result).is_integer():
        return int(result)
    return result


def normalize_date(value: Any) -> Optional[str]:
    value = normalize_missing(value)
    if value is None:
        return None
    text = str(value).strip()

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text

    if re.match(r"^\d{4}-\d{2}-\d{2}T", text):
        return text[:10]

    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def normalize_spotgamma_candidate(item: Dict[str, Any]) -> Dict[str, Any]:
    keyed: Dict[str, Any] = {}
    for key, value in item.items():
        normalized_key = normalize_key(key)
        keyed[normalized_key] = value

    output: Dict[str, Any] = {}
    for field in SPOTGAMMA_FIELDS:
        value = keyed.get(field)
        if field in TEXT_FIELDS:
            value = normalize_missing(value)
            output[field] = None if value is None else str(value).strip()
        elif field in DATE_FIELDS:
            output[field] = normalize_date(value)
        else:
            output[field] = normalize_number(value)

    if output["ticker"]:
        output["ticker"] = output["ticker"].upper()

    hist_prices = parse_number_series(keyed.get("hist_px"))
    if output["current_price"] is None and hist_prices:
        output["current_price"] = hist_prices[0]
    if output["previous_close"] is None and len(hist_prices) > 1:
        output["previous_close"] = hist_prices[1]
    if (
        output["daily_change_percent"] is None
        and output["current_price"] is not None
        and output["previous_close"] not in {None, 0}
    ):
        current_price = float(output["current_price"])
        previous_close = float(output["previous_close"])
        output["daily_change_percent"] = round(((current_price - previous_close) / previous_close) * 100, 4)

    return output


def normalize_spotgamma_candidates(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [normalize_spotgamma_candidate(item) for item in items]


def run_normalization_self_test() -> None:
    checks = [
        ("$25.65", 25.65),
        ("$0.34", 0.34),
        ("0.16%", 0.16),
        ("89.20%", 89.2),
        ("192.44K", 192440),
        ("42.78K", 42780),
        ("-387.75M", -387750000),
        ("-380.76M", -380760000),
        ("-", None),
        ("", None),
        (None, None),
    ]

    for raw, expected in checks:
        actual = normalize_number(raw)
        if actual != expected:
            raise AssertionError(f"normalize_number({raw!r}) => {actual!r}, expected {expected!r}")

    date = normalize_date("2026-06-19")
    if date != "2026-06-19":
        raise AssertionError(f"normalize_date failed: {date!r}")

    derived = normalize_spotgamma_candidate({"sym": "UMC", "upx": 19.98, "hist_px": "19.98,19.72"})
    if derived["current_price"] != 19.98:
        raise AssertionError(f"current_price derivation failed: {derived['current_price']!r}")
    if derived["previous_close"] != 19.72:
        raise AssertionError(f"previous_close derivation failed: {derived['previous_close']!r}")
    if derived["daily_change_percent"] != 1.3185:
        raise AssertionError(f"daily_change_percent derivation failed: {derived['daily_change_percent']!r}")
