# Chart Tooltip Convention

## Purpose
Keep chart logic transparent for future maintenance and cross-check.

## Rule (mandatory)
Every new chart must include a visible formula tooltip near its title.

## Tooltip content template
- Metric definition
- Exact formula
- Timezone/day boundary rule (if date-based)
- Aggregation scope (daily/weekly/monthly)

Example:
`daily_net = sum(net_profit) grouped by trade_date_vn (GMT+7, 00:00:00..23:59:59).`

## Frontend implementation
- Use `span.formula-tip` next to chart title.
- Put formula text in the `title` attribute.
- Keep formula concise and deterministic.

## Existing charts covered
- Daily Net Profit
- Growth And Cashflow
- Drawdown By Day
- Monthly Trading PnL
- Equity Curve (Trading) — per-position trading equity with balance curve (deposits+withdrawals+trade PnL)
- Drawdown % (Underwater) — underwater percentage capped at 100%, with Max/Current DD metrics
- Monthly Gain — month PnL / start-of-month balance table
- Capital Ledger (A ↔ B) — account transfer tracking with realized vs. total gain %, profit taken, cash out, retained capital
- Edge Analytics — expectancy $, R, avg win/loss, payoff, win/loss streaks, with sub-charts: PnL by entry hour (VN), holding duration buckets, lot buckets, long vs short, best/worst trade

