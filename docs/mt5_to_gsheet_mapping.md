# MT5 -> Google Sheets Mapping Spec (v1)

Muc tieu: dinh nghia schema chuan cho luong lay du lieu truc tiep tu MT5 va ghi vao Google Sheets, chay daily, co xu ly timezone XM (GMT+2) -> VN (GMT+7) va quy doi VND.

## 1) Sheet layout

- `raw_events`: du lieu giao dich/balance operation o cap do su kien (event-level), la source of truth.
- `daily_summary`: tong hop theo ngay VN (`trade_date_vn`) de phuc vu dashboard.
- `config` (khuyen nghi): luu cau hinh ETL (`last_sync_time_utc`, timezone, account currency, fx source).

## 2) raw_events schema

### 2.1 Business columns

| Column | Type | Required | Source (MT5) | Notes |
|---|---|---:|---|---|
| event_id | string | Y | `deal` id (uu tien), fallback `ticket` | Khoa duy nhat de dedup/upsert |
| ticket | string | Y | order/deal ticket | De trace ve MT5 |
| position_id | string | N | position id | Gom nhom cac deal trong 1 position |
| event_type | string | Y | map tu MT5 deal/order type | `trade`, `deposit`, `withdrawal`, `credit`, `balance_adjustment` |
| action | string | Y | direction/type | `Buy`, `Sell`, `Deposit`, ... |
| symbol | string | N | symbol | Rong voi balance operations |
| lots | number | N | volume | Lot size |
| open_price | number | N | price open | |
| close_price | number | N | price close | |
| sl | number | N | stop loss | |
| tp | number | N | take profit | |
| commission | number | Y | commission | Theo currency account |
| swap | number | Y | swap | Theo currency account |
| pips | number | N | tu tinh | Khuyen nghi tinh trong ETL |
| profit | number | Y | profit | Theo currency account |
| comment | string | N | comment | |
| magic_number | string | N | magic | |
| duration_sec | integer | N | close - open | De tong hop nhanh |
| account_id | string | Y | account login | |
| account_currency | string | Y | account info | Vi du `USD` |

### 2.2 Timezone columns

| Column | Type | Required | Rule |
|---|---|---:|---|
| open_time_xm | datetime | N | Datetime tren server XM (GMT+2) |
| close_time_xm | datetime | N | Datetime tren server XM (GMT+2) |
| open_time_vn | datetime | N | `open_time_xm + 5h` |
| close_time_vn | datetime | N | `close_time_xm + 5h` |
| trade_date_vn | date | Y | Date tu `close_time_vn`; neu chua close thi lay `open_time_vn` |

## 3) FX/VND conversion columns

| Column | Type | Required | Rule |
|---|---|---:|---|
| usd_vnd_rate | number | N | Ty gia USD/VND theo ngay giao dich |
| profit_vnd | number | N | `profit * usd_vnd_rate` (neu account currency = USD) |
| commission_vnd | number | N | `commission * usd_vnd_rate` |
| swap_vnd | number | N | `swap * usd_vnd_rate` |
| fx_rate_source | string | N | Ten API/provider |
| fx_rate_time_utc | datetime | N | Thoi diem lay ty gia |

## 4) ETL technical columns

| Column | Type | Required | Rule |
|---|---|---:|---|
| source_system | string | Y | Co dinh `MT5` |
| etl_run_id | string | Y | UUID moi lan chay |
| synced_at_utc | datetime | Y | Thoi diem ghi sheet |
| source_hash | string | N | Hash cac truong business de detect update |
| is_deleted | boolean | Y | Mac dinh `false` |

## 5) Mapping tu MT5 sang raw_events

Luu y: ten field MT5 co the khac nhau tuy API object (`history_deals_get`, `history_orders_get`). Quy tac mapping:

- `event_id`: `deal.ticket` (hoac `deal.id` neu co)  
- `ticket`: `order`/`deal` ticket
- `position_id`: `deal.position_id`
- `event_type`: map theo deal type:
  - BUY/SELL => `trade`
  - BALANCE => `balance_adjustment`
  - CREDIT => `credit`
  - CHARGE/COMMISSION/FEE => `balance_adjustment`
- `action`:
  - BUY => `Buy`
  - SELL => `Sell`
  - BALANCE => `Deposit` hoac `Withdrawal` dua theo dau `profit`
- `symbol`: `deal.symbol`
- `lots`: `deal.volume`
- `open_price`/`close_price`: lay tu order/position lifecycle. Neu chi co deal dong, co the de 1 trong 2 truong rong va tinh o layer summary neu can.
- `commission`: `deal.commission`
- `swap`: `deal.swap`
- `profit`: `deal.profit`
- `comment`: `deal.comment`
- `magic_number`: `deal.magic`
- `*_time_xm`: convert tu epoch MT5 sang timezone XM
- `*_time_vn`: XM + 5 gio

## 6) daily_summary schema

| Column | Type | Required | Rule |
|---|---|---:|---|
| trade_date_vn | date | Y | Key tong hop |
| total_trades | integer | Y | Dem event_type=`trade` |
| win_trades | integer | Y | `profit > 0` |
| loss_trades | integer | Y | `profit < 0` |
| win_rate | number | Y | `win_trades / total_trades` |
| gross_profit | number | Y | Tong profit duong |
| gross_loss | number | Y | Tong profit am |
| net_profit | number | Y | Tong profit |
| net_profit_vnd | number | N | Tong `profit_vnd` |
| total_commission | number | Y | Tong commission |
| total_swap | number | Y | Tong swap |
| updated_at_utc | datetime | Y | Thoi diem cap nhat |

## 7) Incremental sync rule (daily job)

- ETL doc `last_sync_time_utc` trong `config`.
- Lay history MT5 tu `last_sync_time_utc - 1 day` den `now` de tranh miss do tre du lieu.
- Upsert vao `raw_events` theo `event_id`.
- Rebuild `daily_summary` cho khoang ngay bi anh huong (tu ngay VN nho nhat trong batch moi den hien tai).
- Cap nhat `last_sync_time_utc` sau khi ghi sheet thanh cong.

## 8) Data quality checks

- `event_id` khong null, unique.
- `trade_date_vn` khong null.
- Gia tri so (`profit`, `commission`, `swap`, `lots`) parse duoc.
- Balance operations (`deposit/withdraw`) chap nhan `symbol` rong.

## 9) Naming conventions

- Dung `snake_case` cho tat ca cot.
- Datetime luu theo ISO-8601.
- Date luu `YYYY-MM-DD`.

## 10) Scope v1

- V1 tap trung: `raw_events` + `daily_summary`, timezone XM->VN, USD->VND.
- Cac metric nang cao (drawdown intraday, entry/exit accuracy) de v2.
