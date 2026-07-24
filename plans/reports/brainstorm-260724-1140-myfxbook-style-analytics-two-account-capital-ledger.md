# Brainstorm Report: Myfxbook-style Analytics + Two-Account Capital Ledger

Date: 2026-07-24 | Participants: user (trader, XM MT5), brainstormer
Status: CONSENSUS REACHED → proceed to detailed plan

## Problem Statement

Dashboard (tradingdailyjournal.pages.dev) shows basic daily aggregates. User wants:
1. Clear, Myfxbook-quality statistics to improve trading decisions.
2. Support 2-account workflow: `A_main_trade` (login 400862814, deposit + trade) → withdraw profit → `B_profit` (login 92234341, hold profit) → cash out external. Need clean capital/cashflow visibility ("how much did I really pocket").

## Current State (scouted)

- `raw_events` schema rich: position_id, lots, pips, duration_sec, open/close price+time, account_id/label, cashflow events, VND conversion. ~830 events / 408 positions since 2026-03-04.
- Dashboard already groups positions client-side; loads via Worker API (D1) with CSV fallback (both fixed 2026-07-24).
- `daily_summary` has NO account_id → all accounts aggregated. Critical gap: B_profit deposits will pollute A trading stats (gain %, drawdown, cashflow).
- `state/accounts.json` already configured with both accounts (multi-account extract works).
- Pipeline runs 9:00 daily for yesterday XM; auto-publishes CSV to GitHub (added 2026-07-24).
- `app.js` ~1000 lines — new metrics MUST go in separate modules.

## User Decisions (via Q&A)

| Question | Decision |
|---|---|
| Priority stats | ALL 3: capital/cash-out ledger, equity curve + drawdown, trade edge metrics. NOT live intraday (EOD 9:00 stays). |
| B_profit trades? | Never — pure profit vault. Trading metrics computed on A only; B = ledger view. |
| A→B transfer handling | Auto-match (withdrawal A ≈ deposit B, same day + amount) → label "Profit taken", not external outflow. Only B→external = "Cash out". |
| Rollout | Phased, incremental. |
| Architecture | **Frontend compute** (Option 3 below). |
| Next step | Create detailed plan immediately. |

## Evaluated Approaches

1. **Use Myfxbook directly** (investor password, 0 code). Rejected as replacement: no 2-account ledger semantics, no profit-taken/cash-out distinction, no VND. Kept as optional cross-check source.
2. **Backend precompute** (extend build_dashboard_data.py, new CSV/JSON). Rejected: touches production pipeline, more sync surface, slower iteration (see result next 9:00 run), over-engineered for ~20k rows/yr. Revisit only if metrics needed outside dashboard.
3. **Frontend compute** ✅ CHOSEN: all new metrics computed in browser from raw_events (works over both API and CSV fallback). Zero pipeline change. Position grouping already exists client-side. Transfer matching = pure JS logic. Modularize into `dashboard/js/metrics-*.js` (kebab-case, <200 LOC each).

## Agreed Phased Scope

- **Phase 1 — Per-account foundation + Equity/Drawdown**: account switcher (A / B / All; default A); per-position equity/balance curve (not per-day); drawdown % underwater chart + max DD/current DD; Monthly Gain % table (year × month heatmap, $ + %).
- **Phase 2 — Capital Ledger (2-account)**: A→B transfer auto-match; ledger block: Net capital in (external) / Profit taken (A→B) / Cash out (B→external) / Retained profit on A / True realized gain % on capital.
- **Phase 3 — Edge analytics**: expectancy ($ and R), avg win vs avg loss, payoff ratio, max consecutive win/loss streaks, performance by entry hour (VN), by holding duration bucket, by lot size, long vs short, best/worst trade.
- **Phase 4 (optional, after usage feedback)**: Sharpe (daily returns), Z-score, risk-of-ruin; history backfill pre-2026-03-04 if initial deposits missing.

## Risks / Considerations

- **True gain correctness depends on complete deposit history.** Data starts 2026-03-04 (Total Deposits $911). If deposits/withdrawals existed before → one-time backfill via `extract_mt5_events.py --day-xm` range needed. Verify with user against XM statement.
- Transfer matching heuristic (same day ± amount) can mismatch if user does multiple same-amount transfers or external withdrawal same day as internal transfer. Mitigation: tolerance window + manual override list (JS const) if ever needed — YAGNI until observed.
- daily_summary stays account-agnostic (unchanged); per-account daily aggregates derived client-side from raw_events. If daily_summary table block needs per-account split later, compute client-side too.
- Keep chart tooltip convention (`docs/chart_tooltip_convention.md`) and Vietnamese tooltips consistent with existing UI.

## Success Metrics

- Selecting account A shows trading stats uncontaminated by B deposits.
- Ledger answers in one glance: capital in, profit taken, cashed out, retained.
- Equity curve/drawdown/monthly table visually comparable to Myfxbook for account A.
- Pipeline untouched; dashboard still works on CSV fallback alone.

## Unresolved Questions

1. Any deposits/withdrawals on A before 2026-03-04? (determines backfill need)
2. B→external cash-out events: will they appear as withdrawal events in B's MT5 history (assumed yes)?
3. Preferred gain formula: Myfxbook TWR-style vs simple profit/deposits — default simple (KISS), revisit in Phase 4.
