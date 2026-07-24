# Phase 1 — Account Switcher + Equity/Drawdown + Monthly Gain

## Context Links
- Plan overview: [plan.md](plan.md)
- Brainstorm: `plans/reports/brainstorm-260724-1140-myfxbook-style-analytics-two-account-capital-ledger.md`
- Tooltip convention: `docs/chart_tooltip_convention.md`
- Existing render pipeline: `dashboard/app.js` (`applySummaryFilter`, `renderAdvancedCharts`, `hydrateRawData`, `buildGroupedPositions`)

## Overview
- Priority: P1 (foundation — Phases 2 & 3 depend on the account seam).
- Status: completed
- Add account switcher (A / B / All, default A). Build per-closed-position equity +
  drawdown-% underwater chart + monthly gain table. Make ALL existing blocks respect
  the account filter.

## Key Insights
- `daily_summary` has NO `account_id` → cannot filter existing blocks from it. Derive a
  per-account daily summary client-side from `rawEvents`, feed it through the existing
  render functions via one seam (`getActiveSummaryRows()`).
- Account B has ZERO events today → B and All≈A currently. B view must show an empty
  placeholder, not break.
- `rawEvents` may be partially loaded (pagination). Must force-load all before computing.
- Reuse global helpers from app.js (`num`, `money`, `pct`, `ts`, `destroyChart`,
  `renderBarChart`, `buildGroupedPositions`, `charts`) — do NOT re-declare them.

## Requirements
Functional:
- Segmented switcher A_main_trade(400862814) / B_profit(92234341) / All; default A;
  persisted in `localStorage("dash-account")`.
- Changing account re-renders KPIs, Daily Net, Growth/Cashflow, Drawdown, Monthly,
  Symbol, Weekday, Period Stats, Daily Summary table, Trade Details.
- Equity curve = cumulative realized PnL per CLOSED position, ordered by exit time.
- Drawdown underwater chart (% of peak) + stats: Max DD %, Max DD $, Current DD %.
- Monthly gain table: year × month grid, each cell shows month PnL `$` and gain `%`.

Non-functional: each new module <200 LOC; works on CSV fallback; Vietnamese tooltips +
formula tooltips on every new chart.

## Architecture (data flow)
```
rawEvents (full) ──ensureAllRawLoaded()──► filterRowsByAccount(rows, activeAccountId)
      │                                              │
      │                                              ├─► deriveDailySummary() ─► getActiveSummaryRows()
      │                                              │        └─► existing renderKpi / renderAdvancedCharts / tables
      │                                              └─► buildGroupedPositions() (already account-keyed)
      │                                                       └─► equity curve ─► drawdown ─► monthly table
switcher click ─► setCurrentAccount() ─► dispatch 'account:changed'
                                             └─► applySummaryFilter() + applyDetailsFilter() + renderEquityDrawdown()
```

## Related Code Files
Create:
- `dashboard/js/account-filter.js` — account state, switcher wiring, `filterRowsByAccount`,
  `deriveDailySummary(rawRows)`, dispatches `account:changed`.
- `dashboard/js/metrics-equity-drawdown.js` — equity/balance curve, drawdown, monthly table.

Modify (minimal):
- `dashboard/index.html` — add switcher markup in `.hero-top`; add equity/drawdown/monthly
  chart panels; add `<script>` tags for the two modules AFTER `app.js`. Bump `?v=` cache tag.
- `dashboard/app.js` — 4 small edits (see step 6).
- `dashboard/styles.css` — `.account-switch` segmented-button styles (reuse `.view-switch` look).

## Implementation Steps
1. **index.html — switcher.** In `.hero-top` (next to `#theme-toggle`) add:
   ```html
   <div class="account-switch" title="Chọn tài khoản để lọc toàn bộ thống kê.">
     <button data-account="400862814" class="active">A · Main</button>
     <button data-account="92234341">B · Profit</button>
     <button data-account="all">All</button>
   </div>
   ```
2. **index.html — panels.** Add a `.panel` for Equity Curve (`<canvas id="equity-chart">`),
   one for Drawdown % (`<canvas id="drawdown-pct-chart">` + stat spans
   `#stat-maxdd-pct`, `#stat-maxdd-usd`, `#stat-curdd-pct`), and one for the Monthly Gain
   table (`<table id="monthly-gain-table">`). Each chart title gets a `span.formula-tip`
   (formula text below) + a Vietnamese `title` on the panel.
3. **index.html — scripts.** After `<script src="app.js?v=...">` add:
   ```html
   <script src="js/account-filter.js?v=20260724-1"></script>
   <script src="js/metrics-equity-drawdown.js?v=20260724-1"></script>
   ```
4. **account-filter.js.**
   ```
   const ACCOUNTS = { A:"400862814", B:"92234341" };
   let activeAccountId = localStorage.getItem("dash-account") || ACCOUNTS.A; // default A
   function filterRowsByAccount(rows){
     if (activeAccountId === "all") return rows;
     return rows.filter(r => (r.account_id||"") === activeAccountId);
   }
   function setCurrentAccount(id){
     activeAccountId = id; localStorage.setItem("dash-account", id);
     document.querySelectorAll(".account-switch button")
       .forEach(b => b.classList.toggle("active", b.dataset.account === id));
     document.dispatchEvent(new CustomEvent("account:changed"));
   }
   // deriveDailySummary: group account-filtered TRADE rows by trade_date_vn,
   // reuse buildGroupedPositions() for win/loss + gross split; attach deposits/withdrawals.
   function deriveDailySummary(rawRows){
     const rows = filterRowsByAccount(rawRows);
     const positions = buildGroupedPositions(rows);              // reuse app.js global
     const byDay = new Map(); // date -> accumulator
     positions.forEach(p => {
       const d = p.trade_date_vn; const pnl = num(p.position_pnl);
       const a = byDay.get(d) || blank(d); 
       a.total_positions++; a.total_deals += num(p.deals_count);
       if (pnl >= 0){ a.win_positions++; a.gross_profit += pnl; }
       else { a.loss_positions++; a.gross_loss += pnl; }        // gross_loss stays negative
       a.net_profit += pnl; byDay.set(d, a);
     });
     rows.forEach(r => {                                         // cashflow onto day rows
       const d = r.trade_date_vn; const a = byDay.get(d) || blank(d);
       if (r.event_type === "deposit")  a.total_deposit   += num(r.profit);
       if (r.event_type === "withdrawal") a.total_withdrawal += Math.abs(num(r.profit));
       byDay.set(d, a);                                          // credit excluded (bonus)
     });
     return Array.from(byDay.values()).sort((x,y)=>x.trade_date_vn.localeCompare(y.trade_date_vn));
   }
   // blank(d): {trade_date_vn:d, gross_profit:0, gross_loss:0, net_profit:0,
   //            total_deposit:0, total_withdrawal:0, win_positions:0, loss_positions:0,
   //            total_deals:0, total_positions:0}
   // Wire buttons on DOMContentLoaded; expose deriveDailySummary/filterRowsByAccount globally.
   ```
5. **metrics-equity-drawdown.js.**
   ```
   function computeEquityCurve(rawRows){
     const positions = buildGroupedPositions(filterRowsByAccount(rawRows))
       .sort((a,b)=> ts(a.exit_time_vn) - ts(b.exit_time_vn));
     let equity=0, peak=0; const pts=[];
     positions.forEach(p=>{
       equity += num(p.position_pnl);            // trading equity (excludes cashflow)
       peak = Math.max(peak, equity);
       pts.push({ t:p.exit_time_vn, equity, peak });
     });
     return pts;
   }
   // Balance curve (for drawdown %): start at cumulative external deposits, include
   // deposits/withdrawals + trade PnL ordered by event time, exclude credit(bonus).
   function computeBalanceCurve(rawRows){
     const rows = filterRowsByAccount(rawRows)
       .filter(r=>["trade","deposit","withdrawal"].includes(r.event_type))
       .sort((a,b)=> ts(a.close_time_vn) - ts(b.close_time_vn));
     let bal=0, peak=0; const pts=[];
     rows.forEach(r=>{
       if (r.event_type==="deposit") bal += num(r.profit);
       else if (r.event_type==="withdrawal") bal += num(r.profit); // negative
       else bal += num(r.profit);                                  // trade pnl
       peak = Math.max(peak, bal);
       pts.push({ t:r.close_time_vn, bal, peak });
     });
     return pts;
   }
   // Drawdown %: dd_i = peak>0 ? (peak-bal_i)/peak : 0  (0..1, plotted as -dd% underwater)
   // Max DD % = max(dd_i); Current DD % = last dd_i; Max DD $ from equity curve = max(peak-equity).
   ```
   - Render equity as a line chart (reuse Chart.js line config style from app.js
     `renderLineBarChart` colors; a thin `renderLineChart` helper is fine, <30 LOC).
   - Render drawdown as bar via existing `renderBarChart("drawdown-pct-chart", ...)`
     feeding negative dd% values.
   - Set stat spans with `money`/`pct` + `.pos/.neg` classes.
6. **Monthly gain table.**
   ```
   // monthPnl[YYYY-MM] = sum(position_pnl for exit month)
   // balanceAtMonthStart = balance curve value at last point strictly before month start
   //   (0 for the very first month with no prior balance).
   // gainPct = balanceAtMonthStart > 0 ? monthPnl/balanceAtMonthStart : null (render "—")
   // Build year(rows) × month(cols Jan..Dec) grid; cell: `$X` over `Y%`; color pos/neg.
   ```
7. **app.js edits (minimal, 4 spots):**
   a. In `hydrateRawData`, after `applySummaryFilter()`, add:
      `document.dispatchEvent(new CustomEvent("rawdata:ready"));`
   b. Add `async function ensureAllRawLoaded(){ let g=0; while(rawApiHasMore && g<50){ if(!await loadMoreRawRowsApi()) break; g++; } }`
      and `await ensureAllRawLoaded();` at start of `loadRawForAnalytics` before `hydrateRawData`.
   c. Add seam: `function getActiveSummaryRows(){ return (rawAnalyticsLoaded && typeof deriveDailySummary==="function") ? deriveDailySummary(rawEvents) : summaryAll; }`
      In `applySummaryFilter`, replace `summaryAll.filter(...)` with `getActiveSummaryRows().filter(...)`.
   d. In `applyDetailsFilter`, add account filter: after building `filteredEvents`/`filteredPositions`, apply `filterRowsByAccount`-equivalent (`r.account_id===activeAccountId` unless "all"). (Guard with `typeof activeAccountId`.)
   - `account-filter.js` listens `account:changed` → calls `applySummaryFilter()`,
     `applyDetailsFilter()`, and `metrics-equity-drawdown.js` renderer (also listens
     `rawdata:ready`).

## Todo
- [x] Add switcher markup + `.account-switch` styles
- [x] Add equity / drawdown-% / monthly-gain panels + formula tooltips + VN titles
- [x] Add module `<script>` tags after app.js, bump `?v=`
- [x] Implement `account-filter.js` (state, wiring, `deriveDailySummary`)
- [x] Implement `metrics-equity-drawdown.js` (equity, balance, drawdown, monthly)
- [x] app.js: `ensureAllRawLoaded`, `rawdata:ready`, `getActiveSummaryRows`, details account filter
- [x] Verify B view + All render without errors (B empty today)
- [x] Manually confirm CSV-fallback path still computes

## Success Criteria
- Selecting A shows trading stats uncontaminated by any B deposits (verified when B data exists).
- Equity curve, drawdown %, monthly gain visually comparable to Myfxbook for A.
- Switching account instantly re-renders every block; default is A on load.
- No console errors on API path or CSV fallback; B/All degrade gracefully.

## Risk Assessment
- **Derived summary drift** vs pipeline `daily_summary` (position grouping, timezone).
  Mitigation: reuse `buildGroupedPositions` + `trade_date_vn` exactly as app.js does;
  spot-check derived All totals against summaryAll.
- **Drawdown % base ambiguity** (deposits inflate peak). Decision: show TRADING equity
  curve as the growth line (edge-focused, excludes cashflow); compute drawdown % on the
  BALANCE curve so the % has a non-zero capital base. Document both in tooltips.
- **Partial data if `ensureAllRawLoaded` guard trips** (>50 pages). Not a concern at
  ~830 rows; guard prevents infinite loop.

## Security Considerations
- Read-only browser compute; no secrets. Do NOT surface `account_id`/login beyond the
  labels already shown. `state/accounts.json` (contains passwords) stays out of scope.

## Next Steps
- Phase 2 reuses `filterRowsByAccount` + cashflow detection for the ledger.
- Phase 3 reuses account-filtered `buildGroupedPositions` output.
