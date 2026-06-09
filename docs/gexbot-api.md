# Gexbot API Local Notes

Updated: 2026-06-09

Sources:

- https://www.gexbot.com/apidocs
- https://github.com/nfa-llc/gexbot-openapi
- https://raw.githubusercontent.com/nfa-llc/gexbot-openapi/master/latest/gexbot.spec3.json

OpenAPI version: `3.0.1`
Gexbot spec version: `2.2.0`

## Base URL

```text
https://api.gex.bot/v2
```

## Authentication

Most endpoints require a production API key:

```http
Authorization: Bearer gexbot_custom_<secret>
Accept: application/json
User-Agent: options-data-fetcher/0.1
```

Important notes:

- `/tickers` is public and works without a key.
- The production data API accepts keys generated or regenerated from `https://app.gexbot.com`.
- Keys generated from `https://dev-app.gexbot.com` can log into the dev app but return `401` against `https://api.gex.bot/v2`.
- Do not print or commit the full key.

## Current Tool Config

```dotenv
GEXBOT_BASE_URL=https://api.gex.bot/v2
GEXBOT_API_KEY=
GEXBOT_TICKERS=SPX,NDX,ES_SPX,NQ_NDX,SPY,QQQ,NVDA,TSLA,AAPL,MSFT,GLD,IBIT
GEXBOT_CLASSIC_CATEGORY=gex_full
GEXBOT_STATE_CATEGORY=gamma
GEXBOT_ORDERFLOW_CATEGORY=orderflow
```

Classic and State categories are different enum sets. Do not use `gex_full` for State endpoints.

## Implemented Endpoints

### Tickers

```http
GET /tickers
```

Returns supported ticker symbols.

Tool outputs:

- raw: `data/raw/gexbot-tickers-{timestamp}.json`
- normalized: `data/normalized/gexbot-tickers-latest.json`

### Classic GEX Chart

```http
GET /{ticker}/classic/{category}
```

Classic category values:

- `full` or `gex_full`: full GEX aggregation
- `zero` or `gex_zero`: 0DTE
- `one` or `gex_one`: 1DTE

### Classic GEX Levels / Majors

```http
GET /{ticker}/classic/{category}/majors
```

Returns key GEX levels, including Zero Gamma and major positive/negative GEX by OI and Volume.

Tool outputs:

- raw: `data/raw/gexbot-levels-{timestamp}.json`
- normalized: `data/normalized/gexbot-levels-latest.json`

### State Greeks Chart

```http
GET /{ticker}/state/{category}
```

State category values:

- `delta` or `delta_zero`
- `gamma` or `gamma_zero`
- `vanna` or `vanna_zero`
- `charm` or `charm_zero`
- `onedelta` or `delta_one`
- `onegamma` or `gamma_one`
- `onevanna` or `vanna_one`
- `onecharm` or `charm_one`

Current default:

```dotenv
GEXBOT_STATE_CATEGORY=gamma
```

Tool outputs:

- raw: `data/raw/gexbot-state-greeks-{timestamp}.json`
- normalized: `data/normalized/gexbot-state-greeks-latest.json`

### Orderflow

```http
GET /{ticker}/orderflow/orderflow
```

Orderflow category values:

- `orderflow`

Tool outputs:

- raw: `data/raw/gexbot-orderflow-{timestamp}.json`
- normalized: `data/normalized/gexbot-orderflow-latest.json`

## Not Implemented Yet

### Max Change

```http
GET /{ticker}/classic/{category}/maxchange
GET /{ticker}/state/{category}/maxchange
```

Returns strikes with the most significant GEX change over various look-back periods.

### Historical Data

```http
GET /hist/{ticker}/{package}/{category}/{date}
```

Generates a historical data download URL. The documented look-back window is about 90 days.

Parameters:

- `ticker`
- `package`: `classic`, `state`, or `orderflow`
- `category`
- `date`: `YYYY-MM-DD`
- optional query `noredirect`: return JSON URL instead of 302 redirect
- optional header `Accept-Encoding: gzip`: request compressed data

This endpoint is Quant-related and is not part of this v1 tool.

### WebSocket Negotiate

```http
GET /negotiate
```

Negotiates real-time WebSocket feeds. The documented flow is:

1. Call `/negotiate`.
2. Receive connection URLs and a group prefix.
3. Connect to the desired hub.
4. Subscribe to groups.

Messages are documented as zstd-compressed Protobuf. Real-time feeds are not part of this v1 tool.

## Common Response Fields

Classic / State basic response fields include:

- `timestamp`
- `ticker`
- `min_dte`
- `sec_min_dte`
- `spot`
- `zero_gamma`
- `major_pos_vol`
- `major_pos_oi`
- `major_neg_vol`
- `major_neg_oi`
- `strikes`
- `sum_gex_vol`
- `sum_gex_oi`
- `delta_risk_reversal`
- `max_priors`

Orderflow response fields include:

- `timestamp`
- `ticker`
- `spot`
- `z_mlgamma`
- `z_msgamma`
- `o_mlgamma`
- `o_msgamma`
- `zero_mcall`
- `zero_mput`
- `one_mcall`
- `one_mput`
- `zcvr`
- `ocvr`
- `zgr`
- `ogr`
- `zvanna`
- `ovanna`
- `zcharm`
- `ocharm`
- `agg_dex`
- `one_agg_dex`
- `agg_call_dex`
- `one_agg_call_dex`
- `agg_put_dex`
- `one_agg_put_dex`
- `net_dex`
- `one_net_dex`
- `net_call_dex`
- `one_net_call_dex`
- `net_put_dex`
- `one_net_put_dex`
- `dexoflow`
- `gexoflow`
- `cvroflow`
- `one_dexoflow`
- `one_gexoflow`
- `one_cvroflow`
- `min_dte`
- `sec_min_dte`
- `zero_gamma`
- `major_pos_vol`
- `major_pos_oi`
- `major_neg_vol`
- `major_neg_oi`
- `strikes`
- `sum_gex_vol`
- `sum_gex_oi`
- `delta_risk_reversal`

The current tool stores these raw objects without forcing a deep schema.

## Error Codes

Documented responses:

- `200`: success
- `400`: invalid request, usually invalid path/category
- `401`: missing or invalid authentication
- `403`: subscription or permission issue

## Local Findings

As of 2026-06-09:

- `/tickers` works without authentication.
- The account level is `orderflow`.
- A key generated from `https://dev-app.gexbot.com` returned `401` against `https://api.gex.bot/v2`.
- A key regenerated from `https://app.gexbot.com` worked against `https://api.gex.bot/v2`.
- `python src/main.py fetch-gexbot` succeeded with the production key.

Production key flow:

```text
POST  https://app.gexbot.com/login
GET   https://app.gexbot.com/user/keys?product=gexbot&status=active&integration=custom
PATCH https://app.gexbot.com/user/keys
```

`PATCH /user/keys` body:

```json
{
  "product": "gexbot",
  "id": "<key-id-without-gexbot_custom_prefix>",
  "expires_in": 31536000
}
```

The returned `secret` is the value to write into `GEXBOT_API_KEY`.
