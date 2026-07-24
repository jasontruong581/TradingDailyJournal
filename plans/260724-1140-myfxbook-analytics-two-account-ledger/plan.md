---
title: "Myfxbook-style Analytics + Two-Account Capital Ledger"
description: "Frontend-only Myfxbook-quality stats, per-account equity/drawdown, and a 2-account capital/cashflow ledger."
status: completed
priority: P2
effort: 12h (+4h optional Phase 4)
branch: main
tags: [dashboard, analytics, frontend, metrics, ledger]
created: 2026-07-24
completed: 2026-07-24
---

# Myfxbook-style Analytics + Two-Account Capital Ledger

Add Myfxbook-quality analytics and a 2-account capital ledger to the dashboard.
Architecture is FINAL (consensus): **frontend-compute only. ZERO changes to Python
pipeline or Cloudflare Worker.** All new metrics computed in the browser from
`raw_events` rows already loaded by `app.js` (Worker API `/api/raw-events` with CSV
fallback `dashboard/data/raw_events_history.csv`).

Source of truth for scope: `plans/reports/brainstorm-260724-1140-myfxbook-style-analytics-two-account-capital-ledger.md`.

## Critical data findings (verified against raw CSV, 2026-07-24)

- **All 830 events are on account A (`400862814`). Account B (`92234341`) has ZERO
  events in raw data.** Multi-account extract is configured but B has never synced.
  → B view + Phase 2 ledger MUST render an empty/placeholder state gracefully.
- `event_type` enum present: `trade` (816), `deposit` (7), `credit` (7).
  **No `withdrawal` events exist yet.** A→B transfers and B→external cash-outs will
  only appear once withdrawal events are synced.
- Cashflow amount is stored in the **`profit`** column for non-trade events.
- `credit` = broker bonus (`Credit In/Out`), NOT real capital (can be + or -).
  → Exclude from real-capital / true-gain; may show separately.
- **0 of 816 trade rows have a stop-loss** (`sl` = 0 everywhere). SL-based R-multiple
  is impossible → R uses avg-loss proxy (see Phase 3).
- `duration_sec` unreliable (0 in samples) → holding duration computed from timestamps.
- Data range 2026-03-02 .. 2026-07-23. External deposit total = $1,673.79.

## Cashflow detection logic (canonical — used by all phases)

| Bucket | Rule | Amount |
|---|---|---|
| External deposit | `event_type === "deposit"` | `+num(profit)` |
| External/internal withdrawal | `event_type === "withdrawal"` | `num(profit)` (expect negative; abs for display) |
| Broker bonus (excluded from capital) | `event_type === "credit"` | `num(profit)` (+/-) |
| Trade PnL | `event_type === "trade"` | `num(profit)` |

## Phases

| # | Phase | Priority | Status | Effort | File |
|---|---|---|---|---|---|
| 1 | Account switcher + equity/drawdown + monthly gain | P1 | completed | 5h | [phase-01](phase-01-account-filter-equity-drawdown.md) |
| 2 | Capital ledger + A→B transfer matching | P1 | completed | 3h | [phase-02](phase-02-capital-ledger-transfer-matching.md) |
| 3 | Edge analytics (expectancy, streaks, buckets) | P2 | completed | 4h | [phase-03](phase-03-edge-analytics.md) |
| 4 | Optional risk metrics (Sharpe/Z/RoR) + backfill | P3 | deferred | 4h | [phase-04](phase-04-optional-risk-metrics-backfill.md) |

## Key dependencies & architecture

- **Full dataset required.** Metrics need ALL rows. `app.js` loads raw paginated
  (1000/page). ~830 rows < 1000 → first page already exhaustive, but code must call a
  new `ensureAllRawLoaded()` loop (`while rawApiHasMore: loadMoreRawRowsApi()`) before
  computing to stay robust as data grows. CSV fallback returns everything in one shot.
- **New modules** (kebab-case, each <200 LOC, plain `<script>` — index.html is NOT
  ESM): `dashboard/js/account-filter.js`, `metrics-equity-drawdown.js`,
  `metrics-capital-ledger.js`, `metrics-edge-stats.js` (Phase 4: `metrics-risk-advanced.js`).
- **Reuse app.js globals** (DRY): `num`, `money`, `pct`, `ts`, `destroyChart`,
  `renderBarChart`, `buildGroupedPositions`, `charts`, `rawEvents` are top-level
  declarations → shared global lexical scope for scripts loaded after `app.js`.
  Load module `<script>`s AFTER `app.js` in index.html.
- **Decoupling via events** (minimize app.js edits): `app.js` dispatches
  `document.dispatchEvent(new CustomEvent('rawdata:ready'))` in `hydrateRawData`;
  `account-filter.js` dispatches `account:changed`. Modules self-wire via listeners.
- **Account filter on existing blocks.** `daily_summary` has no `account_id`. Phase 1
  derives per-account daily summary client-side from raw and feeds existing render
  functions via a new `getActiveSummaryRows()` seam. Default account = A.
- Tooltip convention (`docs/chart_tooltip_convention.md`) + Vietnamese tooltips
  mandatory for every new chart. Dashboard must keep working on CSV fallback alone.
- Sequential: Phase 1 (account seam) → Phase 2 & 3 depend on it → Phase 4 last.

## Decisions (user-confirmed 2026-07-24)

1. **No backfill.** Deposits/losses existed pre-2026-03-04 but user accepts epoch =
   data start (2026-03-02). Add configurable `INITIAL_BALANCE_A` const (default 0) in
   metrics module so equity baseline can be corrected if 04/03 balance was non-zero.
   Phase 4 backfill scope DROPPED.
2. **B zero events = normal.** B has never had any transaction (user is at a loss, no
   profit moved yet). Empty/placeholder state confirmed correct. Not a sync bug.
3. **Withdrawal matching unvalidated = accepted.** Validate Phase 2 logic at first real
   A→B withdrawal.
4. **Bonus (`credit`)**: excluded from capital/true-gain; show separate "Bonus" line.
5. **Gain formula = 3-layer control-oriented (not TWR):**
   - Headline: simple gain = net trading PnL ÷ net external capital (excl. bonus).
   - Monthly heatmap: period return = month PnL ÷ start-of-month balance (TWR building
     block; months comparable despite deposits).
   - Ledger: **Realized gain = cash moved to B ÷ capital** (user rule: true gain only
     counts when withdrawn to B); retained profit in A labeled "Paper". Show Current
     DD % from peak next to headline (withdraw-at-new-high discipline).

## Implementation notes (2026-07-24)

**Validation findings:**
- Pipeline `daily_summary_history.csv` includes credit/deposit inside `net_profit` on 5 of 9 days tracked (e.g., 2026-07-23: 173.40 trade + 530.40 deposit + 506.08 credit = 1209.88 recorded). Raw-derived summary intentionally diverges; canonical cashflow rules per Phase 2 ledger are correct. Real trading PnL (A, excluding bonus) = −$969.99.
- Drawdown % clamped at 100% because balance curve dips below 0 when epoch capital = 0 (INITIAL_BALANCE_A not backfilled). Works as designed; user can adjust const if needed.
- Reports: `plans/reports/tester-260724-1210-myfxbook-analytics-validation.md` + `plans/reports/code-reviewer-260724-1210-myfxbook-analytics.md` (score 7.5/10; all High/Medium findings fixed before merge).

## Unresolved questions

- None blocking. Phase 2 numbers pend real-world validation at first A→B withdrawal.
