const LOCAL_SERVER = "http://127.0.0.1:8765/";
const isFilePage = window.location.protocol === "file:";
const sourceKeys = {
  stock: "gex" + "bot",
  scanner: "spot" + "gamma",
};

const files = {
  summary: "data/normalized/options-data-latest.json",
  candidates: "data/normalized/" + sourceKeys.scanner + "-squeeze-candidates-latest.json",
  tickers: "data/normalized/" + sourceKeys.stock + "-tickers-latest.json",
  levels: "data/normalized/" + sourceKeys.stock + "-levels-latest.json",
  stateGreeks: "data/normalized/" + sourceKeys.stock + "-state-greeks-latest.json",
  orderflow: "data/normalized/" + sourceKeys.stock + "-orderflow-latest.json",
};

const state = {
  summary: {},
  candidates: [],
  tickers: [],
  levels: {},
  stateGreeks: {},
  orderflow: {},
  selectedTicker: null,
  loaded: {},
  lastFetchResult: {},
};

const $ = (id) => document.getElementById(id);

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
  const [summary, candidates, tickers, levels, stateGreeks, orderflow] = await Promise.all([
    readJson("summary", files.summary),
    readJson("candidates", files.candidates),
    readJson("tickers", files.tickers),
    readJson("levels", files.levels),
    readJson("stateGreeks", files.stateGreeks),
    readJson("orderflow", files.orderflow),
  ]);

  state.summary = summary || {};
  state.candidates = Array.isArray(candidates) ? candidates : [];
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
  $("lastAction").textContent = "Running live data fetch...";
  try {
    const response = await fetch(resolveUrl("api/fetch-all"), { method: "POST", cache: "no-store" });
    const payload = await response.json();
    state.lastFetchResult = payload;
    if (!response.ok || !payload.ok) {
      $("lastAction").textContent = `Fetch failed: ${payload.error || response.status}`;
    } else {
      $("lastAction").textContent = "Fetch complete. Latest JSON reloaded.";
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
  const rows = state.candidates
    .filter((item) => {
      const ticker = String(item.ticker || "").toLowerCase();
      const company = String(item.company_name || "").toLowerCase();
      return ticker.includes(query) || company.includes(query);
    })
    .sort((a, b) => compareRows(a, b, sortKey));

  $("candidateRows").innerHTML = rows.map(renderCandidateRow).join("");
}

function compareRows(a, b, key) {
  if (key === "ticker") {
    return String(a.ticker || "").localeCompare(String(b.ticker || ""));
  }
  return numericValue(b[key]) - numericValue(a[key]);
}

function renderCandidateRow(item) {
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
    tickers: "Supported Tickers",
    levels: "Levels Loaded",
    stateGreeks: "State Greeks",
    orderflow: "Orderflow Loaded",
  };
  return Object.fromEntries(
    Object.entries(state.loaded).map(([key, value]) => [
      labels[key] || key,
      { ok: value.ok, error: value.error || null },
    ]),
  );
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
$("candidateSearch").addEventListener("input", renderCandidates);
$("candidateSort").addEventListener("change", renderCandidates);
$("tickerSearch").addEventListener("input", renderTickerList);
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
