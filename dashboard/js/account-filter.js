// account-filter.js — account switcher state + per-account daily summary.
// Loaded AFTER app.js (shared global scope): reuses num, buildGroupedPositions,
// rawEvents, rawLoaded, applySummaryFilter, applyDetailsFilter.

const ACCOUNTS = { A: "400862814", B: "92234341" };

let activeAccountId = localStorage.getItem("dash-account") || ACCOUNTS.A;
if (![ACCOUNTS.A, ACCOUNTS.B, "all"].includes(activeAccountId)) activeAccountId = ACCOUNTS.A;

function filterRowsByAccount(rows) {
  if (activeAccountId === "all") return rows;
  return rows.filter((r) => (r.account_id || "") === activeAccountId);
}

function blankDaySummary(date) {
  return {
    trade_date_vn: date,
    total_positions: 0,
    total_deals: 0,
    win_positions: 0,
    loss_positions: 0,
    gross_profit: 0,
    gross_loss: 0, // stays negative, same convention as pipeline daily_summary
    net_profit: 0,
    total_deposit: 0,
    total_withdrawal: 0,
  };
}

// Derive daily_summary-shaped rows from account-filtered raw events.
// credit events (broker bonus) are excluded from cashflow columns by design.
function deriveDailySummary(rawRows) {
  const rows = filterRowsByAccount(rawRows);
  const byDay = new Map();
  const dayOf = (d) => {
    if (!byDay.has(d)) byDay.set(d, blankDaySummary(d));
    return byDay.get(d);
  };

  buildGroupedPositions(rows).forEach((p) => {
    const acc = dayOf(p.trade_date_vn || "");
    const pnl = num(p.position_pnl);
    acc.total_positions += 1;
    acc.total_deals += num(p.deals_count);
    if (pnl >= 0) {
      acc.win_positions += 1;
      acc.gross_profit += pnl;
    } else {
      acc.loss_positions += 1;
      acc.gross_loss += pnl;
    }
    acc.net_profit += pnl;
  });

  rows.forEach((r) => {
    if (r.event_type === "deposit") dayOf(r.trade_date_vn || "").total_deposit += num(r.profit);
    else if (r.event_type === "withdrawal") dayOf(r.trade_date_vn || "").total_withdrawal += Math.abs(num(r.profit));
  });

  return Array.from(byDay.values()).sort((a, b) => a.trade_date_vn.localeCompare(b.trade_date_vn));
}

function syncAccountButtons() {
  document.querySelectorAll(".account-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.account === activeAccountId);
  });
}

function setCurrentAccount(id) {
  activeAccountId = id;
  localStorage.setItem("dash-account", id);
  syncAccountButtons();
  document.dispatchEvent(new CustomEvent("account:changed"));
}

(function initAccountSwitch() {
  document.querySelectorAll(".account-switch button").forEach((b) => {
    b.addEventListener("click", () => setCurrentAccount(b.dataset.account));
  });
  syncAccountButtons();
})();

document.addEventListener("account:changed", () => {
  applySummaryFilter();
  if (rawLoaded) applyDetailsFilter();
});
