from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv


DEFAULT_TICKERS = [
    "SPX",
    "NDX",
    "ES_SPX",
    "NQ_NDX",
    "SPY",
    "QQQ",
    "NVDA",
    "TSLA",
    "AAPL",
    "MSFT",
    "GLD",
    "IBIT",
]


@dataclass(frozen=True)
class GexbotSettings:
    base_url: str
    api_key: str
    tickers: List[str]
    classic_category: str
    state_category: str
    orderflow_category: str
    username: str
    password: str


@dataclass(frozen=True)
class RemoteSettings:
    host: str
    port: int
    username: str
    password: str


@dataclass(frozen=True)
class SpotGammaSettings:
    mode: str
    manual_input: Optional[Path]
    username: str
    password: str
    cookie: str
    session_file: Optional[Path]


@dataclass(frozen=True)
class Settings:
    root_dir: Path
    data_dir: Path
    raw_dir: Path
    normalized_dir: Path
    samples_dir: Path
    gexbot: GexbotSettings
    spotgamma: SpotGammaSettings
    remote: RemoteSettings


def _split_csv(value: str) -> List[str]:
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def _optional_path(value: str, root_dir: Path) -> Optional[Path]:
    if not value.strip():
        return None

    path = Path(value.strip())
    if path.is_absolute():
        return path
    return root_dir / path


def load_settings() -> Settings:
    root_dir = Path(__file__).resolve().parents[2]
    load_dotenv(root_dir / ".env")

    data_dir = root_dir / "data"
    raw_dir = data_dir / "raw"
    normalized_dir = data_dir / "normalized"
    samples_dir = data_dir / "samples"

    ticker_env = os.getenv("GEXBOT_TICKERS", ",".join(DEFAULT_TICKERS))
    tickers = _split_csv(ticker_env) or DEFAULT_TICKERS

    return Settings(
        root_dir=root_dir,
        data_dir=data_dir,
        raw_dir=raw_dir,
        normalized_dir=normalized_dir,
        samples_dir=samples_dir,
        gexbot=GexbotSettings(
            base_url=os.getenv("GEXBOT_BASE_URL", "https://api.gex.bot/v2").rstrip("/"),
            api_key=os.getenv("GEXBOT_API_KEY", "").strip(),
            tickers=tickers,
            classic_category=os.getenv("GEXBOT_CLASSIC_CATEGORY", "gex_full").strip(),
            state_category=os.getenv("GEXBOT_STATE_CATEGORY", "gamma").strip(),
            orderflow_category=os.getenv("GEXBOT_ORDERFLOW_CATEGORY", "orderflow").strip(),
            username=os.getenv("GEXBOT_USERNAME", "").strip(),
            password=os.getenv("GEXBOT_PASSWORD", "").strip(),
        ),
        spotgamma=SpotGammaSettings(
            mode=os.getenv("SPOTGAMMA_MODE", "manual").strip().lower(),
            manual_input=_optional_path(os.getenv("SPOTGAMMA_MANUAL_INPUT", ""), root_dir),
            username=os.getenv("SPOTGAMMA_USERNAME", "").strip(),
            password=os.getenv("SPOTGAMMA_PASSWORD", "").strip(),
            cookie=os.getenv("SPOTGAMMA_COOKIE", "").strip(),
            session_file=_optional_path(os.getenv("SPOTGAMMA_SESSION_FILE", ""), root_dir),
        ),
        remote=RemoteSettings(
            host=os.getenv("REMOTE_HOST", "").strip(),
            port=int(os.getenv("REMOTE_PORT", "22") or "22"),
            username=os.getenv("REMOTE_USERNAME", "").strip(),
            password=os.getenv("REMOTE_PASSWORD", "").strip(),
        ),
    )
