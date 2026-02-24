let pnlChart = null;
let rawEvents = [];
let filteredEvents = [];
let rawLoaded = false;
let currentPage = 1;
const pageSize = 50;

function ts(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
}

async function loadCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const text = await res.text();
  return parseCsv(text);
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
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function money(value, digits = 2) {
  return num(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function setText(id, value, cls) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.classList.remove("pos", "neg");
  if (cls) el.classList.add(cls);
}

function renderKpi(summaryRows) {
  const totalNet = summaryRows.reduce((acc, r) => acc + num(r.net_profit), 0);
  const totalPositions = summaryRows.reduce((acc, r) => acc + num(r.total_positions), 0);
  const totalWins = summaryRows.reduce((acc, r) => acc + num(r.win_positions), 0);
  const totalLoss = summaryRows.reduce((acc, r) => acc + num(r.loss_positions), 0);
  const grossLoss = summaryRows.reduce((acc, r) => acc + num(r.gross_loss), 0);
  const grossProfit = summaryRows.reduce((acc, r) => acc + num(r.gross_profit), 0);

  const tradingPnl = grossProfit + grossLoss;
  const wrBase = totalWins + totalLoss;
  const wr = wrBase > 0 ? totalWins / wrBase : 0;

  setText("kpi-trade-pnl", `$${money(tradingPnl, 2)}`, tradingPnl >= 0 ? "pos" : "neg");
  setText("kpi-net", `$${money(totalNet, 2)}`, totalNet >= 0 ? "pos" : "neg");
  setText("kpi-positions", totalPositions.toLocaleString("en-US"));
  setText("kpi-winrate", pct(wr));
  setText("kpi-gross-profit", `$${money(grossProfit, 2)}`, "pos");
  setText("kpi-loss", `$${money(grossLoss, 2)}`, "neg");

  const latest = summaryRows[summaryRows.length - 1];
  document.getElementById("last-updated").textContent =
    latest ? `Latest trade date: ${latest.trade_date_vn} (VN)` : "No data";
}

function renderSummaryTable(rows) {
  const tbody = document.querySelector("#summary-table tbody");
  tbody.innerHTML = "";

  rows.slice().reverse().slice(0, 60).forEach((r) => {
    const tr = document.createElement("tr");
    const net = num(r.net_profit);
    const tradePnl = num(r.gross_profit) + num(r.gross_loss);
    const cashFlow = num(r.total_deposit) - num(r.total_withdrawal);
    tr.innerHTML = `
      <td>${r.trade_date_vn}</td>
      <td>${num(r.total_positions)}</td>
      <td>${num(r.total_deals)}</td>
      <td>${num(r.win_positions)}</td>
      <td>${num(r.loss_positions)}</td>
      <td class="${tradePnl >= 0 ? "pos" : "neg"}">$${money(tradePnl)}</td>
      <td class="${cashFlow >= 0 ? "pos" : "neg"}">$${money(cashFlow)}</td>
      <td class="${net >= 0 ? "pos" : "neg"}">$${money(net)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderChart(rows) {
  const ctx = document.getElementById("pnl-chart");
  const labels = rows.map((r) => r.trade_date_vn);
  const values = rows.map((r) => num(r.net_profit));

  if (pnlChart) pnlChart.destroy();

  pnlChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Net Profit",
          data: values,
          borderColor: "#2e6cff",
          backgroundColor: "rgba(46, 108, 255, 0.15)",
          fill: true,
          tension: 0.28,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "#eef3fd" } },
        x: { grid: { display: false } },
      },
    },
  });
}

function fillDateFilter(rows) {
  const dateSelect = document.getElementById("filter-date");
  const dates = Array.from(new Set(rows.map((r) => r.trade_date_vn).filter(Boolean))).sort().reverse();
  dates.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    dateSelect.appendChild(opt);
  });
}

function applyDetailsFilter() {
  const date = document.getElementById("filter-date").value;
  const action = document.getElementById("filter-action").value;
  const symbol = document.getElementById("filter-symbol").value.trim().toUpperCase();

  filteredEvents = rawEvents.filter((r) => {
    if (date && r.trade_date_vn !== date) return false;
    if (action && r.action !== action) return false;
    if (symbol && !(r.symbol || "").toUpperCase().includes(symbol)) return false;
    return true;
  });

  currentPage = 1;
  renderDetailsPage();
}

function enrichEventsWithPositionStats(rows) {
  const byPosition = new Map();
  rows.forEach((row) => {
    const key = (row.position_id || "").trim();
    if (!key) return;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(row);
  });

  byPosition.forEach((events, positionId) => {
    events.sort((a, b) => ts(a.close_time_vn) - ts(b.close_time_vn));
    const totalPnl = events.reduce((acc, e) => acc + num(e.profit), 0);
    const lastIndex = events.length - 1;
    events.forEach((e, idx) => {
      let role = "adjustment";
      if (events.length === 1) role = "single";
      else if (idx === 0) role = "entry";
      else if (idx === lastIndex) role = "exit";
      e.deal_role = role;
      e.position_pnl = String(totalPnl);
      e.position_id = positionId;
    });
  });

  rows.forEach((row) => {
    if (!row.deal_role) row.deal_role = "n/a";
    if (!row.position_pnl) row.position_pnl = row.profit || "0";
  });

  return rows;
}

function renderDetailsPage() {
  const tbody = document.querySelector("#details-table tbody");
  tbody.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const rows = filteredEvents.slice(start, start + pageSize);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const p = num(r.profit);
    const posPnl = num(r.position_pnl);
    tr.innerHTML = `
      <td>${r.trade_date_vn || ""}</td>
      <td>${r.close_time_vn || ""}</td>
      <td>${r.event_id || ""}</td>
      <td>${r.position_id || ""}</td>
      <td>${r.deal_role || ""}</td>
      <td>${r.action || ""}</td>
      <td>${r.symbol || ""}</td>
      <td>${r.lots || ""}</td>
      <td>${r.close_price || ""}</td>
      <td class="${posPnl >= 0 ? "pos" : "neg"}">$${money(posPnl, 2)}</td>
      <td class="${p >= 0 ? "pos" : "neg"}">$${money(p, 2)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("page-info").textContent = `Page ${currentPage} / ${totalPages} (Total ${filteredEvents.length})`;
  document.getElementById("prev-page").disabled = currentPage <= 1;
  document.getElementById("next-page").disabled = currentPage >= totalPages;
}

async function loadDetailsLazy() {
  if (rawLoaded) return;
  rawLoaded = true;

  const status = document.getElementById("details-status");
  status.textContent = "Loading raw trade records...";

  rawEvents = enrichEventsWithPositionStats(await loadCsv("./data/raw_events_history.csv"));
  filteredEvents = rawEvents;
  fillDateFilter(rawEvents);
  renderDetailsPage();

  status.textContent = `Loaded ${rawEvents.length} records (50 per page)`;
}

function initDetailsLazyLoad() {
  const target = document.getElementById("details-section");
  const observer = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          try {
            await loadDetailsLazy();
          } catch (err) {
            document.getElementById("details-status").textContent = err.message;
          }
        }
      }
    },
    { rootMargin: "120px" }
  );
  observer.observe(target);
}

function bindEvents() {
  ["filter-date", "filter-action", "filter-symbol"].forEach((id) => {
    document.getElementById(id).addEventListener("input", applyDetailsFilter);
  });

  document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderDetailsPage();
    }
  });

  document.getElementById("next-page").addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
    if (currentPage < totalPages) {
      currentPage += 1;
      renderDetailsPage();
    }
  });
}

async function start() {
  try {
    const summaryRows = await loadCsv("./data/daily_summary_history.csv");

    if (!summaryRows.length) {
      document.getElementById("last-updated").textContent = "No summary records yet";
      return;
    }

    renderKpi(summaryRows);
    renderSummaryTable(summaryRows);
    renderChart(summaryRows);

    bindEvents();
    initDetailsLazyLoad();
  } catch (err) {
    document.getElementById("last-updated").textContent = err.message;
  }
}

start();
