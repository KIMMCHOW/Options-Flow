from __future__ import annotations

import argparse
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
from typing import Any, Dict, List, Optional

from config.settings import Settings, load_settings
from gexbot.client import GexbotClient, GexbotResponse
from normalization.values import normalize_spotgamma_candidates, run_normalization_self_test
from output.writer import ensure_output_dirs, write_json
from spotgamma.client import SpotGammaClient, SpotGammaError
from spotgamma.manual import load_manual_candidates


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def generated_at() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def source_status(enabled: bool, ok: bool, error: Optional[str]) -> Dict[str, Any]:
    return {"enabled": enabled, "ok": ok, "error": error}


def response_payload(response: GexbotResponse) -> Any:
    if response.ok:
        return response.data
    return {"ok": False, "error": response.error, "status_code": response.status_code}


def normalize_tickers(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(item).upper() for item in raw]
    if isinstance(raw, dict):
        tickers: List[str] = []
        for value in raw.values():
            if isinstance(value, list):
                tickers.extend(str(item).upper() for item in value)
        return sorted(set(tickers))
    return []


def run_fetch_gexbot(settings: Settings, write_summary: bool = True) -> Dict[str, Any]:
    ensure_output_dirs(settings.raw_dir, settings.normalized_dir)
    timestamp = utc_timestamp()
    client = GexbotClient(settings.gexbot)

    errors: List[str] = []
    raw_tickers_response = client.fetch_tickers()
    write_json(
        settings.raw_dir / f"gexbot-tickers-{timestamp}.json",
        response_payload(raw_tickers_response),
    )

    normalized_tickers = normalize_tickers(raw_tickers_response.data) if raw_tickers_response.ok else []
    if not raw_tickers_response.ok and raw_tickers_response.error:
        errors.append(f"tickers: {raw_tickers_response.error}")

    levels: Dict[str, Any] = {}
    state_greeks: Dict[str, Any] = {}
    orderflow: Dict[str, Any] = {}
    raw_levels_bundle: Dict[str, Any] = {}
    raw_state_bundle: Dict[str, Any] = {}
    raw_orderflow_bundle: Dict[str, Any] = {}

    if not settings.gexbot.api_key:
        missing_key = "GEXBOT_API_KEY is missing"
        errors.append(missing_key)
        raw_levels_bundle = {"ok": False, "error": missing_key}
        raw_state_bundle = {"ok": False, "error": missing_key}
        raw_orderflow_bundle = {"ok": False, "error": missing_key}
    else:
        for ticker in settings.gexbot.tickers:
            level_response = client.fetch_classic_levels(ticker)
            raw_levels_bundle[ticker] = response_payload(level_response)
            if level_response.ok:
                levels[ticker] = level_response.data
            elif level_response.error:
                errors.append(f"{ticker} levels: {level_response.error}")

            state_response = client.fetch_state_greeks(ticker)
            raw_state_bundle[ticker] = response_payload(state_response)
            if state_response.ok:
                state_greeks[ticker] = state_response.data
            elif state_response.error:
                errors.append(f"{ticker} state greeks: {state_response.error}")

            orderflow_response = client.fetch_orderflow(ticker)
            raw_orderflow_bundle[ticker] = response_payload(orderflow_response)
            if orderflow_response.ok:
                orderflow[ticker] = orderflow_response.data
            elif orderflow_response.error:
                errors.append(f"{ticker} orderflow: {orderflow_response.error}")

    write_json(settings.raw_dir / f"gexbot-levels-{timestamp}.json", raw_levels_bundle)
    write_json(settings.raw_dir / f"gexbot-state-greeks-{timestamp}.json", raw_state_bundle)
    write_json(settings.raw_dir / f"gexbot-orderflow-{timestamp}.json", raw_orderflow_bundle)

    write_json(settings.normalized_dir / "gexbot-tickers-latest.json", normalized_tickers)
    write_json(settings.normalized_dir / "gexbot-levels-latest.json", levels)
    write_json(settings.normalized_dir / "gexbot-state-greeks-latest.json", state_greeks)
    write_json(settings.normalized_dir / "gexbot-orderflow-latest.json", orderflow)

    result = {
        "source": source_status(True, not errors, "; ".join(errors) if errors else None),
        "gexbot": {
            "tickers": normalized_tickers,
            "levels": levels,
            "state_greeks": state_greeks,
            "orderflow": orderflow,
        },
        "raw_files": {
            "tickers": str(settings.raw_dir / f"gexbot-tickers-{timestamp}.json"),
            "levels": str(settings.raw_dir / f"gexbot-levels-{timestamp}.json"),
            "state_greeks": str(settings.raw_dir / f"gexbot-state-greeks-{timestamp}.json"),
            "orderflow": str(settings.raw_dir / f"gexbot-orderflow-{timestamp}.json"),
        },
    }

    if write_summary:
        write_options_summary(settings, gexbot_result=result, spotgamma_result=None)

    print_status("Gexbot", result["source"])
    return result


def run_fetch_spotgamma(settings: Settings, write_summary: bool = True) -> Dict[str, Any]:
    ensure_output_dirs(settings.raw_dir, settings.normalized_dir)
    timestamp = utc_timestamp()

    raw_payload: Dict[str, Any] = {}
    normalized_candidates: List[Dict[str, Any]] = []
    error: Optional[str] = None

    try:
        if settings.spotgamma.mode == "manual":
            raw_payload = load_manual_candidates(settings.spotgamma)
            normalized_candidates = normalize_spotgamma_candidates(raw_payload["candidates"])
        elif settings.spotgamma.mode in {"http", "authenticated_http"}:
            fetch_result = SpotGammaClient(settings.spotgamma).fetch_squeeze_candidates()
            raw_payload = fetch_result.raw_payload
            normalized_candidates = normalize_spotgamma_candidates(fetch_result.candidates)
        elif settings.spotgamma.mode in {"playwright", "browser"}:
            raise SpotGammaError("SpotGamma Playwright browser export mode is a placeholder; use SPOTGAMMA_MODE=http")
        else:
            raise SpotGammaError(f"Unsupported SpotGamma mode: {settings.spotgamma.mode}")
    except (SpotGammaError, OSError, ValueError) as exc:
        error = str(exc)
        raw_payload = {"ok": False, "error": error}

    write_json(settings.raw_dir / f"spotgamma-squeeze-{timestamp}.json", raw_payload)
    write_json(
        settings.normalized_dir / "spotgamma-squeeze-candidates-latest.json",
        normalized_candidates,
    )

    result = {
        "source": source_status(True, error is None, error),
        "spotgamma": {"squeeze_candidates": normalized_candidates},
        "raw_files": {"squeeze": str(settings.raw_dir / f"spotgamma-squeeze-{timestamp}.json")},
    }

    if write_summary:
        write_options_summary(settings, gexbot_result=None, spotgamma_result=result)

    print_status("SpotGamma", result["source"])
    return result


def write_options_summary(
    settings: Settings,
    gexbot_result: Optional[Dict[str, Any]],
    spotgamma_result: Optional[Dict[str, Any]],
) -> None:
    ensure_output_dirs(settings.raw_dir, settings.normalized_dir)

    gexbot_data = gexbot_result["gexbot"] if gexbot_result else {"tickers": [], "levels": {}, "state_greeks": {}, "orderflow": {}}
    spotgamma_data = spotgamma_result["spotgamma"] if spotgamma_result else {"squeeze_candidates": []}

    payload = {
        "generated_at": generated_at(),
        "sources": {
            "gexbot": gexbot_result["source"] if gexbot_result else source_status(True, False, "not run"),
            "spotgamma": spotgamma_result["source"] if spotgamma_result else source_status(True, False, "not run"),
        },
        "gexbot": {
            "tickers": gexbot_data.get("tickers", []),
            "levels": gexbot_data.get("levels", {}),
            "state_greeks": gexbot_data.get("state_greeks", {}),
            "orderflow": gexbot_data.get("orderflow", {}),
        },
        "spotgamma": {
            "squeeze_candidates": spotgamma_data.get("squeeze_candidates", []),
        },
    }
    write_json(settings.normalized_dir / "options-data-latest.json", payload)


def run_fetch_all(settings: Settings) -> None:
    gexbot_result = run_fetch_gexbot(settings, write_summary=False)
    spotgamma_result = run_fetch_spotgamma(settings, write_summary=False)
    write_options_summary(settings, gexbot_result=gexbot_result, spotgamma_result=spotgamma_result)


def read_latest_summary(settings: Settings) -> Dict[str, Any]:
    path = settings.normalized_dir / "options-data-latest.json"
    if not path.exists():
        return {
            "generated_at": None,
            "sources": {
                "gexbot": source_status(True, False, "not run"),
                "spotgamma": source_status(True, False, "not run"),
            },
            "gexbot": {"tickers": [], "levels": {}, "state_greeks": {}, "orderflow": {}},
            "spotgamma": {"squeeze_candidates": []},
        }
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


class OptionsDataRequestHandler(SimpleHTTPRequestHandler):
    settings: Settings

    def do_POST(self) -> None:
        if self.path != "/api/fetch-all":
            self.send_error(404, "Not found")
            return

        try:
            run_fetch_all(self.settings)
            summary = read_latest_summary(self.settings)
            sources = summary.get("sources", {})
            ok = all(source.get("ok") for source in sources.values() if isinstance(source, dict))
            errors = [
                f"{name}: {source.get('error')}"
                for name, source in sources.items()
                if isinstance(source, dict) and not source.get("ok") and source.get("error")
            ]
            payload = {"ok": ok, "error": "; ".join(errors) if errors else None, "summary": summary}
            status = 200
        except Exception as exc:  # Keep the local preview server alive on fetch failures.
            payload = {"ok": False, "error": str(exc), "summary": read_latest_summary(self.settings)}
            status = 500

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()


def run_serve(settings: Settings, host: str = "127.0.0.1", port: int = 8765) -> None:
    OptionsDataRequestHandler.settings = settings
    handler_class = partial(OptionsDataRequestHandler, directory=str(settings.root_dir))
    server = ThreadingHTTPServer((host, port), handler_class)
    print(f"Options Data Viewer: http://{host}:{port}/")
    print("POST /api/fetch-all will run a real live data fetch.")
    try:
        server.serve_forever()
    finally:
        server.server_close()


def print_status(name: str, status: Dict[str, Any]) -> None:
    if status["ok"]:
        print(f"{name}: ok")
    else:
        print(f"{name}: failed - {status['error']}")


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and normalize options data from Gexbot and SpotGamma.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("fetch-gexbot", help="Fetch Gexbot tickers, levels, state greeks, and orderflow.")
    subparsers.add_parser("fetch-spotgamma", help="Fetch and normalize SpotGamma Squeeze Candidates.")
    subparsers.add_parser("fetch-all", help="Run both Gexbot and SpotGamma fetchers.")
    subparsers.add_parser("normalize-test", help="Run normalization self-tests.")
    serve_parser = subparsers.add_parser("serve", help="Run the local data viewer and live fetch API.")
    serve_parser.add_argument("--host", default="127.0.0.1", help="Viewer host. Default: 127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8765, help="Viewer port. Default: 8765")

    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    settings = load_settings()

    try:
        if args.command == "fetch-gexbot":
            run_fetch_gexbot(settings)
        elif args.command == "fetch-spotgamma":
            run_fetch_spotgamma(settings)
        elif args.command == "fetch-all":
            run_fetch_all(settings)
        elif args.command == "normalize-test":
            run_normalization_self_test()
            print("normalize-test: ok")
        elif args.command == "serve":
            run_serve(settings, host=args.host, port=args.port)
        return 0
    except KeyboardInterrupt:
        print("Interrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
