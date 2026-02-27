# Data Contracts And Timezone

## Raw events contract (core fields)
- `event_id` (string, unique key)
- `ticket` (string)
- `position_id` (string)
- `event_type` (trade/deposit/withdrawal/...)
- `action` (Buy/Sell/Deposit/...)
- `symbol`, `lots`, `close_price`, `profit`, `commission`, `swap`
- `open_time_xm`, `close_time_xm` (ISO with +02:00)
- `open_time_vn`, `close_time_vn` (ISO with +07:00)
- `trade_date_xm` (date)
- `trade_date_vn` (date)
- `account_id`, `account_label`, `account_currency`
- `source_hash`, `etl_run_id`, `synced_at_utc`

## Daily summary contract
- key: `trade_date_vn`
- `total_positions`
- `total_deals`
- `buy_deals`, `sell_deals`
- `win_positions`, `loss_positions`
- `net_profit`
- `gross_profit`, `gross_loss`
- `total_deposit`, `total_withdrawal`
- `updated_at_utc`

## Timezone invariants (critical)
1. Collect window can be XM day (GMT+2).
2. Reporting day must be VN day (GMT+7).
3. `trade_date_vn` is derived from VN close/open time.
4. Date filter UI must treat day as full VN day:
   - From: `00:00:00 +07`
   - To: `23:59:59 +07`

## Aggregation formulas (current)
- `daily_trading_pnl = gross_profit + gross_loss`
- `daily_net_pnl = net_profit`
- `growth = cumulative(daily_trading_pnl)`
- `drawdown = growth - running_peak(growth)` (<= 0)
- `monthly_trading_pnl = sum(daily_trading_pnl by YYYY-MM)`

## Duplicate prevention
- D1 upsert:
  - `raw_events`: `INSERT OR REPLACE` by `event_id`
  - `daily_summary`: `INSERT OR REPLACE` by `trade_date_vn`

## Data consistency checks
- Summary trades ~= raw events filtered by `event_type=trade`.
- Summary positions ~= grouped raw by `position_id`.
- Date coverage summary and raw should overlap for same VN range.

