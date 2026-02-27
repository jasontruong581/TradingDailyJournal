# Architecture And Flows

## Components
- Local ETL scripts (Python):
  - `scripts/extract_mt5_events.py`
  - `scripts/build_dashboard_data.py`
  - `scripts/push_to_cloudflare_worker.py`
- Scheduler:
  - `tasks/run_daily_pipeline.ps1`
- Cloud:
  - Cloudflare Pages (frontend static)
  - Cloudflare Worker (`trading-api`) for API
  - Cloudflare D1 for storage
  - Cloudflare Access for auth control

## Flow A: Code deploy (frontend)
1. Push code len GitHub `main`.
2. Cloudflare Pages auto build/deploy.
3. Frontend moi duoc phat hanh tren `tradingdailyjournal.pages.dev`.

## Flow B: Data sync (daily pipeline)
1. Scheduler chay `run_daily_pipeline.ps1`.
2. Extract MT5 theo ngay XM:
   - `--day-xm YYYY-MM-DD`
3. Build merged dashboard CSV history.
4. Push full history len Google Sheets (de doi chieu).
5. Push incremental day data len Worker `/api/sync`.
6. Worker upsert vao D1.

## Flow C: Dashboard runtime
1. Browser mo Pages frontend.
2. Frontend goi Worker API:
   - `/api/summary`
   - `/api/raw-events` (limit/offset cho lazy load)
3. Worker doc D1 tra JSON.
4. Frontend render KPI, chart, table.

## Access/Auth path
- Browser read path:
  - Access session (email) + credentials include.
- Machine write path:
  - Cloudflare Service Token headers:
    - `CF-Access-Client-Id`
    - `CF-Access-Client-Secret`
  - App token:
    - `Authorization: Bearer <API_TOKEN>`

## Design decisions
- Tach read API va data sync endpoint.
- Upsert theo primary key de khong duplicate.
- Frontend lazy-load raw details thay vi load full ngay tu dau.
- Time grouping theo `trade_date_vn` cho report.

## Known pitfalls
- CORS + Access redirect co the gay `Failed to fetch` neu session sai.
- Neu Worker chua support `offset`, details se dung o chunk dau.
- Neu summary va raw khong dong bo pham vi ngay, stats va details co the lech.

