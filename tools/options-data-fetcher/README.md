# Options Data Fetcher / 期权数据获取工具

中文：独立数据获取工具，先把 Gexbot 和 SpotGamma 数据保存为本地 JSON，后续再接 TradingHub。
English: A standalone data fetcher that stores Gexbot and SpotGamma options data as local JSON before future TradingHub integration.

中文：不包含前端、数据库、用户系统、Dashboard 或自动交易。
English: This tool does not include frontend pages, databases, user systems, dashboards, or automated trading.

## 当前状态 / Current Status

已实现 / Implemented:

- Gexbot `/tickers`
- Gexbot classic levels / majors
- Gexbot state greeks chart data
- Gexbot orderflow
- SpotGamma manual JSON/CSV import
- SpotGamma Squeeze Candidates normalization
- Raw response and normalized latest JSON output
- `options-data-latest.json` summary output
- Normalization self-test

暂未实现 / Placeholders:

- SpotGamma authenticated HTTP request
- SpotGamma Playwright browser export

中文：SpotGamma 暂时不硬写未知 endpoint，不做验证码或反爬绕过逻辑。
English: SpotGamma automation does not hardcode unknown endpoints and does not bypass CAPTCHA or anti-bot mechanisms.

## 安装 / Setup

```bash
cd tools/options-data-fetcher
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

SPOTGAMMA_MODE=manual
SPOTGAMMA_MANUAL_INPUT=data/samples/spotgamma-squeeze-sample.json
SPOTGAMMA_USERNAME=
SPOTGAMMA_PASSWORD=
SPOTGAMMA_COOKIE=
SPOTGAMMA_SESSION_FILE=
```

中文：不要提交真实 `.env`、API key、cookie 或 session 文件。
English: Do not commit real `.env`, API keys, cookies, or session files.

## 命令 / Commands

```bash
python src/main.py fetch-gexbot
python src/main.py fetch-spotgamma
python src/main.py fetch-all
python src/main.py normalize-test
```

中文：缺少 key 或输入文件时，程序会输出清晰错误，不会抛出大段 traceback。
English: When a key or input file is missing, the tool prints a clear error instead of a long traceback.

Examples:

- `GEXBOT_API_KEY is missing`
- `SpotGamma mode is manual but input file is missing`
- `SpotGamma manual input file not found: ...`

## Gexbot

中文：本地开发文档见 `docs/gexbot-api.md`。
English: Local development notes are in `docs/gexbot-api.md`.

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

中文：生产数据 API 使用 `https://api.gex.bot/v2`，key 应从 `https://app.gexbot.com` 后台生成或 regenerate。
English: The production data API uses `https://api.gex.bot/v2`; production keys should be generated or regenerated from `https://app.gexbot.com`.

## SpotGamma 手动导入 / SpotGamma Manual Import

当前稳定方案 / Current stable mode:

```dotenv
SPOTGAMMA_MODE=manual
```

支持 JSON / JSON format:

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

也支持数组 JSON / Array JSON is also supported:

```json
[
  {
    "ticker": "PFE",
    "Current Price": "$25.65"
  }
]
```

中文：CSV 也受支持，表头可以使用 SpotGamma 原始字段名或 snake_case 字段名。
English: CSV is also supported. Headers may use original SpotGamma labels or normalized snake_case names.

Samples:

- `data/samples/spotgamma-squeeze-sample.json`
- `data/samples/spotgamma-squeeze-sample.csv`

## 输出 / Output

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

中文：`data/raw/` 和 `data/normalized/` 默认被 `.gitignore` 忽略。
English: `data/raw/` and `data/normalized/` are ignored by default.

## SpotGamma 标准化字段 / Normalized SpotGamma Fields

单只股票输出结构 / Single ticker output shape:

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

标准化规则 / Normalization rules:

- `$25.65` -> `25.65`
- `0.16%` -> `0.16`
- `192.44K` -> `192440`
- `-387.75M` -> `-387750000`
- `-`, `""`, `undefined/null` -> `null`
- `2026-06-19` remains `2026-06-19`

## 汇总文件 / Summary JSON

`data/normalized/options-data-latest.json`:

```json
{
  "generated_at": "2026-06-09T00:00:00Z",
  "sources": {
    "gexbot": {
      "enabled": true,
      "ok": true,
      "error": null
    },
    "spotgamma": {
      "enabled": true,
      "ok": true,
      "error": null
    }
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

## 安全 / Security

- 不提交真实 `.env` / Do not commit real `.env`
- 不提交真实 raw 或 normalized 数据 / Do not commit real raw or normalized data
- 不在日志里打印完整 API key、cookie 或 session / Do not log full API keys, cookies, or sessions
- 不把第三方 raw response 直接当最终业务结构 / Do not treat third-party raw responses as the final business schema

## 后续接入 TradingHub / Later TradingHub Integration

中文：后续接 TradingHub 时，优先消费 `data/normalized/options-data-latest.json`，不要直接依赖第三方 raw response。
English: For future TradingHub integration, prefer consuming `data/normalized/options-data-latest.json` instead of depending directly on third-party raw responses.

中文：本工具可以作为独立 job、cron、CI task 或后台 worker 的数据生产端。
English: This tool can later run as a standalone job, cron task, CI task, or backend worker that produces normalized JSON for TradingHub or a database pipeline.
