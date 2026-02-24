let pnlChart = null;
let rawEvents = [];

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
      row[h] = cols[i] ?? "";
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  return num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
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

function renderKpi(rows) {
  const totalNet = rows.reduce((acc, r) => acc + num(r.net_profit), 0);
  const totalPositions = rows.reduce((acc, r) => acc + num(r.total_positions), 0);
  const totalWins = rows.reduce((acc, r) => acc + num(r.win_positions), 0);
  const totalLoss = rows.reduce((acc, r) => acc + num(r.loss_positions), 0);
  const grossLoss = rows.reduce((acc, r) => acc + num(r.gross_loss), 0);

  const wrBase = totalWins + totalLoss;
  const wr = wrBase > 0 ? totalWins / wrBase : 0;

  setText("kpi-net", `$${money(totalNet)}`, totalNet >= 0 ? "pos" : "neg");
  setText("kpi-positions", totalPositions.toLocaleString("en-US"));
  setText("kpi-winrate", pct(wr));
  setText("kpi-loss", `$${money(grossLoss)}`, "neg");

  const latest = rows[rows.length - 1];
  document.getElementById("last-updated").textContent =
    latest ? `Latest trade date: ${latest.trade_date_vn} (VN)` : "No data";
}

function renderSummaryTable(rows) {
  const tbody = document.querySelector("#summary-table tbody");
  tbody.innerHTML = "";

  rows.slice().reverse().slice(0, 30).forEach((r) => {
    const tr = document.createElement("tr");
    const net = num(r.net_profit);
    tr.innerHTML = `
      <td>${r.trade_date_vn}</td>
      <td>${num(r.total_positions)}</td>
      <td>${num(r.total_deals)}</td>
      <td>${num(r.win_positions)}</td>
      <td>${num(r.loss_positions)}</td>
      <td class="${net >= 0 ? "pos" : "neg"}">$${money(net)}</td>
      <td>$${money(r.total_withdrawal)}</td>
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
          borderColor: "#1f8f54",
          backgroundColor: "rgba(31, 143, 84, 0.2)",
          fill: true,
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "#edf4ee" } },
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

  let rows = rawEvents;
  if (date) rows = rows.filter((r) => r.trade_date_vn === date);
  if (action) rows = rows.filter((r) => r.action === action);
  if (symbol) rows = rows.filter((r) => (r.symbol || "").toUpperCase().includes(symbol));

  renderDetailsTable(rows.slice(0, 500));
}

function renderDetailsTable(rows) {
  const tbody = document.querySelector("#details-table tbody");
  tbody.innerHTML = "";

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const p = num(r.profit);
    tr.innerHTML = `
      <td>${r.trade_date_vn || ""}</td>
      <td>${r.close_time_vn || ""}</td>
      <td>${r.event_id || ""}</td>
      <td>${r.position_id || ""}</td>
      <td>${r.action || ""}</td>
      <td>${r.symbol || ""}</td>
      <td>${r.lots || ""}</td>
      <td>${r.close_price || ""}</td>
      <td class="${p >= 0 ? "pos" : "neg"}">$${money(p)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function start() {
  try {
    const [summaryRows, rawRows] = await Promise.all([
      loadCsv("./data/daily_summary_history.csv"),
      loadCsv("./data/raw_events_history.csv"),
    ]);

    if (!summaryRows.length) {
      document.getElementById("last-updated").textContent = "No summary records yet";
      return;
    }

    renderKpi(summaryRows);
    renderSummaryTable(summaryRows);
    renderChart(summaryRows);

    rawEvents = rawRows;
    fillDateFilter(rawRows);
    renderDetailsTable(rawRows.slice(0, 500));

    ["filter-date", "filter-action", "filter-symbol"].forEach((id) => {
      document.getElementById(id).addEventListener("input", applyDetailsFilter);
    });
  } catch (err) {
    document.getElementById("last-updated").textContent = err.message;
  }
}

start();
