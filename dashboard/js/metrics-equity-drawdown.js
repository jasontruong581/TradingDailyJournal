// metrics-equity-drawdown.js — equity curve, balance-based drawdown %, monthly gain.
// Loaded AFTER app.js + account-filter.js: reuses num, money, pct, ts, setText,
// destroyChart, renderBarChart, buildGroupedPositions, charts, rawEvents,
// rawAnalyticsLoaded, filterRowsByAccount, ACCOUNTS, activeAccountId.

// Balance of account A at data epoch (2026-03-02). Set if A was non-zero back then.
const INITIAL_BALANCE_A = 0;

function edStartBalance() {
  return activeAccountId === ACCOUNTS.B ? 0 : INITIAL_BALANCE_A;
}

// Trading equity: cumulative realized PnL per CLOSED position (cashflow excluded).
function computeEquityCurve(rawRows) {
  const positions = buildGroupedPositions(filterRowsByAccount(rawRows))
    .sort((a, b) => ts(a.exit_time_vn) - ts(b.exit_time_vn));
  let equity = 0;
  let peak = 0;
  return positions.map((p) => {
    equity += num(p.position_pnl);
    peak = Math.max(peak, equity);
    return { t: p.exit_time_vn, equity, peak };
  });
}

// Balance curve: external deposits/withdrawals + trade PnL in event order.
// credit (broker bonus) excluded. Gives drawdown % a real capital base.
function computeBalanceCurve(rawRows) {
  const rows = filterRowsByAccount(rawRows)
    .filter((r) => ["trade", "deposit", "withdrawal"].includes(r.event_type || ""))
    .sort((a, b) => ts(a.close_time_vn) - ts(b.close_time_vn));
  let bal = edStartBalance();
  let peak = Math.max(0, bal);
  return rows.map((r) => {
    bal += num(r.profit); // deposit +, withdrawal - (raw sign), trade pnl +/-
    peak = Math.max(peak, bal);
    // dd capped at 100%: balance can dip below 0 because epoch starts at data
    // start with INITIAL_BALANCE_A=0 (pre-epoch capital not recorded).
    const dd = peak > 0 ? Math.min(1, (peak - bal) / peak) : 0;
    return { t: r.close_time_vn, bal, peak, dd };
  });
}

function renderLineChart(id, chartKey, labels, values, label) {
  destroyChart(chartKey);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[chartKey] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: "#2e6cff",
        backgroundColor: "rgba(46,108,255,.12)",
        fill: true,
        tension: 0.2,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "rgba(125,140,170,.2)" } },
        x: { ticks: { maxTicksLimit: 10 } },
      },
    },
  });
}

function edLabelDay(iso) {
  return String(iso || "").slice(0, 10);
}

const ED_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Month gain % = month PnL / balance at start of month (TWR building block).
function renderMonthlyGainTable(balancePts) {
  const table = document.getElementById("monthly-gain-table");
  if (!table) return;
  const positions = buildGroupedPositions(filterRowsByAccount(rawEvents));
  const monthPnl = new Map();
  positions.forEach((p) => {
    const ym = String(p.exit_time_vn || "").slice(0, 7);
    if (ym) monthPnl.set(ym, (monthPnl.get(ym) || 0) + num(p.position_pnl));
  });

  const balanceAtMonthStart = (ym) => {
    const t0 = Date.parse(`${ym}-01T00:00:00+07:00`);
    let b = edStartBalance();
    for (const p of balancePts) {
      if (ts(p.t) >= t0) break;
      b = p.bal;
    }
    return b;
  };

  const years = Array.from(new Set(Array.from(monthPnl.keys()).map((m) => m.slice(0, 4)))).sort();
  if (!years.length) {
    table.innerHTML = '<tbody><tr><td class="muted-note">Chưa có dữ liệu tháng cho tài khoản này.</td></tr></tbody>';
    return;
  }

  let html = "<thead><tr><th>Year</th>" + ED_MONTH_NAMES.map((m) => `<th>${m}</th>`).join("") + "<th>Total</th></tr></thead><tbody>";
  years.forEach((y) => {
    let yearTotal = 0;
    html += `<tr><td>${y}</td>`;
    for (let m = 1; m <= 12; m += 1) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      if (!monthPnl.has(ym)) {
        html += '<td class="muted-note">—</td>';
        continue;
      }
      const pnl = monthPnl.get(ym);
      yearTotal += pnl;
      const base = balanceAtMonthStart(ym);
      const gain = base > 0 ? pnl / base : null;
      html += `<td class="${pnl >= 0 ? "pos" : "neg"}"><div>$${money(pnl)}</div><div class="cell-sub">${gain === null ? "—" : pct(gain)}</div></td>`;
    }
    html += `<td class="${yearTotal >= 0 ? "pos" : "neg"}">$${money(yearTotal)}</td></tr>`;
  });
  html += "</tbody>";
  table.innerHTML = html;
}

function renderEquityDrawdown() {
  const eq = computeEquityCurve(rawEvents);
  const bal = computeBalanceCurve(rawEvents);
  const empty = !eq.length;
  const note = document.getElementById("equity-empty-note");
  if (note) note.classList.toggle("hidden", !empty);

  renderLineChart("equity-chart", "equityCurve", eq.map((p) => edLabelDay(p.t)), eq.map((p) => p.equity), "Equity ($)");

  renderBarChart(
    "drawdown-pct-chart",
    "drawdownPct",
    bal.map((p) => edLabelDay(p.t)),
    bal.map((p) => -(p.dd * 100)),
    (v) => (v < 0 ? "rgba(217,45,32,.6)" : "rgba(18,161,80,.5)")
  );

  const maxDdPct = bal.reduce((m, p) => Math.max(m, p.dd), 0);
  const curDdPct = bal.length ? bal[bal.length - 1].dd : 0;
  const maxDdUsd = eq.reduce((m, p) => Math.max(m, p.peak - p.equity), 0);
  setText("stat-maxdd-pct", empty ? "—" : pct(maxDdPct), maxDdPct > 0 ? "neg" : "pos");
  setText("stat-maxdd-usd", empty ? "—" : `$${money(maxDdUsd)}`, maxDdUsd > 0 ? "neg" : "pos");
  setText("stat-curdd-pct", empty ? "—" : pct(curDdPct), curDdPct > 0 ? "neg" : "pos");

  renderMonthlyGainTable(bal);
}

document.addEventListener("rawdata:ready", renderEquityDrawdown);
document.addEventListener("account:changed", () => {
  if (rawAnalyticsLoaded) renderEquityDrawdown();
});
