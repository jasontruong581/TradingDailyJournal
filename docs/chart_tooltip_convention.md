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

