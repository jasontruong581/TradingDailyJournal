# Code Review — Myfxbook Analytics + Two-Account Capital Ledger

Plan: `plans/260724-1140-myfxbook-analytics-two-account-ledger/` · Date: 2026-07-24

## Scope
- Modified: `dashboard/app.js` (+45), `dashboard/index.html` (+146), `dashboard/styles.css` (+33)
- New: `dashboard/js/account-filter.js` (87), `metrics-equity-drawdown.js` (159), `metrics-capital-ledger.js` (109), `metrics-edge-stats.js` (133) — all <200 LOC ✓
- Verified: script-order/global-scope wiring, event timing, data format (`close_time_vn` has explicit `+07:00`; `action` ∈ {Buy, Sell, Deposit, Credit} — matches `p.side === "Buy"/"Sell"` filters), empty-B paths, Chart.js destroy keys.

## Findings

### High
1. **Wrong index set applied to `withdrawalsB` in cashOut** — `metrics-capital-ledger.js:57`
   `sumAbsUnmatched(b.withdrawalsB, matchedB)` — `matchedB` holds indices into **depositsB** (from `matchTransfers`), not `withdrawalsB`. Withdrawals on B are never candidates in matching, so no index of `withdrawalsB` should be excluded. Latent today (zero withdrawals), but once B has 1 matched deposit + ≥1 withdrawal, `withdrawalsB[0]` is silently dropped from Cash out → undercount. Fix: `cashOut = b.withdrawalsB.reduce((a,r)=>a+Math.abs(num(r.profit)),0)` (or add explicit B→A matching if returns are ever expected). Tooltip text ("withdrawal(B) không phải đầu nhận transfer") describes a rule the code cannot implement — withdrawals can't be transfer receivers.

### Medium
2. **Concurrent initial-load race widened** — `app.js:870-894` (`loadRawForAnalytics`) vs `app.js:882-894` (`loadDetailsLazy` via IntersectionObserver). Both guards (`rawAnalyticsLoaded`/`rawLoaded`) are only set at `hydrateRawData` end; both entry points can start `loadRawRows()` concurrently. Second call resets `rawApiOffset=0`/`rawApiHasMore=true` mid-`ensureAllRawLoaded` loop → duplicate page fetch → `uniqueByEventId` yields `added=false` → `rawApiHasMore=false` prematurely → tail pages never loaded; double `rawdata:ready` dispatch. Race pre-existed but the multi-page loop widens the window substantially. Not hit today (830 rows < 1 page). Fix: single shared in-flight promise (`rawLoadPromise ??= doLoad()` pattern) returned by both entries.
3. **No mid-pagination error tolerance** — `ensureAllRawLoaded` (`app.js:861-868`) propagates `loadMoreRawRowsApi` rejections. In `loadRawForAnalytics` the outer bare `catch {}` then discards already-fetched page-1 data — `hydrateRawData` never runs, no analytics, no CSV fallback (fallback only covers the FIRST request inside `loadRawRows`). Previous single-shot behavior degraded gracefully. Fix: try/catch inside the loop → `break` and hydrate partial data (optionally surface a note).

### Low
4. **"Load more" re-hydration bypasses analytics** — `app.js:958-969` (next-page handler) re-enriches + rebuilds `groupedPositions` but never dispatches `rawdata:ready` → equity/ledger/edge panels stale vs details table. Only reachable if `guard<50` truncates (>50k rows) or after a mid-load error break. Cheap fix: dispatch `rawdata:ready` after `applyDetailsFilter()` there.
5. **Transient unscoped summary before raw loads** — `getActiveSummaryRows` (`app.js:456-461`) falls back to pipeline `summaryAll` while switcher may already show B/All active (`account-filter.js:83-86`). Misleading for a moment; self-corrects on `rawdata:ready`. Acceptable; a "loading" hint on switch pre-load would remove ambiguity.
6. **innerHTML interpolation of `p.symbol`** — `metrics-edge-stats.js:88` (`edgeRenderExtremeCard`). Data is self-owned CSV/Worker, and pattern matches pre-existing app.js tables, so risk is minimal — but symbol is the only free-text field flowing into markup in the new code. Prefer `textContent` or an escape helper if the worker ever serves third-party data.
7. **Hour-chart silently drops unparsable entry times** — `edgeEntryHour` returns `""` → key missing in `sums` → position excluded from hour chart but included in duration/lot charts → per-chart totals can disagree. Consider an "N/A" bucket or a console.warn.
8. **`MANUAL_OVERRIDES` declared, never read** — `metrics-capital-ledger.js:8`. Plan Todo explicitly requested the stub, so plan-sanctioned, but it is dead code until wiring exists (YAGNI). Either wire it into `matchTransfers` or drop until needed.
9. **Zero-PnL positions counted as wins** — `pnl >= 0` in `account-filter.js:45`, `metrics-edge-stats.js:34,70,93`. Consistent across all new modules ✓; just confirm it matches the pipeline `win_positions` convention so A-account derived winrate ≈ pipeline winrate on clean days.
10. **`buildGroupedPositions` recomputed ~5x per account change** (deriveDailySummary, equity, monthly, edge, ledger). O(n) each, negligible at 830 rows; memoize keyed on `(rawEvents.length, activeAccountId)` if dataset grows 100x.
11. **Docs gap** — `docs/chart_tooltip_convention.md:23-27` "Existing charts covered" list not extended with the 5 new charts. Also account IDs duplicated between `index.html` data-attributes and `ACCOUNTS` const (unavoidable for markup, but a mismatch fails silently to an empty view).
12. **Plan not updated** — all Todo checkboxes in phase-01/02/03 unchecked; `plan.md` status still `pending`. Phases 1-3 are implemented; lead should mark complete (reviewer does not modify files).

## Verified non-issues (context-checked)
- Event timing: `rawdata:ready` dispatched from fetch-resolved code, always after all classic scripts registered listeners — no race, no TDZ; `typeof` guards cover the pre-load window correctly.
- Chart.js: unique destroy keys (`equityCurve`, `drawdownPct`, `edgeHour/Duration/Lot`), destroy-before-create, null-ctx guards on all new charts.
- Empty B / "all" paths: KPI "No data in range", equity note toggle, monthly fallback row, ledger `—` for null %, `null >= 0` cls quirk unused on null branch — all safe.
- `localStorage` value validated on load (`account-filter.js:7-8`).
- Timestamps: `+07:00` offsets in data make `ts()` browser-TZ-safe; `Date.parse(ym-01T00:00:00+07:00)` month anchor consistent; `edgeEntryHour` string-parse correct.
- Greedy same-day ±$0.01 transfer matching sensible for the stated rule; unmatched-A-withdrawal classification accepted per plan decision 3.
- Divergence from contaminated pipeline summary: by design, not flagged.
- `side: first.action` addition and account-scoped `applyDetailsFilter`/CSV export behave correctly with the load-more flow (scoping applied after rebuild).
- Vietnamese formula tooltips present on every new panel + all 5 charts per convention ✓.

## Positive
- Clean seam design (`getActiveSummaryRows`, CustomEvents) keeps app.js edits minimal exactly as planned.
- All modules <200 LOC, kebab-case, header comments documenting global dependencies.
- Honest metric labeling (R-proxy, Paper vs Realized, DD cap rationale) directly in tooltips.

## Recommended actions (priority order)
1. Fix cashOut index-space bug (#1) — one-line change, do before first real withdrawal syncs.
2. Add shared in-flight load promise (#2) + partial-failure tolerance in `ensureAllRawLoaded` (#3).
3. Dispatch `rawdata:ready` in the load-more handler (#4).
4. Update plan Todo checkboxes/status + tooltip-convention doc chart list (#12, #11).

## Metrics
- New module LOC: 87/159/109/133 (all <200 ✓); app.js 1043 (pre-existing size, +~35)
- Lint/type tooling: none configured for dashboard JS (plain scripts, no package.json) — manual review only
- Tests: validated externally via Node harness per task context (numbers confirmed)

## Verdict: 7.5/10
Well-architected, convention-compliant, edge cases for today's data handled. Docked for one real latent High bug in ledger cashOut, load-race/error-tolerance regressions in the pagination loop, and unfinished plan bookkeeping.

## Unresolved questions
- Should a withdrawal on B ever represent B→A return capital (would need its own matching + netCapitalIn adjustment)? Current model assumes B withdrawals are always external cash-out.
- Confirm pipeline `win_positions` treats pnl=0 as win to keep derived winrate comparable.
