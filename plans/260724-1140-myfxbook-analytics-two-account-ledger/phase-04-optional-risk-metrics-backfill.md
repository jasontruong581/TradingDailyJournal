# Phase 4 — Optional Risk Metrics + History Backfill (DEFERRED)

> **DECISION UPDATE 2026-07-24:** Backfill scope DROPPED — user confirmed pre-2026-03-04
> deposits/losses exist but accepts epoch = data start. TWR alternative also dropped
> (control-oriented 3-layer gain design chosen, see plan.md Decisions #5). Remaining
> scope here = Sharpe / Z-score / risk-of-ruin only, still deferred until user feedback.

## Context Links
- Plan overview: [plan.md](plan.md)
- Phase 1 (equity/balance curves, daily returns source): [phase-01](phase-01-account-filter-equity-drawdown.md)
- Phase 3 (expectancy/streaks feed risk-of-ruin): [phase-03](phase-03-edge-analytics.md)

## Overview
- Priority: P3
- Status: deferred (build only after usage feedback + user confirms need)
- Advanced risk metrics: Sharpe (daily returns), Z-score (streak randomness),
  risk-of-ruin. Plus a ONE-TIME pre-2026-03-04 history backfill IF the user confirms
  earlier deposits/withdrawals exist and are missing.

## Key Insights
- Frontend-only still applies for the metrics. Backfill is a DATA task (pipeline extract),
  not a dashboard code change — only triggered on user confirmation.
- Metrics are only meaningful with enough samples; gate rendering behind a minimum
  (e.g. ≥20 trading days for Sharpe) else show "insufficient data".
- Simple gain formula chosen in Phase 2; TWR alternative can be added here if desired.

## Requirements (only if activated)
Functional:
- **Sharpe (daily)** = mean(dailyReturn) / stdev(dailyReturn) × √252, where
  dailyReturn = day trading PnL / balance at day start (risk-free ≈ 0, KISS).
- **Z-score** of win/loss sequence = (N·(R − 0.5) − X) / √((X·(X − N)) / (N − 1)) style
  runs test — document exact formula chosen; indicates streak dependency vs randomness.
- **Risk-of-ruin** = ((1 − edge)/(1 + edge))^(capitalUnits) with edge from Phase 3
  win/payoff; document assumptions (fixed fractional, avg risk unit = |avgLoss|).
- Each metric: formula tooltip + Vietnamese title + "insufficient data" guard.

Backfill (data, conditional):
- If user confirms pre-2026-03-04 deposits: run pipeline extract for the earlier XM day
  range to append historical `raw_events` (outside this frontend plan; documented as a
  runbook note). No dashboard change beyond it consuming the extra rows automatically.

## Architecture (data flow)
```
Phase-1 balance curve + deriveDailySummary → dailyReturns[]
        ├─ Sharpe
Phase-3 wins/losses sequence → Z-score, risk-of-ruin
        └─ renderRiskPanel() (stat-list, gated by min-sample)
```

## Related Code Files
Create (only if activated):
- `dashboard/js/metrics-risk-advanced.js` — Sharpe, Z-score, risk-of-ruin (<200 LOC).

Modify:
- `dashboard/index.html` — add "Advanced Risk" panel + formula tooltips + VN titles + script tag.

## Implementation Steps (when activated)
1. Confirm with user: earlier deposits/withdrawals exist? If yes → schedule backfill
   runbook (pipeline `extract_mt5_events.py --day-xm` range) and re-verify Net capital in.
2. Build `dailyReturns` from Phase 1 derived per-account daily summary + balance-at-start.
3. Implement Sharpe with √252 annualization; guard `stdev>0` and `days>=20`.
4. Implement Z-score runs test over the win/loss sequence from Phase 3 positions.
5. Implement risk-of-ruin from edge + payoff; document capital-units assumption.
6. Render into Advanced Risk panel; show "Chưa đủ dữ liệu" when below sample threshold.
7. (Optional) Add TWR-based true-gain % line to Phase 2 ledger as an alternative.

## Todo
- [ ] (Gate) Confirm user wants advanced risk metrics
- [ ] (Gate) Confirm pre-2026-03-04 deposit/withdrawal existence → backfill decision
- [ ] Implement `metrics-risk-advanced.js` (Sharpe, Z, RoR) with sample guards
- [ ] Add Advanced Risk panel + tooltips
- [ ] (Optional) TWR true-gain alternative line

## Success Criteria
- Metrics render only with sufficient samples; otherwise a clear insufficient-data note.
- If backfill run, Net capital in + true gain % reconcile with the XM statement.

## Risk Assessment
- **Small-sample noise:** Sharpe/Z unstable early → sample gating mandatory.
- **Formula ambiguity:** Z-score / RoR have several conventions → pin exact formula in
  code comment + tooltip to keep deterministic (per tooltip convention).
- **Backfill data drift:** re-extraction could duplicate events → rely on existing
  `uniqueByEventId` dedup + `source_hash`.

## Security Considerations
- Read-only compute. Backfill (if run) is a separate pipeline task; do not commit secrets
  or `state/accounts.json`.

## Next Steps
- Only start after Phases 1–3 are in use and the user requests these metrics.
