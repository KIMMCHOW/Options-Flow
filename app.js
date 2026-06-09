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
  state.selectedTicker = state.selectedTicker && state.tickers.includes(state.selectedTicker)
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
  return preferred.find((ticker) => state.tickers.includes(ticker)) || state.tickers[0] || null;
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
  $("tickerCount").textContent = state.tickers.length;
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
  const tickers = state.tickers.filter((ticker) => String(ticker).toLowerCase().includes(query));
  $("tickerList").innerHTML = tickers
    .map((ticker) => {
      const active = ticker === state.selectedTicker ? "active" : "";
      return `<button class="${active}" data-ticker="${escapeHtml(ticker)}">${escapeHtml(ticker)}</button>`;
    })
    .join("");
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
  const currentValue = numberOrNull(row[3]);
  if (strike === null || currentValue === null) {
    return null;
  }
  const distance = spot === null ? null : strike - spot;
  return {
    strike,
    current_value: currentValue,
    abs_value: Math.abs(currentValue),
    side: currentValue > 0 ? "positive" : currentValue < 0 ? "negative" : "neutral",
    distance_from_spot: distance,
    distance_percent: distance === null || !spot ? null : distance / spot * 100,
    lookback_values: Array.isArray(row[4]) ? row[4] : [],
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
    $("gammaChart").innerHTML = empty("No gamma ladder data.");
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

  $("gammaChart").innerHTML = renderGammaSvg(model, ladder, $("gammaZoom").value);
}

function renderGammaSvg(model, ladder, zoomMode) {
  const rows = filterGammaRows(ladder.rows, model.spot, zoomMode);
  if (rows.length === 0) {
    return empty("No gamma ladder data in this zoom range.");
  }

  const width = 980;
  const height = 380;
  const margin = { top: 28, right: 38, bottom: 42, left: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minStrike = Math.min(...rows.map((item) => item.strike));
  const maxStrike = Math.max(...rows.map((item) => item.strike));
  const maxAbs = Math.max(...rows.map((item) => item.abs_value), 1);
  const zeroY = margin.top + chartHeight / 2;
  const barWidth = Math.max(2, Math.min(12, (chartWidth / Math.max(rows.length, 1)) * 0.58));
  const topAbs = new Map(ladder.top_absolute.slice(0, 3).map((item, index) => [item.strike, index]));

  const xScale = (strike) => {
    if (maxStrike === minStrike) {
      return margin.left + chartWidth / 2;
    }
    return margin.left + ((strike - minStrike) / (maxStrike - minStrike)) * chartWidth;
  };
  const yScale = (value) => zeroY - (value / maxAbs) * (chartHeight / 2 - 18);

  const bars = rows.map((item) => {
    const x = xScale(item.strike);
    const y = yScale(item.current_value);
    const rectY = Math.min(y, zeroY);
    const rectHeight = Math.max(1, Math.abs(zeroY - y));
    const cssClass = item.current_value >= 0 ? "svgBar positiveGamma" : "svgBar negativeGamma";
    const title = [
      `strike: ${formatPrice(item.strike)}`,
      `current_value: ${formatCompact(item.current_value)}`,
      `distance from spot: ${formatPrice(item.distance_from_spot)}`,
      `distance percent: ${formatPercent(item.distance_percent)}`,
      `lookback_values: ${JSON.stringify(item.lookback_values)}`,
    ].join("\n");
    const topIndex = topAbs.get(item.strike);
    const labelOffset = Number.isInteger(topIndex) ? topIndex * 13 : 0;
    const label = topAbs.has(item.strike)
      ? `<circle cx="${x}" cy="${rectY - 6 - labelOffset}" r="3.5" class="topMarker"><title>Top absolute strike</title></circle>
         <text x="${x}" y="${rectY - 10 - labelOffset}" class="topLabel">${formatPrice(item.strike)}</text>`
      : "";
    return `
      <rect class="${cssClass}" x="${x - barWidth / 2}" y="${rectY}" width="${barWidth}" height="${rectHeight}">
        <title>${escapeHtml(title)}</title>
      </rect>
      ${label}
    `;
  }).join("");

  const levelLines = [
    chartLine("Spot", model.spot, "spotLine", xScale, minStrike, maxStrike, margin, chartHeight, 0),
    chartLine("Zero", ladder.zero_gamma, "zeroGammaLine", xScale, minStrike, maxStrike, margin, chartHeight, 1),
    chartLine("Major +", ladder.major_positive, "majorPositiveLine", xScale, minStrike, maxStrike, margin, chartHeight, 2),
    chartLine("Major -", ladder.major_negative, "majorNegativeLine", xScale, minStrike, maxStrike, margin, chartHeight, 3),
    chartLine("Long", ladder.major_long_gamma, "majorLongLine", xScale, minStrike, maxStrike, margin, chartHeight, 4),
    chartLine("Short", ladder.major_short_gamma, "majorShortLine", xScale, minStrike, maxStrike, margin, chartHeight, 5),
  ].filter(Boolean).join("");

  return `
    <svg class="gammaSvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(model.ticker)} gamma ladder chart">
      <line class="zeroAxis" x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}"></line>
      <line class="chartAxis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
      <line class="chartAxis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
      <text class="axisLabel" x="${margin.left}" y="${height - 12}">${formatPrice(minStrike)}</text>
      <text class="axisLabel end" x="${width - margin.right}" y="${height - 12}">${formatPrice(maxStrike)}</text>
      <text class="axisLabel" x="8" y="${margin.top + 8}">+${formatCompact(maxAbs)}</text>
      <text class="axisLabel" x="8" y="${height - margin.bottom}">-${formatCompact(maxAbs)}</text>
      ${bars}
      ${levelLines}
    </svg>
  `;
}

function filterGammaRows(rows, spot, zoomMode) {
  if (zoomMode === "near" && spot !== null) {
    return rows
      .slice()
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, 60)
      .sort((a, b) => a.strike - b.strike);
  }
  if (zoomMode === "top") {
    return rows
      .slice()
      .sort((a, b) => b.abs_value - a.abs_value)
      .slice(0, 60)
      .sort((a, b) => a.strike - b.strike);
  }
  return rows;
}

function chartLine(label, value, cssClass, xScale, minStrike, maxStrike, margin, chartHeight, labelIndex) {
  const number = numberOrNull(value);
  if (number === null || number < minStrike || number > maxStrike) {
    return "";
  }
  const x = xScale(number);
  return `
    <line class="${cssClass}" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + chartHeight}"></line>
    <text class="${cssClass}Label lineLabel" x="${x + 4}" y="${margin.top + 14 + labelIndex * 13}">${escapeHtml(label)}</text>
  `;
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
$("gammaZoom").addEventListener("change", () => renderGammaLadder(state.selectedModel));
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

initTheme();
loadData();
