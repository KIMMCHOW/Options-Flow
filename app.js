const LOCAL_SERVER = "http://127.0.0.1:8765/";
const isFilePage = window.location.protocol === "file:";
const sourceKeys = {
  stock: "gex" + "bot",
  scanner: "spot" + "gamma",
};

const files = {
  summary: "data/normalized/options-data-latest.json",
  candidates: "data/normalized/" + sourceKeys.scanner + "-squeeze-candidates-latest.json",
  candidateHistoryIndex: "data/normalized/history/squeezing-scanner-index.json",
  tickers: "data/normalized/" + sourceKeys.stock + "-tickers-latest.json",
  levels: "data/normalized/" + sourceKeys.stock + "-levels-latest.json",
  stateGreeks: "data/normalized/" + sourceKeys.stock + "-state-greeks-latest.json",
  gexProxy: "data/normalized/gex-proxy-latest.json",
  orderflow: "data/normalized/" + sourceKeys.stock + "-orderflow-latest.json",
};

const state = {
  summary: {},
  candidates: [],
  candidateHistory: [],
  selectedCandidateDate: "latest",
  tickers: [],
  stockTickers: [],
  levels: {},
  stateGreeks: {},
  gexProxy: {},
  orderflow: {},
  selectedTicker: null,
  selectedModel: null,
  loaded: {},
  lastFetchResult: {},
};

const $ = (id) => document.getElementById(id);
let gammaChartInstance = null;

/**
 * @typedef {Object} GammaLadderRow
 * @property {number} strike
 * @property {number} current_value
 * @property {number} abs_value
 * @property {string} side
 * @property {number|null} distance_from_spot
 * @property {number|null} distance_percent
 * @property {unknown[]} lookback_values
 * @property {unknown[]} raw_row
 *
 * @typedef {Object} OptionsTickerModel
 * @property {string} ticker
 * @property {number|null} spot
 * @property {number|null} timestamp
 * @property {string|null} captured_at_utc
 * @property {Object|null} levels
 * @property {Object|null} gamma_ladder
 * @property {Object|null} orderflow
 */

function resolveUrl(path) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return isFilePage ? new URL(path, LOCAL_SERVER).toString() : path;
}

function friendlyFetchError(error) {
  if (isFilePage) {
    return `${error.message}. Run "python src/main.py serve" and open http://127.0.0.1:8765/ for live data.`;
  }
  return error.message;
}

function initTheme() {
  const saved = localStorage.getItem("options-viewer-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? "dark" : "light");
  renderThemeButton();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("options-viewer-theme", next);
  renderThemeButton();
  disposeGammaChart();
  renderGammaLadder(state.selectedModel);
}

function renderThemeButton() {
  $("themeButton").textContent = document.documentElement.dataset.theme === "dark" ? "Light" : "Dark";
}

async function readJson(name, url) {
  const resolvedUrl = resolveUrl(url);
  try {
    const separator = resolvedUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${resolvedUrl}${separator}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    state.loaded[name] = { ok: true, path: resolvedUrl };
    return data;
  } catch (error) {
    state.loaded[name] = { ok: false, path: resolvedUrl, error: friendlyFetchError(error) };
    return name === "candidates" || name === "tickers" ? [] : {};
  }
}

async function loadData() {
  $("generatedAt").textContent = "Loading latest data...";
  const [summary, historyIndex, tickers, levels, stateGreeks, gexProxy, orderflow] = await Promise.all([
    readJson("summary", files.summary),
    readJson("candidateHistoryIndex", files.candidateHistoryIndex),
    readJson("tickers", files.tickers),
    readJson("levels", files.levels),
    readJson("stateGreeks", files.stateGreeks),
    readJson("gexProxy", files.gexProxy),
    readJson("orderflow", files.orderflow),
  ]);

  state.summary = summary || {};
  state.candidateHistory = Array.isArray(historyIndex.entries) ? historyIndex.entries : [];
  renderCandidateDateOptions();
  await loadCandidateDate(state.selectedCandidateDate);
  state.tickers = Array.isArray(tickers) ? tickers : [];
  state.levels = levels || {};
  state.stateGreeks = stateGreeks || {};
  state.gexProxy = gexProxy || {};
  state.orderflow = orderflow || {};
  state.stockTickers = state.tickers.filter(hasStockDetailData);
  state.selectedTicker = state.selectedTicker && state.stockTickers.includes(state.selectedTicker)
    ? state.selectedTicker
    : pickDefaultTicker();

  render();
}

async function loadCandidateDate(value) {
  state.selectedCandidateDate = value;
  if (value === "latest") {
    const payload = await readJson("candidates", files.candidates);
    state.candidates = Array.isArray(payload) ? payload : [];
    return;
  }

  const entry = state.candidateHistory.find((item) => item.date === value);
  if (!entry || !entry.path) {
    state.candidates = [];
    return;
  }

  const payload = await readJson(`candidates:${value}`, entry.path);
  state.candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
}

function renderCandidateDateOptions() {
  const select = $("candidateDate");
  const current = state.selectedCandidateDate;
  const options = ['<option value="latest">Latest</option>'];
  for (const entry of state.candidateHistory) {
    options.push(`<option value="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</option>`);
  }
  select.innerHTML = options.join("");
  select.value = current === "latest" || state.candidateHistory.some((entry) => entry.date === current)
    ? current
    : "latest";
  state.selectedCandidateDate = select.value;
}

async function fetchLiveData() {
  setBusy(true);
  $("lastAction").textContent = "Refreshing Stock Details. Squeezing Scanner is updated only by the scheduled task.";
  try {
    const response = await fetch(resolveUrl("api/fetch-stock-details"), { method: "POST", cache: "no-store" });
    const payload = await response.json();
    state.lastFetchResult = payload;
    if (!response.ok || !payload.ok) {
      $("lastAction").textContent = `Fetch failed: ${payload.error || response.status}`;
    } else {
      $("lastAction").textContent = "Stock Details refreshed. Squeezing Scanner was not fetched.";
    }
  } catch (error) {
    const message = friendlyFetchError(error);
    state.lastFetchResult = { ok: false, error: message };
    $("lastAction").textContent = `Fetch failed: ${message}`;
  } finally {
    await loadData();
    setBusy(false);
  }
}

function setBusy(isBusy) {
  $("fetchButton").disabled = isBusy;
  $("reloadButton").disabled = isBusy;
  $("fetchButton").textContent = isBusy ? "Fetching..." : "Fetch Live Data";
}

function pickDefaultTicker() {
  const preferred = ["SPX", "SPY", "QQQ", "NVDA", "TSLA"];
  return preferred.find((ticker) => state.stockTickers.includes(ticker)) || state.stockTickers[0] || null;
}

function render() {
  renderMetrics();
  renderCandidates();
  renderTickerList();
  renderTickerDetail();
  renderRawSummary();
}

function renderMetrics() {
  $("candidateCount").textContent = state.candidates.length;
  $("tickerCount").textContent = state.stockTickers.length;
  $("levelCount").textContent = Object.keys(state.levels).length;
  $("orderflowCount").textContent = Object.keys(state.orderflow).length;

  const generatedAt = state.summary.generated_at;
  const fileNote = isFilePage ? "file mode, using local server for data" : "server mode";
  $("generatedAt").textContent = generatedAt
    ? `Generated at ${generatedAt} (${fileNote})`
    : `Loaded at ${new Date().toISOString()} (${fileNote})`;
  renderStatusPill("stockStatus", "Stock Details", state.summary.sources?.[sourceKeys.stock]);
  renderStatusPill("candidateStatus", "Squeezing Scanner", state.summary.sources?.[sourceKeys.scanner]);
}

function renderStatusPill(id, label, status) {
  const element = $(id);
  const ok = Boolean(status && status.ok);
  const error = status && status.error ? ` - ${status.error}` : "";
  element.textContent = `${label}: ${ok ? "ok" : "failed"}${error}`;
  element.className = `statusPill ${ok ? "ok" : "failed"}`;
}

function renderCandidates() {
  const query = $("candidateSearch").value.trim().toLowerCase();
  const sortKey = $("candidateSort").value;
  const direction = $("candidateDirection").dataset.direction || "desc";
  const rows = state.candidates
    .filter((item) => String(item.ticker || "").toLowerCase().includes(query))
    .sort((a, b) => compareRows(a, b, sortKey, direction));

  $("candidateRows").innerHTML = rows.map(renderCandidateRow).join("");
}

function compareRows(a, b, key, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  if (key === "ticker") {
    return String(a.ticker || "").localeCompare(String(b.ticker || "")) * multiplier;
  }
  return (numericValue(a[key]) - numericValue(b[key])) * multiplier;
}

function renderCandidateRow(item) {
  return `
    <tr>
      <td class="tickerCell">${escapeHtml(item.ticker)}</td>
      <td class="number">${formatNumber(item.call_wall)}</td>
      <td class="number">${formatNumber(item.put_wall)}</td>
      <td class="number">${formatNumber(item.skew_rank)}</td>
      <td class="number">${formatNumber(item.iv_rank)}</td>
      <td class="number ${negativeClass(item.call_gamma)}">${formatCompact(item.call_gamma)}</td>
      <td class="number ${negativeClass(item.put_gamma)}">${formatCompact(item.put_gamma)}</td>
      <td>${escapeHtml(item.top_gamma_exp)}</td>
      <td>${escapeHtml(item.top_delta_exp)}</td>
      <td class="number">${formatCompact(item.call_volume)}</td>
      <td class="number">${formatCompact(item.put_volume)}</td>
      <td class="number">${formatPrice(item.options_implied_move)}</td>
    </tr>
  `;
}

function renderTickerList() {
  const query = $("tickerSearch").value.trim().toLowerCase();
  const tickers = state.stockTickers.filter((ticker) => String(ticker).toLowerCase().includes(query));
  $("tickerList").innerHTML = tickers.length
    ? tickers
    .map((ticker) => {
      const active = ticker === state.selectedTicker ? "active" : "";
      return `<button class="${active}" data-ticker="${escapeHtml(ticker)}">${escapeHtml(ticker)}</button>`;
    })
    .join("")
    : empty("No loaded ticker data.");
}

function hasStockDetailData(ticker) {
  return hasObjectData(state.levels[ticker])
    || hasObjectData(state.stateGreeks[ticker])
    || hasObjectData(state.orderflow[ticker]);
}

function hasObjectData(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function renderTickerDetail() {
  const ticker = state.selectedTicker;
  const model = ticker ? buildOptionsTickerModel(ticker) : null;
  state.selectedModel = model;

  $("selectedTicker").textContent = ticker || "Select a ticker";
  $("tickerMeta").textContent = model
    ? `Spot ${formatPrice(model.spot)} | Captured ${model.captured_at_utc || "-"}`
    : "No ticker selected.";
  $("tickerBadges").innerHTML = model
    ? [
        badge("Levels", model.levels),
        badge("Gamma Ladder", model.gamma_ladder),
        badge("Orderflow", model.orderflow),
      ].join("")
    : "";

  renderLevelsCards(model);
  renderGammaLadder(model);
  renderTopGammaTables(model);
  renderOrderflowCards(model);
  renderOrderflowCharts(model);
  renderRawPanels(ticker);
}

/** @returns {OptionsTickerModel|null} */
function buildOptionsTickerModel(ticker) {
  const levelsRaw = state.levels[ticker] || null;
  const stateRaw = state.stateGreeks[ticker] || null;
  const orderflowRaw = state.orderflow[ticker] || null;
  const timestamp = numberOrNull(levelsRaw?.timestamp ?? stateRaw?.timestamp ?? orderflowRaw?.timestamp);
  const spot = numberOrNull(levelsRaw?.spot ?? stateRaw?.spot ?? orderflowRaw?.spot);

  return {
    ticker,
    spot,
    timestamp,
    captured_at_utc: formatUtcTimestamp(timestamp),
    levels: levelsRaw ? buildLevelsModel(levelsRaw, spot) : null,
    gamma_ladder: stateRaw ? buildGammaLadderModel(stateRaw, levelsRaw, spot) : null,
    orderflow: orderflowRaw ? buildOrderflowModel(orderflowRaw) : null,
  };
}

function buildLevelsModel(raw, spot) {
  const zeroGamma = numberOrNull(raw.zero_gamma);
  return {
    raw,
    spot,
    zero_gamma: zeroGamma,
    zero_gamma_distance: distanceModel(zeroGamma, spot),
    mpos_vol: numberOrNull(raw.mpos_vol),
    mpos_oi: numberOrNull(raw.mpos_oi),
    mneg_vol: numberOrNull(raw.mneg_vol),
    mneg_oi: numberOrNull(raw.mneg_oi),
    net_gex_vol: numberOrNull(raw.net_gex_vol),
    net_gex_oi: numberOrNull(raw.net_gex_oi),
  };
}

function buildGammaLadderModel(raw, levelsRaw, spot) {
  const rows = Array.isArray(raw.mini_contracts)
    ? raw.mini_contracts.map((row) => contractToGammaRow(row, spot)).filter(Boolean)
    : [];
  rows.sort((a, b) => a.strike - b.strike);
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.current_value;
    row.cumulative_value = cumulative;
  }

  const positive = rows.filter((item) => item.current_value > 0);
  const negative = rows.filter((item) => item.current_value < 0);
  const topPositive = positive.slice().sort((a, b) => b.current_value - a.current_value).slice(0, 8);
  const topNegative = negative.slice().sort((a, b) => b.abs_value - a.abs_value).slice(0, 8);
  const topAbsolute = rows.slice().sort((a, b) => b.abs_value - a.abs_value).slice(0, 8);

  return {
    raw,
    rows,
    zero_gamma: numberOrNull(levelsRaw?.zero_gamma),
    major_positive: numberOrNull(raw.major_positive),
    major_negative: numberOrNull(raw.major_negative),
    major_long_gamma: numberOrNull(raw.major_long_gamma),
    major_short_gamma: numberOrNull(raw.major_short_gamma),
    min_dte: numberOrNull(raw.min_dte),
    sec_min_dte: numberOrNull(raw.sec_min_dte),
    metrics: {
      positive_gamma: sumBy(positive, "current_value"),
      negative_gamma: sumBy(negative, "current_value"),
      net_gamma: sumBy(rows, "current_value"),
      absolute_gamma: sumBy(rows, "abs_value"),
      levels_count: rows.length,
    },
    top_positive: topPositive,
    top_negative: topNegative,
    top_absolute: topAbsolute,
  };
}

function contractToGammaRow(row, spot) {
  if (!Array.isArray(row) || row.length < 4) {
    return null;
  }
  const strike = numberOrNull(row[0]);
  const currentNumber = numberOrNull(row[3]);
  if (strike === null) {
    return null;
  }
  const currentValue = currentNumber ?? 0;
  const distance = spot === null ? null : strike - spot;
  return {
    strike,
    current_value: currentValue,
    current_value_raw: currentNumber,
    cumulative_value: 0,
    abs_value: Math.abs(currentValue),
    side: currentValue > 0 ? "positive" : currentValue < 0 ? "negative" : "neutral",
    distance_from_spot: distance,
    distance_from_spot_percent: distance === null || !spot ? null : distance / spot * 100,
    distance_percent: distance === null || !spot ? null : distance / spot * 100,
    lookback_values: Array.isArray(row[4]) ? row[4] : [],
    raw: row,
    raw_row: row,
  };
}

function buildOrderflowModel(raw) {
  const normalized = { ...raw };
  normalized.zgex = numberOrNull(raw.zgex ?? raw.zgr);
  normalized.ogex = numberOrNull(raw.ogex ?? raw.ogr);
  return normalized;
}

function renderLevelsCards(model) {
  const levels = model?.levels;
  if (!levels) {
    $("levelsCards").innerHTML = empty("No levels data for this ticker.");
    return;
  }

  $("levelsCards").innerHTML = [
    metricCard("Spot", formatPrice(levels.spot)),
    metricCard("Zero Gamma", formatPrice(levels.zero_gamma), formatDistance(levels.zero_gamma_distance)),
    metricCard("Distance to Zero Gamma", formatDistance(levels.zero_gamma_distance), formatPercent(levels.zero_gamma_distance?.percent)),
    metricCard("MPos Vol", formatPrice(levels.mpos_vol)),
    metricCard("MPos OI", formatPrice(levels.mpos_oi)),
    metricCard("MNeg Vol", formatPrice(levels.mneg_vol)),
    metricCard("MNeg OI", formatPrice(levels.mneg_oi)),
    metricCard("Net GEX Vol", formatCompact(levels.net_gex_vol), null, negativeClass(levels.net_gex_vol)),
    metricCard("Net GEX OI", formatCompact(levels.net_gex_oi), null, negativeClass(levels.net_gex_oi)),
  ].join("");
}

function renderGammaLadder(model) {
  const ladder = model?.gamma_ladder;
  $("gammaTitle").textContent = model ? `${model.ticker} Gamma Ladder / GEX Proxy` : "Gamma Ladder / GEX Proxy";
  if (!ladder || ladder.rows.length === 0) {
    $("gammaMetrics").innerHTML = "";
    $("gammaSummaryCards").innerHTML = "";
    $("gammaChart").innerHTML = empty("No gamma ladder data.");
    disposeGammaChart();
    return;
  }

  const metrics = ladder.metrics || {};
  $("gammaMetrics").innerHTML = [
    metricBadge("Spot", formatPrice(model.spot)),
    metricBadge("Zero", formatPrice(ladder.zero_gamma)),
    metricBadge("Net", formatCompact(metrics.net_gamma), negativeClass(metrics.net_gamma)),
    metricBadge("Long", formatPrice(ladder.major_long_gamma)),
    metricBadge("Short", formatPrice(ladder.major_short_gamma)),
  ].join("");

  renderGammaSummaryCards(model, ladder);
  renderInteractiveGammaChart(model, ladder);
}

function renderGammaSummaryCards(model, ladder) {
  const metrics = ladder.metrics || {};
  $("gammaSummaryCards").innerHTML = [
    metricCard("Ticker", model.ticker),
    metricCard("Spot", formatPrice(model.spot)),
    metricCard("Zero Gamma", formatPrice(ladder.zero_gamma)),
    metricCard("Major Long Gamma", formatPrice(ladder.major_long_gamma)),
    metricCard("Major Short Gamma", formatPrice(ladder.major_short_gamma)),
    metricCard("Net Ladder Value", formatCompact(metrics.net_gamma), null, negativeClass(metrics.net_gamma)),
    metricCard("Positive Sum", formatCompact(metrics.positive_gamma)),
    metricCard("Negative Sum", formatCompact(metrics.negative_gamma), null, negativeClass(metrics.negative_gamma)),
    metricCard("Top Positive Strike", formatPrice(ladder.top_positive?.[0]?.strike)),
    metricCard("Top Negative Strike", formatPrice(ladder.top_negative?.[0]?.strike)),
  ].join("");
}

function renderInteractiveGammaChart(model, ladder) {
  if (!window.echarts) {
    $("gammaChart").innerHTML = empty("Interactive chart library did not load.");
    disposeGammaChart();
    return;
  }

  const chartElement = $("gammaChart");
  if (!gammaChartInstance) {
    chartElement.innerHTML = "";
    gammaChartInstance = echarts.init(chartElement, document.documentElement.dataset.theme === "dark" ? "dark" : null);
  }

  const controls = gammaChartControls();
  const rows = ladder.rows;
  const barMode = controls.barMode;
  const barData = rows.map((item) => [item.strike, barMode === "absolute" ? item.abs_value : item.current_value, item]);
  const lineData = rows.map((item) => [item.strike, item.cumulative_value, item]);
  const minStrike = Math.min(...rows.map((item) => item.strike));
  const maxStrike = Math.max(...rows.map((item) => item.strike));
  const initialZoom = gammaInitialZoom(rows, model.spot, $("gammaZoom").value);
  const markLines = buildGammaMarkLines(model, ladder, controls);
  const chartMarkLines = [
    {
      name: "0 Line",
      yAxis: 0,
      lineStyle: { color: "rgba(255,255,255,0.42)", type: "dotted" },
      label: { show: true, color: "#9ca3af", formatter: "0" },
    },
    ...markLines.map((line) => ({
      name: line.label,
      xAxis: line.value,
      lineStyle: { color: line.color, type: line.type || "dashed" },
      label: {
        show: true,
        color: line.color,
        rotate: 90,
        position: "insideEndTop",
        distance: 4,
        formatter: `${line.label} ${formatStrike(line.value)}`,
      },
    })),
  ];
  const topLabels = buildTopStrikeMarkPoints(ladder);

  gammaChartInstance.setOption({
    backgroundColor: "transparent",
    animation: false,
    color: ["#14b8a6", "#22c55e"],
    grid: { left: 62, right: 74, top: 54, bottom: 86, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", snap: true },
      confine: true,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.16)",
      backgroundColor: "rgba(5,6,7,0.94)",
      textStyle: { color: "#f8fafc", fontSize: 12 },
      extraCssText: "max-width:360px;white-space:normal;",
      formatter: (params) => gammaTooltip(params, model, ladder, markLines),
    },
    legend: {
      top: 12,
      textStyle: { color: axisLabelColor() },
      data: ["Gamma Proxy Line", "Strike Gamma Bars"],
      selected: { "Gamma Proxy Line": controls.showGammaProxyLine },
    },
    toolbox: {
      right: 12,
      top: 8,
      feature: {
        restore: {},
        saveAsImage: { backgroundColor: "#050607" },
      },
      iconStyle: { borderColor: axisLabelColor() },
    },
    xAxis: {
      type: "value",
      name: "Strike",
      min: minStrike,
      max: maxStrike,
      axisLabel: { color: axisLabelColor(), formatter: (value) => formatStrike(value) },
      axisLine: { lineStyle: { color: gridLineColor() } },
      splitLine: { show: true, lineStyle: { color: gridLineColor() } },
    },
    yAxis: [
      {
        type: "value",
        name: "Gamma Proxy Line",
        axisLabel: { color: axisLabelColor(), formatter: formatCompact },
        axisLine: { lineStyle: { color: "#14b8a6" } },
        splitLine: { show: true, lineStyle: { color: gridLineColor() } },
      },
      {
        type: "value",
        name: "Gamma Proxy Bars",
        axisLabel: { color: axisLabelColor(), formatter: formatCompact },
        axisLine: { lineStyle: { color: "#a78bfa" } },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        bottom: 18,
        height: 28,
        startValue: initialZoom.startValue,
        endValue: initialZoom.endValue,
        borderColor: gridLineColor(),
        textStyle: { color: axisLabelColor() },
        fillerColor: "rgba(20,184,166,0.18)",
        handleStyle: { color: "#14b8a6" },
      },
    ],
    series: [
      {
        name: "Gamma Proxy Line",
        type: "line",
        yAxisIndex: 0,
        data: lineData,
        smooth: controls.smoothLine,
        showSymbol: false,
        symbolSize: 4,
        lineStyle: { width: 2.2, color: "#14b8a6" },
      },
      {
        name: "Strike Gamma Bars",
        type: "bar",
        yAxisIndex: 1,
        data: barData,
        barMinWidth: 2,
        barMaxWidth: 12,
        itemStyle: {
          color: (params) => {
            const row = params.data?.[2];
            return row?.current_value >= 0 ? "#22c55e" : "#7c3aed";
          },
        },
        markPoint: {
          symbolSize: 42,
          label: { color: "#050607", fontWeight: 800, formatter: ({ name }) => name },
          itemStyle: { color: "#f59e0b" },
          data: topLabels,
        },
        markLine: {
          symbol: "none",
          silent: false,
          label: { show: false },
          lineStyle: { type: "dashed", width: 1.3 },
          data: chartMarkLines,
        },
      },
    ],
  }, true);
}

function disposeGammaChart() {
  if (gammaChartInstance) {
    gammaChartInstance.dispose();
    gammaChartInstance = null;
  }
}

function gammaChartControls() {
  return {
    showKeyLines: $("showKeyLines").checked,
    showSpot: $("showSpotLine").checked,
    showZeroGamma: $("showZeroGammaLine").checked,
    showMajorLines: $("showMajorLines").checked,
    showOrderflowLines: $("showOrderflowLines").checked,
    showWallLines: $("showWallLines").checked,
    showGammaProxyLine: $("showGammaProxyLine").checked,
    smoothLine: $("smoothGammaLine").checked,
    barMode: $("gammaBarMode").value,
  };
}

function gammaInitialZoom(rows, spot, mode) {
  const strikes = rows.map((item) => item.strike);
  if (!strikes.length) {
    return { startValue: 0, endValue: 0 };
  }
  if (mode === "near" && spot !== null) {
    const near = rows
      .slice()
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, 64)
      .map((item) => item.strike);
    return { startValue: Math.min(...near), endValue: Math.max(...near) };
  }
  if (mode === "top") {
    const top = rows
      .slice()
      .sort((a, b) => b.abs_value - a.abs_value)
      .slice(0, 64)
      .map((item) => item.strike);
    return { startValue: Math.min(...top), endValue: Math.max(...top) };
  }
  return { startValue: Math.min(...strikes), endValue: Math.max(...strikes) };
}

function buildGammaMarkLines(model, ladder, controls) {
  if (!controls.showKeyLines) {
    return [];
  }

  const levels = model.levels?.raw || {};
  const orderflow = model.orderflow || {};
  const lines = [];
  const add = (label, value, color, group, type = "dashed") => {
    const number = numberOrNull(value);
    if (number === null) {
      return;
    }
    lines.push({ label, value: number, color, group, type });
  };

  if (controls.showSpot) {
    add("Spot", model.spot, "#22c55e", "spot", "solid");
    add("Last Close", levels.previous_close, "#22c55e", "spot");
  }
  if (controls.showZeroGamma) {
    add("Zero Gamma", ladder.zero_gamma, "#f59e0b", "zero");
  }
  if (controls.showMajorLines) {
    add("Major Long Gamma", ladder.major_long_gamma, "#38bdf8", "major");
    add("Major Short Gamma", ladder.major_short_gamma, "#a78bfa", "major");
    add("Major Positive", ladder.major_positive, "#10b981", "major");
    add("Major Negative", ladder.major_negative, "#fb7185", "major");
  }
  if (controls.showOrderflowLines) {
    add("0DTE Major Long Gamma", orderflow.z_mlgamma, "#38bdf8", "orderflow");
    add("0DTE Major Short Gamma", orderflow.z_msgamma, "#a78bfa", "orderflow");
    add("1DTE+ Major Long Gamma", orderflow.o_mlgamma, "#0ea5e9", "orderflow");
    add("1DTE+ Major Short Gamma", orderflow.o_msgamma, "#c084fc", "orderflow");
  }
  if (controls.showWallLines) {
    add("0DTE Major Call", orderflow.zero_mcall, "#22c55e", "walls");
    add("0DTE Major Put", orderflow.zero_mput, "#ef4444", "walls");
    add("1DTE+ Major Call", orderflow.one_mcall, "#84cc16", "walls");
    add("1DTE+ Major Put", orderflow.one_mput, "#fb7185", "walls");
    add("MPos Vol", levels.mpos_vol, "#10b981", "walls");
    add("MPos OI", levels.mpos_oi, "#34d399", "walls");
    add("MNeg Vol", levels.mneg_vol, "#f43f5e", "walls");
    add("MNeg OI", levels.mneg_oi, "#fb7185", "walls");
  }

  return dedupeMarkLines(lines);
}

function dedupeMarkLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = `${line.label}:${line.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildTopStrikeMarkPoints(ladder) {
  return ladder.top_absolute.slice(0, 3).map((item, index) => ({
    name: `#${index + 1}`,
    coord: [item.strike, item.current_value],
    value: item.current_value,
  }));
}

function gammaTooltip(params, model, ladder, markLines) {
  const row = findTooltipGammaRow(params);
  if (!row) {
    return "";
  }
  const nearby = nearbyMarkLines(row.strike, ladder.rows, markLines);
  const valueClass = row.current_value < 0 ? "tooltipNegative" : "tooltipPositive";
  const lookback = row.lookback_values.length
    ? row.lookback_values.map((value, index) => `<div><span>t-${index + 1}</span><b>${formatCompact(value)}</b></div>`).join("")
    : '<div><span>Lookback</span><b>N/A</b></div>';
  const nearbyLines = nearby.length
    ? nearby.map((line) => `<div><span>${escapeHtml(line.label)}</span><b>${formatStrike(line.value)}</b></div>`).join("")
    : '<div><span>None</span><b>-</b></div>';

  return `
    <div class="gammaTooltip">
      <h4>${escapeHtml(model.ticker)} @ ${formatStrike(row.strike)}</h4>
      <div><span>Spot</span><b>${formatPrice(model.spot)}</b></div>
      <div><span>Distance from Spot</span><b>${formatPrice(row.distance_from_spot)}</b></div>
      <div><span>Distance %</span><b>${formatPercent(row.distance_from_spot_percent)}</b></div>
      <div><span>Strike Gamma Value</span><b class="${valueClass}">${formatCompact(row.current_value_raw ?? row.current_value)}</b></div>
      <div><span>Cumulative Gamma Proxy</span><b class="${negativeClass(row.cumulative_value)}">${formatCompact(row.cumulative_value)}</b></div>
      <hr />
      <strong>Lookback Values</strong>
      ${lookback}
      <hr />
      <strong>Nearby Lines</strong>
      ${nearbyLines}
    </div>
  `;
}

function findTooltipGammaRow(params) {
  for (const param of params || []) {
    const row = param.data?.[2];
    if (row && typeof row === "object") {
      return row;
    }
  }
  return null;
}

function nearbyMarkLines(strike, rows, markLines) {
  const threshold = averageStrikeStep(rows) * 1.5 || 1;
  return markLines
    .filter((line) => Math.abs(line.value - strike) <= threshold)
    .sort((a, b) => Math.abs(a.value - strike) - Math.abs(b.value - strike))
    .slice(0, 8);
}

function averageStrikeStep(rows) {
  if (rows.length < 2) {
    return 1;
  }
  const steps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const step = Math.abs(rows[index].strike - rows[index - 1].strike);
    if (step > 0) {
      steps.push(step);
    }
  }
  if (!steps.length) {
    return 1;
  }
  return steps.reduce((sum, step) => sum + step, 0) / steps.length;
}

function axisLabelColor() {
  return document.documentElement.dataset.theme === "dark" ? "#9ca3af" : "#667085";
}

function gridLineColor() {
  return document.documentElement.dataset.theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.12)";
}

function zoomToStrike(level) {
  if (!gammaChartInstance || numberOrNull(level) === null) {
    return;
  }
  const ladder = state.selectedModel?.gamma_ladder;
  const step = ladder ? averageStrikeStep(ladder.rows) : 1;
  gammaChartInstance.dispatchAction({
    type: "dataZoom",
    startValue: level - step * 12,
    endValue: level + step * 12,
  });
}

function renderTopGammaTables(model) {
  const ladder = model?.gamma_ladder;
  if (!ladder || ladder.rows.length === 0) {
    $("topGammaTables").innerHTML = empty("No gamma strike table data.");
    return;
  }

  $("topGammaTables").innerHTML = [
    renderGammaTable("Top Positive Gamma Strikes", ladder.top_positive),
    renderGammaTable("Top Negative Gamma Strikes", ladder.top_negative),
    renderGammaTable("Top Absolute Gamma Strikes", ladder.top_absolute),
  ].join("");
}

function renderGammaTable(title, rows) {
  const body = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${formatPrice(row.strike)}</td>
        <td class="${negativeClass(row.current_value)}">${formatCompact(row.current_value)}</td>
        <td>${formatCompact(row.abs_value)}</td>
        <td>${formatPrice(row.distance_from_spot)}</td>
        <td>${formatPercent(row.distance_percent)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">${empty("No rows.")}</td></tr>`;
  return `
    <article class="compactTable">
      <h3>${escapeHtml(title)}</h3>
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Value</th>
            <th>Abs Value</th>
            <th>Distance</th>
            <th>Distance %</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </article>
  `;
}

function renderOrderflowCards(model) {
  const orderflow = model?.orderflow;
  if (!orderflow) {
    $("orderflowCards").innerHTML = empty("No orderflow data for this ticker.");
    return;
  }

  const groups = [
    {
      title: "Gamma Levels",
      fields: [
        ["0DTE Major Long Gamma", "z_mlgamma"],
        ["0DTE Major Short Gamma", "z_msgamma"],
        ["1DTE+ Major Long Gamma", "o_mlgamma"],
        ["1DTE+ Major Short Gamma", "o_msgamma"],
      ],
    },
    {
      title: "Call / Put Walls",
      fields: [
        ["0DTE Major Call", "zero_mcall"],
        ["0DTE Major Put", "zero_mput"],
        ["1DTE+ Major Call", "one_mcall"],
        ["1DTE+ Major Put", "one_mput"],
      ],
    },
    {
      title: "Flow Metrics",
      fields: [
        ["0DTE CVR", "zcvr"],
        ["1DTE+ CVR", "ocvr"],
        ["0DTE GEX", "zgex"],
        ["1DTE+ GEX", "ogex"],
        ["0DTE Vanna", "zvanna"],
        ["1DTE+ Vanna", "ovanna"],
        ["0DTE Charm", "zcharm"],
        ["1DTE+ Charm", "ocharm"],
        ["Aggregate DEX", "agg_dex"],
        ["1DTE+ Aggregate DEX", "one_agg_dex"],
        ["Net DEX", "net_dex"],
        ["1DTE+ Net DEX", "one_net_dex"],
      ],
    },
  ];

  $("orderflowCards").innerHTML = groups.map((group) => `
    <article class="orderflowGroup">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="miniCardGrid">
        ${group.fields.map(([label, key]) => metricCard(label, formatCompact(orderflow[key]), null, negativeClass(orderflow[key]))).join("")}
      </div>
    </article>
  `).join("");
}

function renderOrderflowCharts(model) {
  const orderflow = model?.orderflow;
  if (!orderflow) {
    $("flowCompareChart").innerHTML = empty("No orderflow chart data.");
    $("dexBreakdownChart").innerHTML = empty("No DEX breakdown data.");
    return;
  }

  const grouped = [
    { label: "GEX", zero: orderflow.zgex, one: orderflow.ogex },
    { label: "Vanna", zero: orderflow.zvanna, one: orderflow.ovanna },
    { label: "Charm", zero: orderflow.zcharm, one: orderflow.ocharm },
    { label: "CVR", zero: orderflow.zcvr, one: orderflow.ocvr },
  ];
  $("flowCompareChart").innerHTML = renderGroupedBars(grouped);

  const dexFields = [
    "agg_dex",
    "one_agg_dex",
    "agg_call_dex",
    "one_agg_call_dex",
    "agg_put_dex",
    "one_agg_put_dex",
    "net_dex",
    "one_net_dex",
    "net_call_dex",
    "net_put_dex",
  ].map((key) => ({ label: key, value: orderflow[key] }))
    .filter((item) => numberOrNull(item.value) !== null);
  $("dexBreakdownChart").innerHTML = renderSignedBars(dexFields);
}

function renderGroupedBars(groups) {
  const values = groups.flatMap((group) => [numberOrNull(group.zero), numberOrNull(group.one)]).filter((value) => value !== null);
  if (values.length === 0) {
    return empty("No grouped chart data.");
  }
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  return groups.map((group) => `
    <div class="groupedBarRow">
      <div class="barLabel">${escapeHtml(group.label)}</div>
      ${renderMiniSignedBar("0DTE", group.zero, maxAbs)}
      ${renderMiniSignedBar("1DTE+", group.one, maxAbs)}
    </div>
  `).join("");
}

function renderSignedBars(items) {
  if (items.length === 0) {
    return empty("No DEX bars available.");
  }
  const maxAbs = Math.max(...items.map((item) => Math.abs(numberOrNull(item.value) || 0)), 1);
  return items.map((item) => `
    <div class="signedBarRow">
      <div class="barLabel">${escapeHtml(item.label)}</div>
      ${renderMiniSignedBar("", item.value, maxAbs)}
    </div>
  `).join("");
}

function renderMiniSignedBar(label, value, maxAbs) {
  const number = numberOrNull(value);
  if (number === null) {
    return "";
  }
  const width = Math.max(2, Math.abs(number) / maxAbs * 48);
  const sideClass = number >= 0 ? "positiveGamma" : "negativeGamma";
  const sideStyle = number >= 0 ? `left:50%;width:${width}%` : `right:50%;width:${width}%`;
  return `
    <div class="miniSignedBar">
      <span>${escapeHtml(label)}</span>
      <div class="miniSignedTrack">
        <i></i>
        <b class="${sideClass}" style="${sideStyle}"></b>
      </div>
      <em class="${negativeClass(number)}">${formatCompact(number)}</em>
    </div>
  `;
}

function renderRawPanels(ticker) {
  $("levelsJson").textContent = pretty(state.levels[ticker]);
  $("stateJson").textContent = pretty(state.stateGreeks[ticker]);
  $("orderflowJson").textContent = pretty(state.orderflow[ticker]);
}

function renderRawSummary() {
  $("sourceStatus").textContent = pretty(publicSourceStatus());
  $("loadedFiles").textContent = pretty(publicLoadedFiles());
  $("lastFetchResult").textContent = pretty(publicFetchResult());
}

function publicSourceStatus() {
  const sources = state.summary.sources || {};
  return {
    "Stock Details": sources[sourceKeys.stock] || null,
    "Squeezing Scanner": sources[sourceKeys.scanner] || null,
  };
}

function publicFetchResult() {
  if (!state.lastFetchResult || Object.keys(state.lastFetchResult).length === 0) {
    return {};
  }
  return {
    ok: Boolean(state.lastFetchResult.ok),
    error: state.lastFetchResult.error || null,
    sources: publicSourceStatus(),
    generated_at: state.lastFetchResult.summary?.generated_at || null,
  };
}

function publicLoadedFiles() {
  const labels = {
    summary: "Summary",
    candidates: "Squeezing Scanner",
    candidateHistoryIndex: "History Index",
    tickers: "Supported Tickers",
    levels: "Levels Loaded",
    stateGreeks: "State Greeks",
    gexProxy: "Gamma Ladder",
    orderflow: "Orderflow Loaded",
  };
  return Object.fromEntries(
    Object.entries(state.loaded).map(([key, value]) => [
      labels[key] || key,
      { ok: value.ok, error: value.error || null },
    ]),
  );
}

function distanceModel(level, spot) {
  if (level === null || spot === null) {
    return null;
  }
  const value = level - spot;
  return {
    value,
    percent: spot ? value / spot * 100 : null,
  };
}

function metricCard(label, value, subvalue = null, className = "") {
  return `
    <article class="metricCard">
      <span>${escapeHtml(label)}</span>
      <strong class="${className}">${escapeHtml(value)}</strong>
      ${subvalue ? `<small>${escapeHtml(subvalue)}</small>` : ""}
    </article>
  `;
}

function metricBadge(label, value, className = "") {
  return `<span class="badge">${escapeHtml(label)}: <b class="${className}">${escapeHtml(value)}</b></span>`;
}

function badge(label, value) {
  return `<span class="badge">${label}: ${value == null ? "missing" : "loaded"}</span>`;
}

function empty(message) {
  return `<div class="emptyState">${escapeHtml(message)}</div>`;
}

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (numberOrNull(row[key]) || 0), 0);
}

function formatNumber(value, options = {}) {
  const number = numberOrNull(value);
  if (number === null) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", options).format(number);
}

function formatPrice(value) {
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatStrike(value) {
  const number = numberOrNull(value);
  if (number === null) {
    return "-";
  }
  return Number.isInteger(number)
    ? formatNumber(number, { maximumFractionDigits: 0 })
    : formatNumber(number, { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const number = numberOrNull(value);
  return number === null ? "-" : `${number.toFixed(2)}%`;
}

function formatCompact(value) {
  const number = numberOrNull(value);
  if (number === null) {
    return "-";
  }
  const abs = Math.abs(number);
  const suffixes = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [divisor, suffix] of suffixes) {
    if (abs >= divisor) {
      return `${(number / divisor).toFixed(2)}${suffix}`;
    }
  }
  return formatNumber(number, { maximumFractionDigits: 2 });
}

function formatDistance(distance) {
  if (!distance) {
    return "-";
  }
  return `${formatPrice(distance.value)} (${formatPercent(distance.percent)})`;
}

function formatUtcTimestamp(timestamp) {
  const number = numberOrNull(timestamp);
  if (number === null) {
    return null;
  }
  return new Date(number * 1000).toISOString().replace(".000Z", "Z");
}

function negativeClass(value) {
  return Number(value) < 0 ? "negative" : "";
}

function escapeHtml(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function copyJson(preId) {
  const text = $(preId)?.textContent || "{}";
  await navigator.clipboard.writeText(text);
  $("lastAction").textContent = "JSON copied.";
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(button.dataset.tab).classList.add("active");
  });
});

$("themeButton").addEventListener("click", toggleTheme);
$("candidateSearch").addEventListener("input", renderCandidates);
$("candidateSort").addEventListener("change", renderCandidates);
$("candidateDirection").addEventListener("click", () => {
  const button = $("candidateDirection");
  const next = button.dataset.direction === "desc" ? "asc" : "desc";
  button.dataset.direction = next;
  button.textContent = next === "desc" ? "Desc" : "Asc";
  renderCandidates();
});
$("candidateDate").addEventListener("change", async (event) => {
  await loadCandidateDate(event.target.value);
  renderMetrics();
  renderCandidates();
  renderRawSummary();
});
$("tickerSearch").addEventListener("input", renderTickerList);
[
  "gammaZoom",
  "showKeyLines",
  "showSpotLine",
  "showZeroGammaLine",
  "showMajorLines",
  "showOrderflowLines",
  "showWallLines",
  "showGammaProxyLine",
  "smoothGammaLine",
  "gammaBarMode",
].forEach((id) => {
  $(id).addEventListener("change", () => renderGammaLadder(state.selectedModel));
});
$("reloadButton").addEventListener("click", loadData);
$("fetchButton").addEventListener("click", fetchLiveData);
$("tickerList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ticker]");
  if (!button) {
    return;
  }
  state.selectedTicker = button.dataset.ticker;
  renderTickerList();
  renderTickerDetail();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-copy]");
  if (button) {
    copyJson(button.dataset.copy).catch((error) => {
      $("lastAction").textContent = `Copy failed: ${error.message}`;
    });
  }
});
window.addEventListener("resize", () => {
  gammaChartInstance?.resize();
});

initTheme();
loadData();
