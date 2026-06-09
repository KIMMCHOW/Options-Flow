const files = {
  summary: "data/normalized/options-data-latest.json",
  spotgamma: "data/normalized/spotgamma-squeeze-candidates-latest.json",
  tickers: "data/normalized/gexbot-tickers-latest.json",
  levels: "data/normalized/gexbot-levels-latest.json",
  stateGreeks: "data/normalized/gexbot-state-greeks-latest.json",
  orderflow: "data/normalized/gexbot-orderflow-latest.json",
};

const state = {
  summary: {},
  spotgamma: [],
  tickers: [],
  levels: {},
  stateGreeks: {},
  orderflow: {},
  selectedTicker: null,
  loaded: {},
  lastFetchResult: {},
};

const $ = (id) => document.getElementById(id);

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
  try {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    state.loaded[name] = { ok: true, path: url };
    return data;
  } catch (error) {
    state.loaded[name] = { ok: false, path: url, error: error.message };
    return name === "spotgamma" || name === "tickers" ? [] : {};
  }
}

async function loadData() {
  $("generatedAt").textContent = "Loading latest data...";
  const [summary, spotgamma, tickers, levels, stateGreeks, orderflow] = await Promise.all([
    readJson("summary", files.summary),
    readJson("spotgamma", files.spotgamma),
    readJson("tickers", files.tickers),
    readJson("levels", files.levels),
    readJson("stateGreeks", files.stateGreeks),
    readJson("orderflow", files.orderflow),
  ]);

  state.summary = summary || {};
  state.spotgamma = Array.isArray(spotgamma) ? spotgamma : [];
  state.tickers = Array.isArray(tickers) ? tickers : [];
  state.levels = levels || {};
  state.stateGreeks = stateGreeks || {};
  state.orderflow = orderflow || {};
  state.selectedTicker = state.selectedTicker && state.tickers.includes(state.selectedTicker)
    ? state.selectedTicker
    : pickDefaultTicker();

  render();
}

async function fetchLiveData() {
  setBusy(true);
  $("lastAction").textContent = "Running real Gexbot + SpotGamma fetch...";
  try {
    const response = await fetch("api/fetch-all", { method: "POST", cache: "no-store" });
    const payload = await response.json();
    state.lastFetchResult = payload;
    if (!response.ok || !payload.ok) {
      $("lastAction").textContent = `Fetch failed: ${payload.error || response.status}`;
    } else {
      $("lastAction").textContent = "Fetch complete. Latest JSON reloaded.";
    }
  } catch (error) {
    state.lastFetchResult = { ok: false, error: error.message };
    $("lastAction").textContent = `Fetch failed: ${error.message}`;
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
  renderSpotGamma();
  renderTickerList();
  renderTickerDetail();
  renderRawSummary();
}

function renderMetrics() {
  $("spotgammaCount").textContent = state.spotgamma.length;
  $("gexbotTickerCount").textContent = state.tickers.length;
  $("gexbotLevelCount").textContent = Object.keys(state.levels).length;
  $("gexbotOrderflowCount").textContent = Object.keys(state.orderflow).length;

  const generatedAt = state.summary.generated_at;
  $("generatedAt").textContent = generatedAt ? `Generated at ${generatedAt}` : `Loaded at ${new Date().toISOString()}`;
  renderStatusPill("gexbotStatus", "Gexbot", state.summary.sources?.gexbot);
  renderStatusPill("spotgammaStatus", "SpotGamma", state.summary.sources?.spotgamma);
}

function renderStatusPill(id, label, status) {
  const element = $(id);
  const ok = Boolean(status && status.ok);
  const error = status && status.error ? ` - ${status.error}` : "";
  element.textContent = `${label}: ${ok ? "ok" : "failed"}${error}`;
  element.className = `statusPill ${ok ? "ok" : "failed"}`;
}

function renderSpotGamma() {
  const query = $("spotgammaSearch").value.trim().toLowerCase();
  const sortKey = $("spotgammaSort").value;
  const rows = state.spotgamma
    .filter((item) => {
      const ticker = String(item.ticker || "").toLowerCase();
      const company = String(item.company_name || "").toLowerCase();
      return ticker.includes(query) || company.includes(query);
    })
    .sort((a, b) => compareRows(a, b, sortKey));

  $("spotgammaRows").innerHTML = rows.map(renderSpotGammaRow).join("");
}

function compareRows(a, b, key) {
  if (key === "ticker") {
    return String(a.ticker || "").localeCompare(String(b.ticker || ""));
  }
  return numericValue(b[key]) - numericValue(a[key]);
}

function renderSpotGammaRow(item) {
  return `
    <tr>
      <td class="tickerCell">${escapeHtml(item.ticker)}</td>
      <td>${escapeHtml(item.company_name)}</td>
      <td class="number">${formatNumber(item.current_price)}</td>
      <td class="number">${formatNumber(item.daily_change_percent)}</td>
      <td class="number">${formatNumber(item.call_wall)}</td>
      <td class="number">${formatNumber(item.put_wall)}</td>
      <td class="number">${formatNumber(item.skew_rank)}</td>
      <td class="number">${formatNumber(item.iv_rank)}</td>
      <td class="number ${negativeClass(item.call_gamma)}">${formatNumber(item.call_gamma)}</td>
      <td class="number ${negativeClass(item.put_gamma)}">${formatNumber(item.put_gamma)}</td>
      <td>${escapeHtml(item.top_gamma_exp)}</td>
      <td>${escapeHtml(item.top_delta_exp)}</td>
      <td class="number">${formatNumber(item.call_volume)}</td>
      <td class="number">${formatNumber(item.put_volume)}</td>
      <td class="number">${formatNumber(item.options_implied_move)}</td>
    </tr>
  `;
}

function renderTickerList() {
  const query = $("gexbotSearch").value.trim().toLowerCase();
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
  $("selectedTicker").textContent = ticker || "Select a ticker";
  $("tickerBadges").innerHTML = ticker
    ? [
        badge("Levels", state.levels[ticker]),
        badge("State Greeks", state.stateGreeks[ticker]),
        badge("Orderflow", state.orderflow[ticker]),
      ].join("")
    : "";
  $("levelsJson").textContent = pretty(state.levels[ticker]);
  $("stateJson").textContent = pretty(state.stateGreeks[ticker]);
  $("orderflowJson").textContent = pretty(state.orderflow[ticker]);
}

function renderRawSummary() {
  $("sourceStatus").textContent = pretty(state.summary.sources || {});
  $("loadedFiles").textContent = pretty(state.loaded);
  $("lastFetchResult").textContent = pretty(state.lastFetchResult);
}

function badge(label, value) {
  return `<span class="badge">${label}: ${value == null ? "missing" : "loaded"}</span>`;
}

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return escapeHtml(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(number);
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

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(button.dataset.tab).classList.add("active");
  });
});

$("themeButton").addEventListener("click", toggleTheme);
$("spotgammaSearch").addEventListener("input", renderSpotGamma);
$("spotgammaSort").addEventListener("change", renderSpotGamma);
$("gexbotSearch").addEventListener("input", renderTickerList);
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

initTheme();
loadData();
