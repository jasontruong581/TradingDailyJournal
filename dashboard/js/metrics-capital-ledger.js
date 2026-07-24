// metrics-capital-ledger.js — 2-account capital ledger + A→B transfer matching.
// Operates on the FULL unfiltered rawEvents (needs both accounts). Loaded AFTER
// app.js + account-filter.js + metrics-equity-drawdown.js: reuses num, money, pct,
// setText, buildGroupedPositions, rawEvents, ACCOUNTS, INITIAL_BALANCE_A.

const TRANSFER_TOL = 0.01; // 1 cent — same-day, same-amount pairing tolerance
// Escape hatch for future mis-matched pairs: [{ withdrawal_event_id, deposit_event_id }]
const MANUAL_OVERRIDES = [];

function ledgerBuckets(rows) {
  const b = { depositsA: [], withdrawalsA: [], creditsA: [], depositsB: [], withdrawalsB: [] };
  rows.forEach((r) => {
    const acc = r.account_id || "";
    const type = r.event_type || "";
    if (acc === ACCOUNTS.A) {
      if (type === "deposit") b.depositsA.push(r);
      else if (type === "withdrawal") b.withdrawalsA.push(r);
      else if (type === "credit") b.creditsA.push(r);
    } else if (acc === ACCOUNTS.B) {
      if (type === "deposit") b.depositsB.push(r);
      else if (type === "withdrawal") b.withdrawalsB.push(r);
    }
  });
  return b;
}

// A→B transfer = withdrawal on A + deposit on B, same VN date, equal amount (±tol).
function matchTransfers(withdrawalsA, depositsB) {
  const matchedA = new Set();
  const matchedB = new Set();
  const transfers = [];
  withdrawalsA.forEach((w, i) => {
    const j = depositsB.findIndex(
      (d, k) =>
        !matchedB.has(k) &&
        d.trade_date_vn === w.trade_date_vn &&
        Math.abs(Math.abs(num(d.profit)) - Math.abs(num(w.profit))) <= TRANSFER_TOL
    );
    if (j >= 0) {
      matchedA.add(i);
      matchedB.add(j);
      transfers.push({ date: w.trade_date_vn, amount: Math.abs(num(w.profit)) });
    }
  });
  return { transfers, matchedA, matchedB };
}

function computeLedger(rows) {
  const b = ledgerBuckets(rows);
  const { transfers, matchedA, matchedB } = matchTransfers(b.withdrawalsA, b.depositsB);
  const sumAbsUnmatched = (arr, matched) =>
    arr.reduce((a, r, i) => (matched.has(i) ? a : a + Math.abs(num(r.profit))), 0);

  const externalIn = b.depositsA.reduce((a, r) => a + num(r.profit), 0);
  const netCapitalIn = INITIAL_BALANCE_A + externalIn - sumAbsUnmatched(b.withdrawalsA, matchedA);
  const profitTaken = transfers.reduce((a, t) => a + t.amount, 0);
  // Every B withdrawal is external cash-out: the receiving leg of an A→B
  // transfer is a B DEPOSIT (matchedB indexes depositsB), never a withdrawal.
  const cashOut = b.withdrawalsB.reduce((a, r) => a + Math.abs(num(r.profit)), 0);
  const positionsA = buildGroupedPositions(rows.filter((r) => (r.account_id || "") === ACCOUNTS.A));
  const tradingPnlA = positionsA.reduce((a, p) => a + num(p.position_pnl), 0);

  return {
    netCapitalIn,
    profitTaken,
    cashOut,
    retained: tradingPnlA - profitTaken, // paper profit still working in A
    realizedGainPct: netCapitalIn > 0 ? profitTaken / netCapitalIn : null, // true gain (user rule)
    totalGainPct: netCapitalIn > 0 ? tradingPnlA / netCapitalIn : null, // paper + realized
    bonus: b.creditsA.reduce((a, r) => a + num(r.profit), 0), // display-only, NOT capital
    transferCount: transfers.length,
    unmatchedWithdrawalsA: b.withdrawalsA.length - matchedA.size,
    hasWithdrawals: b.withdrawalsA.length + b.withdrawalsB.length > 0,
  };
}

function setLedgerPct(id, value, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value === null) {
    setText(id, "—");
    el.title = "Chưa có vốn nạp để tính %.";
  } else {
    setText(id, pct(value), cls);
    el.title = "";
  }
}

function renderLedger() {
  const L = computeLedger(rawEvents);
  setText("ledger-capital-in", `$${money(L.netCapitalIn)}`);
  setText("ledger-profit-taken", `$${money(L.profitTaken)}`, L.profitTaken > 0 ? "pos" : undefined);
  setText("ledger-cashout", `$${money(L.cashOut)}`);
  setText("ledger-retained", `$${money(L.retained)}`, L.retained >= 0 ? "pos" : "neg");
  setLedgerPct("ledger-realized-gain", L.realizedGainPct, L.realizedGainPct >= 0 ? "pos" : "neg");
  setLedgerPct("ledger-total-gain", L.totalGainPct, L.totalGainPct >= 0 ? "pos" : "neg");
  setText("ledger-bonus", `$${money(L.bonus)}`);

  const matchedText = `${L.transferCount} lệnh khớp A→B` +
    (L.unmatchedWithdrawalsA > 0 ? ` · ${L.unmatchedWithdrawalsA} lệnh rút A chưa khớp (tính là rút ngoài)` : "");
  setText("ledger-matched", matchedText);

  const note = document.getElementById("ledger-empty-note");
  if (note) note.classList.toggle("hidden", L.hasWithdrawals);
}

document.addEventListener("rawdata:ready", renderLedger);
// Ledger is global (A/B roles fixed) — re-render on account change is harmless.
document.addEventListener("account:changed", () => {
  if (rawAnalyticsLoaded) renderLedger();
});
