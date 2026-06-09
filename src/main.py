from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from config.settings import Settings, load_settings
from gexbot.client import GexbotClient, GexbotResponse
from normalization.gex_proxy import build_gex_proxy_models
from normalization.values import normalize_spotgamma_candidates, run_normalization_self_test
from output.writer import ensure_output_dirs, write_json
from spotgamma.client import SpotGammaClient, SpotGammaError
from spotgamma.manual import load_manual_candidates


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def generated_at() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def eastern_date() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def source_status(enabled: bool, ok: bool, error: Optional[str]) -> Dict[str, Any]:
    return {"enabled": enabled, "ok": ok, "error": error}


def write_squeezing_history(settings: Settings, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    history_dir = settings.normalized_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    date = eastern_date()
    generated = generated_at()
    filename = f"squeezing-scanner-{date}.json"
    snapshot_path = history_dir / filename
    snapshot = {
        "date": date,
        "generated_at": generated,
        "count": len(candidates),
        "candidates": candidates,
    }
    write_json(snapshot_path, snapshot)

    index_path = history_dir / "squeezing-scanner-index.json"
    existing_entries: List[Dict[str, Any]] = []
    if index_path.exists():
        try:
            with index_path.open("r", encoding="utf-8") as file:
                existing_payload = json.load(file)
            if isinstance(existing_payload, dict) and isinstance(existing_payload.get("entries"), list):
                existing_entries = [
                    item for item in existing_payload["entries"] if isinstance(item, dict) and item.get("date") != date
                ]
        except (OSError, ValueError):
            existing_entries = []

    entry = {
        "date": date,
        "generated_at": generated,
        "count": len(candidates),
        "path": f"data/normalized/history/{filename}",
    }
    entries = sorted([entry, *existing_entries], key=lambda item: str(item.get("date", "")), reverse=True)
    write_json(index_path, {"updated_at": generated, "entries": entries})
    return entry


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
    gex_proxy = build_gex_proxy_models(state_greeks)
    write_json(settings.normalized_dir / "gex-proxy-latest.json", gex_proxy)

    result = {
        "source": source_status(True, not errors, "; ".join(errors) if errors else None),
        "gexbot": {
            "tickers": normalized_tickers,
            "levels": levels,
            "state_greeks": state_greeks,
            "orderflow": orderflow,
            "gex_proxy": gex_proxy,
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
    history_entry: Optional[Dict[str, Any]] = None
    if error is None:
        history_entry = write_squeezing_history(settings, normalized_candidates)

    result = {
        "source": source_status(True, error is None, error),
        "spotgamma": {"squeeze_candidates": normalized_candidates},
        "raw_files": {"squeeze": str(settings.raw_dir / f"spotgamma-squeeze-{timestamp}.json")},
        "history": history_entry,
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


def run_build_gex_proxy(input_path: Path, output_path: Path) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Gexbot JSON input not found: {input_path}")
    with input_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    if isinstance(payload, dict) and isinstance(payload.get("mini_contracts"), list):
        ticker = str(payload.get("ticker") or "UNKNOWN").upper()
        models = {ticker: build_gex_proxy_models({ticker: payload})[ticker]}
    elif isinstance(payload, dict):
        models = build_gex_proxy_models(payload)
    else:
        raise ValueError("Gexbot JSON input must be an object or ticker-keyed object")

    write_json(output_path, models)
    print(f"gex-proxy: ok ({len(models)} ticker models) -> {output_path}")


def read_latest_squeezing_candidates(settings: Settings) -> List[Dict[str, Any]]:
    path = settings.normalized_dir / "spotgamma-squeeze-candidates-latest.json"
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def existing_spotgamma_result(settings: Settings) -> Dict[str, Any]:
    summary = read_latest_summary(settings)
    source = summary.get("sources", {}).get("spotgamma")
    candidates = read_latest_squeezing_candidates(settings)
    if not isinstance(source, dict):
        source = source_status(True, bool(candidates), None if candidates else "not run")
    elif candidates and not source.get("ok") and source.get("error") == "not run":
        source = source_status(True, True, None)
    return {
        "source": source,
        "spotgamma": {"squeeze_candidates": candidates},
        "raw_files": {},
    }


def scheduler_log(settings: Settings, message: str) -> None:
    log_path = settings.data_dir / "scheduler" / "spotgamma-scheduler.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    stamped = f"{generated_at()} {message}"
    with log_path.open("a", encoding="utf-8") as file:
        file.write(stamped + "\n")
    print(stamped, flush=True)


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform.startswith("win"):
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_scheduler_lock(settings: Settings) -> Optional[Path]:
    lock_path = settings.data_dir / "scheduler" / "spotgamma-scheduler.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    if lock_path.exists():
        try:
            existing_pid = int(lock_path.read_text(encoding="utf-8").strip())
        except ValueError:
            existing_pid = -1
        if process_exists(existing_pid):
            scheduler_log(settings, f"scheduler already running with pid={existing_pid}")
            return None
    lock_path.write_text(str(os.getpid()), encoding="utf-8")
    return lock_path


def next_spotgamma_run(now: Optional[datetime] = None) -> datetime:
    eastern = ZoneInfo("America/New_York")
    current = now.astimezone(eastern) if now else datetime.now(eastern)
    target = current.replace(hour=9, minute=31, second=0, microsecond=0)
    if target <= current:
        target += timedelta(days=1)
    return target


def run_spotgamma_scheduler(settings: Settings) -> None:
    lock_path = acquire_scheduler_lock(settings)
    if lock_path is None:
        return
    scheduler_log(settings, "SpotGamma daily scheduler started for 09:31 America/New_York")
    try:
        while True:
            target = next_spotgamma_run()
            scheduler_log(settings, f"next run at {target.isoformat()}")
            while True:
                now = datetime.now(ZoneInfo("America/New_York"))
                seconds = (target - now).total_seconds()
                if seconds <= 0:
                    break
                time.sleep(min(max(seconds, 1), 3600))

            scheduler_log(settings, "running scheduled SpotGamma fetch")
            try:
                result = run_fetch_spotgamma(settings)
                status = result.get("source", {})
                if status.get("ok"):
                    count = len(result.get("spotgamma", {}).get("squeeze_candidates", []))
                    scheduler_log(settings, f"scheduled SpotGamma fetch ok; candidates={count}")
                else:
                    scheduler_log(settings, f"scheduled SpotGamma fetch failed: {status.get('error')}")
            except Exception as exc:
                scheduler_log(settings, f"scheduled SpotGamma fetch crashed: {exc}")
    finally:
        try:
            if lock_path.exists() and lock_path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                lock_path.unlink()
        except OSError:
            pass


def install_spotgamma_task(settings: Settings, task_name: str = "OptionsFlow SpotGamma Scheduler") -> None:
    python_exe = Path(sys.executable)
    pythonw = python_exe.with_name("pythonw.exe")
    runner = pythonw if pythonw.exists() else python_exe
    script = settings.root_dir / "src" / "main.py"
    task_command = f'"{runner}" "{script}" schedule-spotgamma'

    try:
        subprocess.run(
            ["schtasks", "/Create", "/TN", task_name, "/SC", "ONLOGON", "/TR", task_command, "/F"],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(["schtasks", "/Run", "/TN", task_name], check=True, capture_output=True, text=True)
        print(f"Installed and started Windows task: {task_name}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        startup_dir = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        startup_dir.mkdir(parents=True, exist_ok=True)
        startup_script = startup_dir / "OptionsFlowSpotGammaScheduler.vbs"
        startup_script.write_text(
            'Set WshShell = CreateObject("WScript.Shell")\n'
            f'WshShell.Run """{runner}"" ""{script}"" schedule-spotgamma", 0, False\n',
            encoding="utf-8",
        )
        subprocess.Popen([str(runner), str(script), "schedule-spotgamma"])
        print(f"Task Scheduler was unavailable; installed startup script: {startup_script}")

    print("The local scheduler fetches SpotGamma daily at 09:31 America/New_York.")


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
        if self.path == "/api/fetch-all":
            self._run_fetch_api(include_scanner=True)
            return
        if self.path == "/api/fetch-stock-details":
            self._run_fetch_api(include_scanner=False)
            return
        self.send_error(404, "Not found")

    def _run_fetch_api(self, include_scanner: bool) -> None:
        try:
            if include_scanner:
                run_fetch_all(self.settings)
            else:
                gexbot_result = run_fetch_gexbot(self.settings, write_summary=False)
                write_options_summary(
                    self.settings,
                    gexbot_result=gexbot_result,
                    spotgamma_result=existing_spotgamma_result(self.settings),
                )
            summary = read_latest_summary(self.settings)
            sources = summary.get("sources", {})
            if include_scanner:
                checked_sources = [source for source in sources.values() if isinstance(source, dict)]
            else:
                stock_source = sources.get("gexbot")
                checked_sources = [stock_source] if isinstance(stock_source, dict) else []
            ok = all(source.get("ok") for source in checked_sources)
            errors = [
                f"{name}: {source.get('error')}"
                for name, source in sources.items()
                if isinstance(source, dict)
                and (include_scanner or name == "gexbot")
                and not source.get("ok")
                and source.get("error")
            ]
            payload = {"ok": ok, "error": "; ".join(errors) if errors else None, "summary": summary}
            status = 200
        except Exception as exc:  # Keep the local preview server alive on fetch failures.
            payload = {"ok": False, "error": str(exc), "summary": read_latest_summary(self.settings)}
            status = 500

        self._send_json(status, payload)

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/squeezing-history":
            index_path = self.settings.normalized_dir / "history" / "squeezing-scanner-index.json"
            if index_path.exists():
                with index_path.open("r", encoding="utf-8") as file:
                    payload = json.load(file)
            else:
                payload = {"updated_at": None, "entries": []}
            self._send_json(200, payload)
            return
        super().do_GET()

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
    print("POST /api/fetch-stock-details will refresh Stock Details only.")
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
    subparsers.add_parser("schedule-spotgamma", help="Run the 09:31 America/New_York SpotGamma scheduler loop.")
    subparsers.add_parser("install-spotgamma-task", help="Install and start the Windows SpotGamma scheduler task.")
    proxy_parser = subparsers.add_parser("build-gex-proxy", help="Build GEX Proxy / Gamma Ladder models from Gexbot JSON.")
    proxy_parser.add_argument(
        "--input",
        default="data/normalized/gexbot-state-greeks-latest.json",
        help="Input Gexbot JSON file.",
    )
    proxy_parser.add_argument(
        "--output",
        default="data/normalized/gex-proxy-latest.json",
        help="Output GEX Proxy JSON file.",
    )
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
        elif args.command == "schedule-spotgamma":
            run_spotgamma_scheduler(settings)
        elif args.command == "install-spotgamma-task":
            install_spotgamma_task(settings)
        elif args.command == "build-gex-proxy":
            run_build_gex_proxy(Path(args.input), Path(args.output))
        return 0
    except KeyboardInterrupt:
        print("Interrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
