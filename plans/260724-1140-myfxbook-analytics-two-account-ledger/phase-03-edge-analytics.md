# Phase 3 — Edge Analytics

## Context Links
- Plan overview: [plan.md](plan.md)
- Phase 1 (account seam + `buildGroupedPositions` account-filtered): [phase-01](phase-01-account-filter-equity-drawdown.md)
- Tooltip convention: `docs/chart_tooltip_convention.md`

## Overview
- Priority: P2
- Status: completed
- Trade-edge metrics for the active account: expectancy ($ and R), avg win vs avg loss,
  payoff ratio, max consecutive win/loss streaks, performance by entry hour (VN),
  holding-duration buckets, lot-size buckets, long vs short, best/worst trade.

## Key Insights
- **0/816 trades have a stop-loss** (verified) → SL-based R-multiple impossible.
  Fallback: R unit = |avg loss|; R-expectancy = expectancy$ / |avgLoss|. Document clearly.
- `duration_sec` is 0/unreliable → compute holding time from
  `exit_time_vn − entry_time_vn` (grouped position timestamps).
- Long/short from the FIRST deal's `action` (Buy=long, Sell=short).
- All stats operate on account-filtered grouped positions → recompute on `account:changed`.
- Reuse `buildGroupedPositions`, `num`, `money`, `pct`, `ts`, `renderBarChart` globals.

## Requirements
Functional (active account, current summary date range if feasible else all-time — default
all-time positions, documented):
- Expectancy $ = mean(position_pnl). Equivalent: winRate·avgWin − lossRate·|avgLoss|.
- Expectancy R = expectancy$ / |avgLoss| (proxy; SL unavailable).
- Avg win, Avg loss, Payoff ratio = avgWin / |avgLoss|.
- Max consecutive wins, Max consecutive losses.
- PnL + trade count by entry hour (0–23 VN).
- PnL + count by holding-duration bucket.
- PnL + count by lot-size bucket.
- Long vs short: count, win rate, net PnL.
- Best trade / worst trade (position_pnl + symbol + date).

## Architecture (data flow)
```
rawEvents ─filterRowsByAccount─► buildGroupedPositions ─► positions[] (sorted by exit_time)
   │
   ├─ reduce → {wins, losses, avgWin, avgLoss, expectancy$, R, payoff}
   ├─ streaks(positions ordered by exit_time)
   ├─ groupBy(entryHour) → bar chart
   ├─ groupBy(durationBucket) → bar chart
   ├─ groupBy(lotBucket) → bar chart
   ├─ split(long/short) → mini table
   └─ min/max(position_pnl) → best/worst cards
```

## Related Code Files
Create:
- `dashboard/js/metrics-edge-stats.js` — all edge computations + renderers (<200 LOC; if it
  grows past 200, split renderers into `metrics-edge-charts.js`).

Modify:
- `dashboard/index.html` — add "Edge Analytics" section: a `.stats-side`-style list for
  scalar stats + a `.chart-grid` of 3 canvases (`edge-hour-chart`, `edge-duration-chart`,
  `edge-lot-chart`) + long/short mini table + best/worst cards. Formula tooltips + VN titles.
  Add `<script src="js/metrics-edge-stats.js?v=...">` after app.js.

## Implementation Steps
1. **Collect positions:** `const pos = buildGroupedPositions(filterRowsByAccount(rawEvents)).sort((a,b)=>ts(a.exit_time_vn)-ts(b.exit_time_vn));`
   Attach helper fields per position: `pnl=num(position_pnl)`, `side` (from first deal action —
   requires access to deals; if grouped object lacks action, extend `buildGroupedPositions`
   to also carry `side` from `first.action`, OR recompute side by looking up first deal).
   Prefer: extend the grouped object in app.js `buildGroupedPositions` with
   `side: first.action` and `entry_hour` (cheap, backward-compatible).
2. **Core stats:**
   ```
   const wins  = pos.filter(p=>p.pnl>0), losses = pos.filter(p=>p.pnl<0);
   const avgWin  = wins.length  ? mean(wins.map(p=>p.pnl)) : 0;
   const avgLoss = losses.length? mean(losses.map(p=>p.pnl)) : 0;   // negative
   const winRate = pos.length ? wins.length/pos.length : 0;
   const expectancy = pos.length ? mean(pos.map(p=>p.pnl)) : 0;      // = winRate*avgWin + (1-winRate)*avgLoss
   const payoff = avgLoss ? avgWin/Math.abs(avgLoss) : 0;
   const R = avgLoss ? expectancy/Math.abs(avgLoss) : 0;             // proxy R-multiple
   ```
3. **Streaks:** iterate `pos` in exit order; track current sign run; record
   `maxWinStreak`, `maxLossStreak`.
4. **By entry hour:** `hour = new Date(p.entry_time_vn).getHours()` (entry_time_vn is
   already GMT+7 ISO → getHours on that offset; parse hour substring `T(\d\d)` to avoid
   local-tz shift — use regex like app.js `hhmmss`). Sum pnl + count into 0..23.
5. **Duration buckets:** `sec = (ts(p.exit_time_vn)-ts(p.entry_time_vn))/1000;`
   buckets: `<5m`, `5–30m`, `30m–2h`, `2–8h`, `>8h`. Sum pnl + count.
6. **Lot buckets:** `lot=num(p.lots)`; buckets `<0.05`, `0.05–0.1`, `0.1–0.5`, `>0.5`.
7. **Long vs short:** split by `p.side`; per group count, wins, winRate, net pnl → mini table.
8. **Best/worst:** `Math.max/min` by pnl → cards with symbol + date.
9. **Render:** scalar list via `setText`-style DOM writes (reuse app.js `setText` global +
   `.pos/.neg`); three bar charts via `renderBarChart(id,key,labels,values,colorFn)`.
10. **Wire:** listen `rawdata:ready` and `account:changed` → recompute + render.

## Todo
- [x] Extend `buildGroupedPositions` with `side` + keep entry/exit times (app.js, 1-line add)
- [x] Implement `metrics-edge-stats.js` (core stats, streaks, groupings, best/worst)
- [x] Add Edge Analytics section markup + 3 canvases + long/short table + best/worst cards
- [x] Formula tooltips documenting R-proxy (no SL) + VN titles
- [x] Recompute on account change; verify empty account (B) shows zeros, no errors

## Success Criteria
- Expectancy, payoff, streaks, and all three breakdown charts render for account A.
- R-multiple tooltip explicitly states it is an avg-loss proxy (SL data absent).
- Switching account recomputes everything; B (no data) shows zeros/empty gracefully.

## Risk Assessment
- **R-multiple is only a proxy** (no SL). Risk of misinterpretation → mandatory tooltip
  wording. Do not present R as risk-normalized in the Myfxbook sense.
- **Timezone parsing:** using `new Date().getHours()` shifts by browser tz. Mitigation:
  parse hour from the ISO string's `Txx` (offset already GMT+7 in data) like `hhmmss`.
- **Adjustment deals** inside a position inflate `deals_count` but position_pnl already
  sums them → fine. Side taken from first deal only (documented simplification).

## Security Considerations
- Read-only compute; no new data exposure.

## Next Steps
- Feeds Phase 4 (Sharpe uses per-day returns; streaks/expectancy inform risk-of-ruin).
