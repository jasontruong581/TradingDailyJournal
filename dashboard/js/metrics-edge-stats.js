// metrics-edge-stats.js — trade-edge metrics for the active account: expectancy,
// payoff, streaks, hour/duration/lot breakdowns, long vs short, best/worst trade.
// Loaded AFTER app.js + account-filter.js: reuses num, money, pct, ts, setText,
// renderBarChart, buildGroupedPositions, rawEvents, rawAnalyticsLoaded, filterRowsByAccount.

const EDGE_HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const EDGE_DURATION_BUCKETS = [
  { label: "<5m", max: 300 },
  { label: "5–30m", max: 1800 },
  { label: "30m–2h", max: 7200 },
  { label: "2–8h", max: 28800 },
  { label: ">8h", max: Infinity },
];
const EDGE_LOT_BUCKETS = [
  { label: "<0.05", max: 0.05 },
  { label: "0.05–0.1", max: 0.1 },
  { label: "0.1–0.5", max: 0.5 },
  { label: ">0.5", max: Infinity },
];

function edgePositions() {
  return buildGroupedPositions(filterRowsByAccount(rawEvents))
    .map((p) => ({ ...p, pnl: num(p.position_pnl) }))
    .sort((a, b) => ts(a.exit_time_vn) - ts(b.exit_time_vn));
}

function edgeMean(arr) {
  return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0;
}

function edgeStreaks(pos) {
  let win = 0, loss = 0, maxWin = 0, maxLoss = 0;
  pos.forEach((p) => {
    if (p.pnl >= 0) { win += 1; loss = 0; } else { loss += 1; win = 0; }
    maxWin = Math.max(maxWin, win);
    maxLoss = Math.max(maxLoss, loss);
  });
  return { maxWin, maxLoss };
}

// Entry hour parsed from the ISO string (data is already GMT+7) to avoid browser-tz shift.
function edgeEntryHour(p) {
  const m = String(p.entry_time_vn || "").match(/T(\d{2})/);
  return m ? m[1] : "";
}

function edgeBucketLabel(value, buckets) {
  const b = buckets.find((x) => value < x.max);
  return b ? b.label : buckets[buckets.length - 1].label;
}

function edgeGroupPnl(pos, labels, keyFn) {
  const sums = new Map(labels.map((l) => [l, 0]));
  pos.forEach((p) => {
    const k = keyFn(p);
    if (sums.has(k)) sums.set(k, sums.get(k) + p.pnl);
  });
  return labels.map((l) => sums.get(l));
}

function edgeRenderSideTable(pos) {
  const table = document.getElementById("edge-side-table");
  if (!table) return;
  const rows = [
    { name: "Long (Buy)", items: pos.filter((p) => p.side === "Buy") },
    { name: "Short (Sell)", items: pos.filter((p) => p.side === "Sell") },
  ];
  let html = "<thead><tr><th>Side</th><th>Trades</th><th>Win %</th><th>Net PnL</th></tr></thead><tbody>";
  rows.forEach((r) => {
    const wins = r.items.filter((p) => p.pnl >= 0).length;
    const net = r.items.reduce((a, p) => a + p.pnl, 0);
    html += `<tr><td>${r.name}</td><td>${r.items.length}</td>` +
      `<td>${r.items.length ? pct(wins / r.items.length) : "—"}</td>` +
      `<td class="${net >= 0 ? "pos" : "neg"}">$${money(net)}</td></tr>`;
  });
  table.innerHTML = html + "</tbody>";
}

function edgeRenderExtremeCard(id, title, p) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!p) {
    el.innerHTML = `<span>${title}</span><strong class="muted-note">—</strong>`;
    return;
  }
  el.innerHTML = `<span>${title}</span>` +
    `<strong class="${p.pnl >= 0 ? "pos" : "neg"}">$${money(p.pnl)}</strong>` +
    `<small>${p.symbol || "?"} · ${String(p.exit_time_vn || "").slice(0, 10)}</small>`;
}

function renderEdgeStats() {
  const pos = edgePositions();
  const wins = pos.filter((p) => p.pnl >= 0);
  const losses = pos.filter((p) => p.pnl < 0);
  const avgWin = edgeMean(wins.map((p) => p.pnl));
  const avgLoss = edgeMean(losses.map((p) => p.pnl)); // negative
  const expectancy = edgeMean(pos.map((p) => p.pnl));
  const payoff = avgLoss ? avgWin / Math.abs(avgLoss) : 0;
  const expectancyR = avgLoss ? expectancy / Math.abs(avgLoss) : 0; // avg-loss proxy (no SL data)
  const { maxWin, maxLoss } = edgeStreaks(pos);
  const empty = !pos.length;

  setText("edge-expectancy", empty ? "—" : `$${money(expectancy)}`, expectancy >= 0 ? "pos" : "neg");
  setText("edge-expectancy-r", empty ? "—" : `${expectancyR.toFixed(2)}R`, expectancyR >= 0 ? "pos" : "neg");
  setText("edge-avg-win", empty ? "—" : `$${money(avgWin)}`, "pos");
  setText("edge-avg-loss", empty ? "—" : `$${money(avgLoss)}`, "neg");
  setText("edge-payoff", empty ? "—" : payoff.toFixed(2), payoff >= 1 ? "pos" : "neg");
  setText("edge-win-streak", empty ? "—" : String(maxWin), "pos");
  setText("edge-loss-streak", empty ? "—" : String(maxLoss), "neg");

  const colorFn = (v) => (v >= 0 ? "rgba(18,161,80,.65)" : "rgba(217,45,32,.65)");
  renderBarChart("edge-hour-chart", "edgeHour", EDGE_HOUR_LABELS,
    edgeGroupPnl(pos, EDGE_HOUR_LABELS, edgeEntryHour), colorFn);

  const durLabels = EDGE_DURATION_BUCKETS.map((b) => b.label);
  renderBarChart("edge-duration-chart", "edgeDuration", durLabels,
    edgeGroupPnl(pos, durLabels, (p) => edgeBucketLabel((ts(p.exit_time_vn) - ts(p.entry_time_vn)) / 1000, EDGE_DURATION_BUCKETS)), colorFn);

  const lotLabels = EDGE_LOT_BUCKETS.map((b) => b.label);
  renderBarChart("edge-lot-chart", "edgeLot", lotLabels,
    edgeGroupPnl(pos, lotLabels, (p) => edgeBucketLabel(num(p.lots), EDGE_LOT_BUCKETS)), colorFn);

  edgeRenderSideTable(pos);
  const best = pos.reduce((m, p) => (m === null || p.pnl > m.pnl ? p : m), null);
  const worst = pos.reduce((m, p) => (m === null || p.pnl < m.pnl ? p : m), null);
  edgeRenderExtremeCard("edge-best", "Best trade", best);
  edgeRenderExtremeCard("edge-worst", "Worst trade", worst);
}

document.addEventListener("rawdata:ready", renderEdgeStats);
document.addEventListener("account:changed", () => {
  if (rawAnalyticsLoaded) renderEdgeStats();
});
