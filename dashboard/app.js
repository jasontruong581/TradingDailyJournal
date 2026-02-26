let charts = {};
let summaryAll = [];
let rawEvents = [];
let groupedPositions = [];
let filteredEvents = [];
let filteredPositions = [];
let rawLoaded = false;
let rawAnalyticsLoaded = false;
let currentPage = 1;
let currentView = "position";
let sortKey = "close_time_vn";
let sortDir = "desc";
let posSortKey = "exit_time_vn";
let posSortDir = "desc";
const pageSize = 50;
const API_BASE = (
  window.__DASHBOARD_API_BASE__ ||
  localStorage.getItem("dashboard_api_base") ||
  ""
).replace(/\/+$/, "");
const API_TOKEN = window.__DASHBOARD_API_TOKEN__ || localStorage.getItem("dashboard_api_token") || "";

function ts(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
}

async function loadCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return parseCsv(await res.text());
}

async function loadApiRows(path) {
  if (!API_BASE) throw new Error("API not configured");
  const headers = {};
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed API ${path}: ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.rows)) throw new Error(`Invalid API response: ${path}`);
  return body.rows;
}

async function loadSummaryRows() {
  if (API_BASE) return await loadApiRows("/api/summary");
  return await loadCsv("./data/daily_summary_history.csv");
}

async function loadRawRows() {
  if (API_BASE) return await loadApiRows("/api/raw-events");
  return await loadCsv("./data/raw_events_history.csv");
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
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
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
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
  return num(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function hhmmss(isoString) {
  if (!isoString) return "";
  const m = String(isoString).match(/T(\d{2}:\d{2}:\d{2})/);
  return m && m[1] ? m[1] : String(isoString);
}

function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}

function setText(id, value, cls) {
  const el = document.getElementById(id);
  if (!el) return;
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

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function renderLineBarChart(id, chartKey, labels, lineData, barPosData, barNegData, lineLabel, y2Label) {
  destroyChart(chartKey);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[chartKey] = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: lineLabel,
          data: lineData,
          borderColor: "#ff455f",
          backgroundColor: "rgba(255,69,95,.14)",
          yAxisID: "y",
          fill: false,
          tension: 0.22,
          pointRadius: 2,
        },
        {
          type: "bar",
          label: "Deposit",
          data: barPosData,
          backgroundColor: "rgba(18,161,80,.5)",
          yAxisID: "y2",
        },
        {
          type: "bar",
          label: "Withdrawal",
          data: barNegData,
          backgroundColor: "rgba(217,45,32,.5)",
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { position: "left", grid: { color: "rgba(125,140,170,.2)" } },
        y2: {
          position: "right",
          grid: { display: false },
          title: { display: true, text: y2Label },
        },
      },
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderBarChart(id, chartKey, labels, values, colorFn) {
  destroyChart(chartKey);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[chartKey] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: values.map((v) => colorFn(v)),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grid: { color: "rgba(125,140,170,.2)" } } },
    },
  });
}

function updateSnapshotStats(summaryRows) {
  const grossProfit = summaryRows.reduce((a, r) => a + num(r.gross_profit), 0);
  const grossLossAbs = Math.abs(summaryRows.reduce((a, r) => a + num(r.gross_loss), 0));
  const tradingPnl = grossProfit - grossLossAbs;
  const deposits = summaryRows.reduce((a, r) => a + num(r.total_deposit), 0);
  const withdrawals = summaryRows.reduce((a, r) => a + num(r.total_withdrawal), 0);
  const gainPct = deposits > 0 ? tradingPnl / deposits : 0;

  let cumTrade = 0;
  let peak = 0;
  let maxDd = 0;
  summaryRows.forEach((r) => {
    cumTrade += num(r.gross_profit) + num(r.gross_loss);
    peak = Math.max(peak, cumTrade);
    maxDd = Math.max(maxDd, peak - cumTrade);
  });

  const pf = grossLossAbs > 0 ? grossProfit / grossLossAbs : 0;

  setText("stat-abs-gain", `$${money(tradingPnl)}`, tradingPnl >= 0 ? "pos" : "neg");
  setText("stat-gain-pct", pct(gainPct), gainPct >= 0 ? "pos" : "neg");
  setText("stat-max-dd", `$${money(maxDd)}`, maxDd <= 0 ? "pos" : "neg");
  setText("stat-pf", pf > 0 ? pf.toFixed(2) : "-", pf >= 1 ? "pos" : "neg");
  setText("stat-dep", `$${money(deposits)}`);
  setText("stat-wd", `$${money(withdrawals)}`);
}

function renderPeriodsTable(summaryRows) {
  const tbody = document.querySelector("#periods-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const today = new Date();
  const rangeDefs = [
    { name: "Today", from: formatDate(today), to: formatDate(today) },
    { name: "This Week", from: formatDate(startOfWeek(today)), to: formatDate(today) },
    { name: "This Month", from: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: formatDate(today) },
    { name: "This Year", from: formatDate(new Date(today.getFullYear(), 0, 1)), to: formatDate(today) },
  ];

  rangeDefs.forEach((p) => {
    const rows = summaryRows.filter((r) => inRange(r.trade_date_vn, p.from, p.to));
    const grossProfit = rows.reduce((a, r) => a + num(r.gross_profit), 0);
    const grossLoss = rows.reduce((a, r) => a + num(r.gross_loss), 0);
    const tradingPnl = grossProfit + grossLoss;
    const netPnl = rows.reduce((a, r) => a + num(r.net_profit), 0);
    const wins = rows.reduce((a, r) => a + num(r.win_positions), 0);
    const losses = rows.reduce((a, r) => a + num(r.loss_positions), 0);
    const wr = wins + losses > 0 ? wins / (wins + losses) : 0;
    const trades = rows.reduce((a, r) => a + num(r.total_deals), 0);
    const positions = rows.reduce((a, r) => a + num(r.total_positions), 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td class="${tradingPnl >= 0 ? "pos" : "neg"}">$${money(tradingPnl)}</td>
      <td class="${netPnl >= 0 ? "pos" : "neg"}">$${money(netPnl)}</td>
      <td>${pct(wr)}</td>
      <td>${trades}</td>
      <td>${positions}</td>`;
    tbody.appendChild(tr);
  });
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d) {
  const c = new Date(d);
  const day = c.getDay();
  const diff = c.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(c.setDate(diff));
}

function renderAdvancedCharts(summaryRows, rawRows) {
  const daily = summaryRows
    .slice()
    .sort((a, b) => a.trade_date_vn.localeCompare(b.trade_date_vn))
    .map((r) => ({
      date: r.trade_date_vn,
      tradePnl: num(r.gross_profit) + num(r.gross_loss),
      net: num(r.net_profit),
      deposit: num(r.total_deposit),
      withdrawal: num(r.total_withdrawal),
    }));

  let cumTrade = 0;
  let peak = 0;
  const growthLine = [];
  const drawdownLine = [];
  const depBars = [];
  const wdBars = [];
  daily.forEach((d) => {
    cumTrade += d.tradePnl;
    peak = Math.max(peak, cumTrade);
    growthLine.push(cumTrade);
    drawdownLine.push(-(peak - cumTrade));
    depBars.push(d.deposit > 0 ? d.deposit : 0);
    wdBars.push(d.withdrawal > 0 ? -d.withdrawal : 0);
  });

  renderLineBarChart(
    "growth-chart",
    "growth",
    daily.map((d) => d.date),
    growthLine,
    depBars,
    wdBars,
    "Growth ($)",
    "Cashflow ($)"
  );

  renderBarChart(
    "drawdown-chart",
    "drawdown",
    daily.map((d) => d.date),
    drawdownLine,
    (v) => (v < 0 ? "rgba(217,45,32,.6)" : "rgba(18,161,80,.5)")
  );

  const monthMap = new Map();
  daily.forEach((d) => {
    const month = d.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + d.tradePnl);
  });
  const monthLabels = Array.from(monthMap.keys()).sort();
  renderBarChart(
    "monthly-chart",
    "monthly",
    monthLabels,
    monthLabels.map((m) => monthMap.get(m) || 0),
    (v) => (v >= 0 ? "rgba(18,161,80,.65)" : "rgba(217,45,32,.65)")
  );

  const symbolMap = new Map();
  rawRows.filter((r) => (r.event_type || "") === "trade").forEach((r) => {
    const symbol = r.symbol || "N/A";
    symbolMap.set(symbol, (symbolMap.get(symbol) || 0) + num(r.profit));
  });
  const topSymbols = Array.from(symbolMap.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 10);
  renderBarChart(
    "symbol-chart",
    "symbol",
    topSymbols.map((x) => x[0]),
    topSymbols.map((x) => x[1]),
    (v) => (v >= 0 ? "rgba(18,161,80,.65)" : "rgba(217,45,32,.65)")
  );

  const wdNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const wdMap = new Map(wdNames.map((n) => [n, 0]));
  rawRows.filter((r) => (r.event_type || "") === "trade").forEach((r) => {
    const d = new Date(r.close_time_vn || r.open_time_vn || "");
    if (!Number.isNaN(d.getTime())) {
      const idx = (d.getDay() + 6) % 7;
      wdMap.set(wdNames[idx], (wdMap.get(wdNames[idx]) || 0) + num(r.profit));
    }
  });
  renderBarChart(
    "weekday-chart",
    "weekday",
    wdNames,
    wdNames.map((n) => wdMap.get(n) || 0),
    (v) => (v >= 0 ? "rgba(18,161,80,.65)" : "rgba(217,45,32,.65)")
  );

  updateSnapshotStats(summaryRows);
  renderPeriodsTable(summaryRows);
}

function applySummaryFilter() {
  const from = document.getElementById("summary-from").value;
  const to = document.getElementById("summary-to").value;
  const rows = summaryAll.filter((r) => inRange(r.trade_date_vn, from, to));

  renderKpi(rows);
  renderSummaryTable(rows);
  renderDailyNetChart(rows);

  const rawInRange = rawEvents.length
    ? rawEvents.filter((r) => inRange(r.trade_date_vn, from, to))
    : [];
  renderAdvancedCharts(rows, rawInRange);
}

function renderKpi(rows) {
  const totalNet = rows.reduce((a, r) => a + num(r.net_profit), 0);
  const totalPositions = rows.reduce((a, r) => a + num(r.total_positions), 0);
  const totalWins = rows.reduce((a, r) => a + num(r.win_positions), 0);
  const totalLoss = rows.reduce((a, r) => a + num(r.loss_positions), 0);
  const grossLoss = rows.reduce((a, r) => a + num(r.gross_loss), 0);
  const grossProfit = rows.reduce((a, r) => a + num(r.gross_profit), 0);
  const tradingPnl = grossProfit + grossLoss;
  const wr = totalWins + totalLoss > 0 ? totalWins / (totalWins + totalLoss) : 0;

  setText("kpi-trade-pnl", `$${money(tradingPnl)}`, tradingPnl >= 0 ? "pos" : "neg");
  setText("kpi-net", `$${money(totalNet)}`, totalNet >= 0 ? "pos" : "neg");
  setText("kpi-positions", totalPositions.toLocaleString("en-US"));
  setText("kpi-winrate", pct(wr));
  setText("kpi-gross-profit", `$${money(grossProfit)}`, "pos");
  setText("kpi-loss", `$${money(grossLoss)}`, "neg");

  const latest = rows[rows.length - 1];
  document.getElementById("last-updated").textContent = latest
    ? `Latest trade date: ${latest.trade_date_vn} (VN)`
    : "No data in range";
}

function renderSummaryTable(rows) {
  const tbody = document.querySelector("#summary-table tbody");
  tbody.innerHTML = "";
  rows
    .slice()
    .reverse()
    .forEach((r) => {
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

function renderDailyNetChart(rows) {
  destroyChart("dailyNet");
  const ctx = document.getElementById("pnl-chart");
  charts.dailyNet = new Chart(ctx, {
    type: "line",
    data: {
      labels: rows.map((r) => r.trade_date_vn),
      datasets: [
        {
          label: "Net Profit",
          data: rows.map((r) => num(r.net_profit)),
          borderColor: "#2e6cff",
          backgroundColor: "rgba(46,108,255,.15)",
          fill: true,
          tension: 0.28,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "rgba(125,140,170,.2)" } },
        x: { grid: { display: false } },
      },
    },
  });
}

function enrichEventsWithPositionStats(rows) {
  const byPosition = new Map();
  rows.forEach((row) => {
    const key = `${row.account_id || ""}|${(row.position_id || "").trim()}`;
    if (!row.position_id) return;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(row);
  });

  byPosition.forEach((events) => {
    events.sort((a, b) => ts(a.close_time_vn) - ts(b.close_time_vn));
    const totalPnl = events.reduce((acc, e) => acc + num(e.profit), 0);
    events.forEach((e, idx) => {
      e.deal_role =
        events.length === 1
          ? "single"
          : idx === 0
          ? "entry"
          : idx === events.length - 1
          ? "exit"
          : "adjustment";
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
  rows
    .filter((r) => (r.event_type || "") === "trade" && (r.position_id || ""))
    .forEach((r) => {
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
  Array.from(new Set(rows.map((r) => r.trade_date_vn).filter(Boolean)))
    .sort()
    .reverse()
    .forEach((d) => {
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
  filteredEvents = sortRows(filteredEvents, sortKey, sortDir, [
    "lots",
    "close_price",
    "position_pnl",
    "profit",
    "event_id",
  ]);

  filteredPositions = groupedPositions.filter((r) => {
    if ((from || to) && !inRange(r.trade_date_vn, from, to)) return false;
    if (date && r.trade_date_vn !== date) return false;
    if (symbol && !(r.symbol || "").toUpperCase().includes(symbol)) return false;
    return true;
  });
  filteredPositions = sortRows(filteredPositions, posSortKey, posSortDir, [
    "entry_price",
    "exit_price",
    "lots",
    "deals_count",
    "position_pnl",
  ]);

  currentPage = 1;
  renderCurrentView();
}

function renderEventPage() {
  const tbody = document.querySelector("#details-table tbody");
  tbody.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  filteredEvents
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .forEach((r) => {
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

  filteredPositions
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .forEach((r) => {
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

  const totalPages = Math.max(
    1,
    Math.ceil((currentView === "event" ? filteredEvents.length : filteredPositions.length) / pageSize)
  );
  document.getElementById("prev-page").disabled = currentPage <= 1;
  document.getElementById("next-page").disabled = currentPage >= totalPages;
}

function hydrateRawData(rows) {
  rawEvents = enrichEventsWithPositionStats(rows);
  groupedPositions = buildGroupedPositions(rawEvents);
  fillDateFilter(rawEvents);
  rawLoaded = true;
  rawAnalyticsLoaded = true;
  applyDetailsFilter();
  applySummaryFilter();
  const status = document.getElementById("details-status");
  status.textContent = `Loaded ${rawEvents.length} events / ${groupedPositions.length} positions (50 per page)`;
}

async function loadRawForAnalytics() {
  if (rawAnalyticsLoaded) return;
  try {
    const rows = await loadRawRows();
    hydrateRawData(rows);
  } catch {
    // keep dashboard running with summary-only analytics
  }
}

async function loadDetailsLazy() {
  if (rawLoaded) return;
  const status = document.getElementById("details-status");
  status.textContent = "Loading raw trade records...";
  try {
    const rows = await loadRawRows();
    hydrateRawData(rows);
  } catch (err) {
    status.textContent = err.message;
  }
}

function initDetailsLazyLoad() {
  const target = document.getElementById("details-section");
  const observer = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          await loadDetailsLazy();
        }
      }
    },
    { rootMargin: "120px" }
  );
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
      else {
        sortKey = key;
        sortDir = "asc";
      }
      rawLoaded && applyDetailsFilter();
    });
  });

  document.querySelectorAll("#positions-table thead th[data-psort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.psort;
      if (posSortKey === key) posSortDir = posSortDir === "asc" ? "desc" : "asc";
      else {
        posSortKey = key;
        posSortDir = "asc";
      }
      rawLoaded && applyDetailsFilter();
    });
  });

  document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderCurrentView();
    }
  });

  document.getElementById("next-page").addEventListener("click", () => {
    const total = currentView === "event" ? filteredEvents.length : filteredPositions.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage < totalPages) {
      currentPage += 1;
      renderCurrentView();
    }
  });

  document.getElementById("view-event").addEventListener("click", () => {
    currentView = "event";
    document.getElementById("view-event").classList.add("active");
    document.getElementById("view-position").classList.remove("active");
    currentPage = 1;
    rawLoaded && renderCurrentView();
  });

  document.getElementById("view-position").addEventListener("click", () => {
    currentView = "position";
    document.getElementById("view-position").classList.add("active");
    document.getElementById("view-event").classList.remove("active");
    currentPage = 1;
    rawLoaded && renderCurrentView();
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

    summaryAll = await loadSummaryRows();
    applySummaryFilter();

    loadRawForAnalytics();
    initDetailsLazyLoad();
  } catch (err) {
    document.getElementById("last-updated").textContent = err.message;
  }
}

start();
