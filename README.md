# Options Data Fetcher / 期权数据获取工具

中文：这是一个独立的数据获取与本地预览工具，用来抓取 Gexbot 和 SpotGamma 的核心期权数据，保存为本地 JSON，并在浏览器里查看当前结果。  
English: This is a standalone data fetcher and local viewer for collecting core Gexbot and SpotGamma options data, saving it as local JSON, and reviewing the current result in a browser.

中文：本工具不接 TradingHub，不包含数据库、用户系统、Dashboard 后台、自动交易或下单能力。  
English: This tool does not integrate with TradingHub yet and does not include databases, user systems, dashboards, automated trading, or order placement.

## 当前状态 / Current Status

已实现 / Implemented:

- Gexbot supported tickers
- Gexbot classic levels / majors
- Gexbot state greeks chart data
- Gexbot orderflow
- SpotGamma authenticated HTTP login
- SpotGamma Squeeze Candidates scanner fetch
- SpotGamma per-symbol detail fetch through `v3/equitiesBySyms`
- SpotGamma manual JSON/CSV import as emergency fallback
- Raw response and normalized latest JSON output
- Local live viewer at `http://localhost:8765/`
- Viewer button that triggers a real `fetch-all`
- Light/dark mode in the viewer
- Normalization self-test

暂未实现 / Not implemented:

- TradingHub integration
- Database writes
- Hosted production dashboard
- SpotGamma Playwright browser export

## 安装 / Setup

在仓库根目录运行 / Run from the repository root:

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

编辑 `.env` / Edit `.env`:

```dotenv
GEXBOT_BASE_URL=https://api.gex.bot/v2
GEXBOT_API_KEY=
GEXBOT_TICKERS=SPX,NDX,ES_SPX,NQ_NDX,SPY,QQQ,NVDA,TSLA,AAPL,MSFT,GLD,IBIT
GEXBOT_CLASSIC_CATEGORY=gex_full
GEXBOT_STATE_CATEGORY=gamma
GEXBOT_ORDERFLOW_CATEGORY=orderflow

SPOTGAMMA_BASE_URL=https://api.spotgamma.com
SPOTGAMMA_MODE=http
SPOTGAMMA_MANUAL_INPUT=
SPOTGAMMA_USERNAME=
SPOTGAMMA_PASSWORD=
SPOTGAMMA_COOKIE=
SPOTGAMMA_SESSION_FILE=data/session/spotgamma-session.json
```

中文：不要提交真实 `.env`、API key、密码、cookie、token 或 session 文件。  
English: Do not commit real `.env`, API keys, passwords, cookies, tokens, or session files.

## 命令 / Commands

```bash
python src/main.py fetch-gexbot
python src/main.py fetch-spotgamma
python src/main.py fetch-all
python src/main.py normalize-test
python src/main.py serve
python src/main.py install-spotgamma-task
python src/main.py build-gex-proxy
```

打开本地页面 / Open the local viewer:

```text
http://localhost:8765/
```

中文：页面里的 `Fetch Live Data` 只刷新 Stock Details，不会抓取新的 Squeezing Scanner。`Reload JSON` 只重新读取本地已有 JSON。  
English: The `Fetch Live Data` button refreshes Stock Details only and does not fetch new Squeezing Scanner data. `Reload JSON` only reloads the existing local JSON files.

中文：不要直接用 `file:///.../index.html` 作为主要入口；浏览器会限制本地 JSON/API 请求。若误打开 file 页面，页面会尝试连接 `http://127.0.0.1:8765/`，但仍需要先运行 `python src/main.py serve`。  
English: Do not use `file:///.../index.html` as the main entry. Browsers restrict local JSON/API requests. If the file page is opened by mistake, it will try `http://127.0.0.1:8765/`, but `python src/main.py serve` must still be running.

中文：`install-spotgamma-task` 会安装本机登录启动脚本，后台运行 `schedule-spotgamma`，每天 America/New_York 时间 09:31 自动抓取 Squeezing Scanner 数据，并按日期保存历史快照供前端回看。  
English: `install-spotgamma-task` installs a local startup script that runs `schedule-spotgamma` in the background, fetches Squeezing Scanner data daily at 09:31 America/New_York, and saves date-based snapshots for review in the viewer.

## Gexbot

本地开发文档 / Local API notes:

- `docs/gexbot-api.md`

已接入 endpoint / Implemented endpoints:

- `GET /tickers`
- `GET /{ticker}/classic/{category}/majors`
- `GET /{ticker}/state/{category}`
- `GET /{ticker}/orderflow/{category}`

默认 category / Default categories:

- classic: `gex_full`
- state: `gamma`
- orderflow: `orderflow`

中文：Gexbot API key 必须从 `.env` 读取，程序不会打印完整 `Authorization` header。  
English: The Gexbot API key must be read from `.env`. The full `Authorization` header is never printed.

## GEX Proxy / Gamma Ladder

中文：`fetch-gexbot` 会读取 state greeks 里的 `mini_contracts`，生成标准化 GEX Proxy 模型和 Gamma Ladder 数据。  
English: `fetch-gexbot` reads `mini_contracts` from state greeks and builds normalized GEX Proxy models plus Gamma Ladder data.

输出文件 / Output file:

- `data/normalized/gex-proxy-latest.json`

独立建模命令 / Standalone model command:

```bash
python src/main.py build-gex-proxy --input data/normalized/gexbot-state-greeks-latest.json --output data/normalized/gex-proxy-latest.json
```

模型内容 / Model contents:

- normalized ladder rows: `strike`, `gamma`, `abs_gamma`, `side`, `distance_from_spot`, `dte_values`
- derived metrics: net gamma, positive gamma, negative gamma, absolute gamma, zero-gamma proxy, largest positive/negative strike
- viewer chart: `Stock Details -> Gamma Ladder`

## SpotGamma

默认模式 / Default mode:

```dotenv
SPOTGAMMA_MODE=http
```

自动抓取流程 / Automatic fetch flow:

1. `POST https://api.spotgamma.com/v1/login`
2. `GET https://api.spotgamma.com/v1/equityScanners`
3. Extract Squeeze Candidates
4. `GET https://api.spotgamma.com/v3/equitiesBySyms?syms=...&date=...`
5. Merge scanner + detail payloads
6. Normalize to stable snake_case JSON

中文：`SPOTGAMMA_SESSION_FILE` 是可选 token 缓存。文件不存在时会重新登录并创建缓存；缓存失效时会重新登录。  
English: `SPOTGAMMA_SESSION_FILE` is an optional token cache. If it does not exist, the tool logs in and creates it; if it expires, the tool logs in again.

中文：raw 输出不会保存密码、cookie 或 Authorization header。  
English: Raw output does not store passwords, cookies, or Authorization headers.

## 手动导入备用 / Manual Fallback

中文：自动接口不可用时，可以临时切回手动导入。  
English: If the automatic endpoint is unavailable, manual import remains available as a fallback.

```dotenv
SPOTGAMMA_MODE=manual
SPOTGAMMA_MANUAL_INPUT=data/samples/spotgamma-squeeze-sample.json
```

JSON format:

```json
{
  "squeeze_candidates": [
    {
      "ticker": "PFE",
      "company_name": "Pfizer Inc",
      "Current Price": "$25.65",
      "Daily Change": "0.16%",
      "Previous Close": "$25.61"
    }
  ]
}
```

CSV format:

```csv
ticker,company_name,Current Price,Daily Change,Previous Close
PFE,Pfizer Inc,$25.65,0.16%,$25.61
```

## 输出文件 / Output Files

Raw files:

- `data/raw/gexbot-tickers-{timestamp}.json`
- `data/raw/gexbot-levels-{timestamp}.json`
- `data/raw/gexbot-state-greeks-{timestamp}.json`
- `data/raw/gexbot-orderflow-{timestamp}.json`
- `data/raw/spotgamma-squeeze-{timestamp}.json`

Normalized files:

- `data/normalized/gexbot-tickers-latest.json`
- `data/normalized/gexbot-levels-latest.json`
- `data/normalized/gexbot-state-greeks-latest.json`
- `data/normalized/gexbot-orderflow-latest.json`
- `data/normalized/spotgamma-squeeze-candidates-latest.json`
- `data/normalized/options-data-latest.json`

中文：`data/raw/`、`data/normalized/`、`data/session/` 和 `data/scheduler/` 默认被 `.gitignore` 忽略，不提交真实第三方数据或本地日志。  
English: `data/raw/`, `data/normalized/`, `data/session/`, and `data/scheduler/` are ignored by `.gitignore` by default. Do not commit real third-party data or local logs.

## 标准化字段 / Normalized Fields

SpotGamma candidate output:

```json
{
  "ticker": "PFE",
  "company_name": "Pfizer Inc",
  "current_price": 25.65,
  "daily_change_percent": 0.16,
  "previous_close": 25.61,
  "earnings_date": null,
  "call_wall": 27,
  "put_wall": 25,
  "skew_rank": 89.2,
  "iv_rank": 19.43,
  "call_gamma": -387750000,
  "put_gamma": -380760000,
  "top_gamma_exp": "2026-06-19",
  "top_delta_exp": "2028-01-22",
  "call_volume": 192440,
  "put_volume": 42780,
  "put_call_oi_ratio": 0.88,
  "one_month_rv": 16.39,
  "one_month_iv": 21.26,
  "garch_rank": 11.29,
  "options_implied_move": 0.34
}
```

Summary output:

```json
{
  "generated_at": "2026-06-09T00:00:00Z",
  "sources": {
    "gexbot": { "enabled": true, "ok": true, "error": null },
    "spotgamma": { "enabled": true, "ok": true, "error": null }
  },
  "gexbot": {
    "tickers": [],
    "levels": {},
    "state_greeks": {},
    "orderflow": {}
  },
  "spotgamma": {
    "squeeze_candidates": []
  }
}
```

## 安全 / Safety

- `.env` is ignored and must stay local.
- `data/raw/`, `data/normalized/`, and `data/session/` are ignored.
- Full API keys, passwords, cookies, tokens, and Authorization headers are never printed.
- No TradingHub, RiskManager, or Xianyu submodule code is changed by this tool.

## 后续接入 / Future TradingHub Integration

中文：后续 TradingHub 可以直接消费 `data/normalized/options-data-latest.json` 或各 source 的 latest JSON 文件。  
English: TradingHub can later consume `data/normalized/options-data-latest.json` or each source-specific latest JSON file.
