let pnlChart = null;
let summaryAll = [];
let rawEvents = [];
let groupedPositions = [];
let filteredEvents = [];
let filteredPositions = [];
let rawLoaded = false;
let currentPage = 1;
let currentView = "position";
let sortKey = "close_time_vn";
let sortDir = "desc";
let posSortKey = "exit_time_vn";
let posSortDir = "desc";
const pageSize = 50;

function ts(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
}

async function loadCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return parseCsv(await res.text());
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i += 1; } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function money(value, digits = 2) {
  return num(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function hhmmss(isoString) {
  if (!isoString) return "";
  const m = String(isoString).match(/T(\d{2}:\d{2}:\d{2})/);
  if (m && m[1]) return m[1];
  return String(isoString);
}

function pct(v) { return `${(v * 100).toFixed(1)}%`; }

function setText(id, value, cls) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.classList.remove("pos", "neg");
  if (cls) el.classList.add(cls);
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function applySummaryFilter() {
  const from = document.getElementById("summary-from").value;
  const to = document.getElementById("summary-to").value;
  const rows = summaryAll.filter((r) => inRange(r.trade_date_vn, from, to));
  renderKpi(rows);
  renderSummaryTable(rows);
  renderChart(rows);
}

function renderKpi(rows) {
  const totalNet = rows.reduce((a, r) => a + num(r.net_profit), 0);
  const totalPositions = rows.reduce((a, r) => a + num(r.total_positions), 0);
  const totalWins = rows.reduce((a, r) => a + num(r.win_positions), 0);
  const totalLoss = rows.reduce((a, r) => a + num(r.loss_positions), 0);
  const grossLoss = rows.reduce((a, r) => a + num(r.gross_loss), 0);
  const grossProfit = rows.reduce((a, r) => a + num(r.gross_profit), 0);
  const tradingPnl = grossProfit + grossLoss;
  const wr = (totalWins + totalLoss) > 0 ? totalWins / (totalWins + totalLoss) : 0;

  setText("kpi-trade-pnl", `$${money(tradingPnl)}`, tradingPnl >= 0 ? "pos" : "neg");
  setText("kpi-net", `$${money(totalNet)}`, totalNet >= 0 ? "pos" : "neg");
  setText("kpi-positions", totalPositions.toLocaleString("en-US"));
  setText("kpi-winrate", pct(wr));
  setText("kpi-gross-profit", `$${money(grossProfit)}`, "pos");
  setText("kpi-loss", `$${money(grossLoss)}`, "neg");

  const latest = rows[rows.length - 1];
  document.getElementById("last-updated").textContent = latest ? `Latest trade date: ${latest.trade_date_vn} (VN)` : "No data in range";
}

function renderSummaryTable(rows) {
  const tbody = document.querySelector("#summary-table tbody");
  tbody.innerHTML = "";
  rows.slice().reverse().forEach((r) => {
    const net = num(r.net_profit);
    const tradePnl = num(r.gross_profit) + num(r.gross_loss);
    const cashFlow = num(r.total_deposit) - num(r.total_withdrawal);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.trade_date_vn}</td>
      <td>${num(r.total_positions)}</td>
      <td>${num(r.total_deals)}</td>
      <td>${num(r.win_positions)}</td>
      <td>${num(r.loss_positions)}</td>
      <td class="${tradePnl >= 0 ? "pos" : "neg"}">$${money(tradePnl)}</td>
      <td class="${cashFlow >= 0 ? "pos" : "neg"}">$${money(cashFlow)}</td>
      <td class="${net >= 0 ? "pos" : "neg"}">$${money(net)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderChart(rows) {
  const ctx = document.getElementById("pnl-chart");
  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: rows.map((r) => r.trade_date_vn),
      datasets: [{ label: "Net Profit", data: rows.map((r) => num(r.net_profit)), borderColor: "#2e6cff", backgroundColor: "rgba(46,108,255,.15)", fill: true, tension: .28, pointRadius: 2 }],
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { grid: { color: "#eef3fd" } }, x: { grid: { display: false } } } },
  });
}

function enrichEventsWithPositionStats(rows) {
  const byPosition = new Map();
  rows.forEach((row) => {
    const key = (row.position_id || "").trim();
    if (!key) return;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(row);
  });

  byPosition.forEach((events) => {
    events.sort((a, b) => ts(a.close_time_vn) - ts(b.close_time_vn));
    const totalPnl = events.reduce((acc, e) => acc + num(e.profit), 0);
    events.forEach((e, idx) => {
      e.deal_role = events.length === 1 ? "single" : (idx === 0 ? "entry" : (idx === events.length - 1 ? "exit" : "adjustment"));
      e.position_pnl = String(totalPnl);
    });
  });

  rows.forEach((r) => {
    if (!r.deal_role) r.deal_role = "n/a";
    if (!r.position_pnl) r.position_pnl = String(num(r.profit));
  });

  return rows;
}

function buildGroupedPositions(rows) {
  const groups = new Map();
  rows.filter((r) => (r.event_type || "") === "trade" && (r.position_id || "")).forEach((r) => {
    const key = `${r.account_id || ""}|${r.position_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  return Array.from(groups.values()).map((events) => {
    const sorted = [...events].sort((a, b) => ts(a.close_time_vn) - ts(b.close_time_vn));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      trade_date_vn: last.trade_date_vn || first.trade_date_vn || "",
      account_id: first.account_id || "",
      position_id: first.position_id || "",
      symbol: first.symbol || "",
      entry_time_vn: first.close_time_vn || "",
      exit_time_vn: last.close_time_vn || "",
      entry_price: first.close_price || "",
      exit_price: last.close_price || "",
      lots: first.lots || "",
      deals_count: String(sorted.length),
      position_pnl: String(sorted.reduce((acc, x) => acc + num(x.profit), 0)),
    };
  });
}

function fillDateFilter(rows) {
  const dateSelect = document.getElementById("filter-date");
  dateSelect.innerHTML = '<option value="">All</option>';
  Array.from(new Set(rows.map((r) => r.trade_date_vn).filter(Boolean))).sort().reverse().forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    dateSelect.appendChild(opt);
  });
}

function sortRows(rows, key, dir, numericKeys = []) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const va = a[key] ?? "";
    const vb = b[key] ?? "";
    let cmp = 0;
    if (key.includes("time") || key.includes("date")) cmp = ts(va) - ts(vb);
    else if (numericKeys.includes(key)) cmp = num(va) - num(vb);
    else cmp = String(va).localeCompare(String(vb));
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function applyDetailsFilter() {
  const from = document.getElementById("details-from").value;
  const to = document.getElementById("details-to").value;
  const date = document.getElementById("filter-date").value;
  const action = document.getElementById("filter-action").value;
  const symbol = document.getElementById("filter-symbol").value.trim().toUpperCase();

  filteredEvents = rawEvents.filter((r) => {
    if ((from || to) && !inRange(r.trade_date_vn, from, to)) return false;
    if (date && r.trade_date_vn !== date) return false;
    if (action && r.action !== action) return false;
    if (symbol && !(r.symbol || "").toUpperCase().includes(symbol)) return false;
    return true;
  });
  filteredEvents = sortRows(filteredEvents, sortKey, sortDir, ["lots", "close_price", "position_pnl", "profit", "event_id"]);

  filteredPositions = groupedPositions.filter((r) => {
    if ((from || to) && !inRange(r.trade_date_vn, from, to)) return false;
    if (date && r.trade_date_vn !== date) return false;
    if (symbol && !(r.symbol || "").toUpperCase().includes(symbol)) return false;
    return true;
  });
  filteredPositions = sortRows(filteredPositions, posSortKey, posSortDir, ["entry_price", "exit_price", "lots", "deals_count", "position_pnl"]);

  currentPage = 1;
  renderCurrentView();
}

function renderEventPage() {
  const tbody = document.querySelector("#details-table tbody");
  tbody.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  filteredEvents.slice((currentPage - 1) * pageSize, currentPage * pageSize).forEach((r) => {
    const dealProfit = num(r.profit);
    const posPnl = num(r.position_pnl);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.trade_date_vn || ""}</td>
      <td>${hhmmss(r.close_time_vn)}</td>
      <td>${r.event_id || ""}</td>
      <td>${r.position_id || ""}</td>
      <td>${r.deal_role || ""}</td>
      <td>${r.action || ""}</td>
      <td>${r.symbol || ""}</td>
      <td>${r.lots || ""}</td>
      <td>${r.close_price || ""}</td>
      <td class="${posPnl >= 0 ? "pos" : "neg"}">$${money(posPnl)}</td>
      <td class="${dealProfit >= 0 ? "pos" : "neg"}">$${money(dealProfit)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById("page-info").textContent = `Page ${currentPage} / ${totalPages} (Total ${filteredEvents.length} events)`;
}

function renderPositionPage() {
  const tbody = document.querySelector("#positions-table tbody");
  tbody.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(filteredPositions.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  filteredPositions.slice((currentPage - 1) * pageSize, currentPage * pageSize).forEach((r) => {
    const pnl = num(r.position_pnl);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.trade_date_vn}</td>
      <td>${r.account_id}</td>
      <td>${r.position_id}</td>
      <td>${r.symbol}</td>
      <td>${hhmmss(r.entry_time_vn)}</td>
      <td>${hhmmss(r.exit_time_vn)}</td>
      <td>${r.entry_price}</td>
      <td>${r.exit_price}</td>
      <td>${r.lots}</td>
      <td>${r.deals_count}</td>
      <td class="${pnl >= 0 ? "pos" : "neg"}">$${money(pnl)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById("page-info").textContent = `Page ${currentPage} / ${totalPages} (Total ${filteredPositions.length} positions)`;
}

function renderCurrentView() {
  const detailsTable = document.getElementById("details-table");
  const positionsTable = document.getElementById("positions-table");
  if (currentView === "event") {
    detailsTable.classList.remove("hidden");
    positionsTable.classList.add("hidden");
    renderEventPage();
  } else {
    positionsTable.classList.remove("hidden");
    detailsTable.classList.add("hidden");
    renderPositionPage();
  }

  const totalPages = Math.max(1, Math.ceil((currentView === "event" ? filteredEvents.length : filteredPositions.length) / pageSize));
  document.getElementById("prev-page").disabled = currentPage <= 1;
  document.getElementById("next-page").disabled = currentPage >= totalPages;
}

async function loadDetailsLazy() {
  if (rawLoaded) return;
  rawLoaded = true;
  const status = document.getElementById("details-status");
  status.textContent = "Loading raw trade records...";

  rawEvents = enrichEventsWithPositionStats(await loadCsv("./data/raw_events_history.csv"));
  groupedPositions = buildGroupedPositions(rawEvents);
  fillDateFilter(rawEvents);
  applyDetailsFilter();

  status.textContent = `Loaded ${rawEvents.length} events / ${groupedPositions.length} positions (50 per page)`;
}

function initDetailsLazyLoad() {
  const target = document.getElementById("details-section");
  const observer = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.disconnect();
        try { await loadDetailsLazy(); } catch (err) { document.getElementById("details-status").textContent = err.message; }
      }
    }
  }, { rootMargin: "120px" });
  observer.observe(target);
}

function bindEvents() {
  document.getElementById("summary-from").addEventListener("input", applySummaryFilter);
  document.getElementById("summary-to").addEventListener("input", applySummaryFilter);
  ["details-from", "details-to", "filter-date", "filter-action", "filter-symbol"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => rawLoaded && applyDetailsFilter());
  });

  document.querySelectorAll("#details-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = "asc"; }
      rawLoaded && applyDetailsFilter();
    });
  });
  document.querySelectorAll("#positions-table thead th[data-psort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.psort;
      if (posSortKey === key) posSortDir = posSortDir === "asc" ? "desc" : "asc";
      else { posSortKey = key; posSortDir = "asc"; }
      rawLoaded && applyDetailsFilter();
    });
  });

  document.getElementById("prev-page").addEventListener("click", () => { if (currentPage > 1) { currentPage -= 1; renderCurrentView(); } });
  document.getElementById("next-page").addEventListener("click", () => {
    const total = currentView === "event" ? filteredEvents.length : filteredPositions.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage < totalPages) { currentPage += 1; renderCurrentView(); }
  });

  document.getElementById("view-event").addEventListener("click", () => {
    currentView = "event";
    document.getElementById("view-event").classList.add("active");
    document.getElementById("view-position").classList.remove("active");
    currentPage = 1;
    if (rawLoaded) renderCurrentView();
  });
  document.getElementById("view-position").addEventListener("click", () => {
    currentView = "position";
    document.getElementById("view-position").classList.add("active");
    document.getElementById("view-event").classList.remove("active");
    currentPage = 1;
    if (rawLoaded) renderCurrentView();
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", next);
    localStorage.setItem("dash-theme", next);
    document.getElementById("theme-toggle").textContent = next === "dark" ? "Light" : "Dark";
  });
}

function initDefaultViewButtons() {
  if (currentView === "position") {
    document.getElementById("view-position").classList.add("active");
    document.getElementById("view-event").classList.remove("active");
  } else {
    document.getElementById("view-event").classList.add("active");
    document.getElementById("view-position").classList.remove("active");
  }
}

function initTheme() {
  const saved = localStorage.getItem("dash-theme") || "light";
  document.body.setAttribute("data-theme", saved);
  document.getElementById("theme-toggle").textContent = saved === "dark" ? "Light" : "Dark";
}

async function start() {
  try {
    initTheme();
    bindEvents();
    initDefaultViewButtons();
    summaryAll = await loadCsv("./data/daily_summary_history.csv");
    applySummaryFilter();
    initDetailsLazyLoad();
  } catch (err) {
    document.getElementById("last-updated").textContent = err.message;
  }
}

start();
