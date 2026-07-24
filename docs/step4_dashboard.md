# Step 4 - GitHub Pages Dashboard

## Files
- `dashboard/index.html`
- `dashboard/styles.css`
- `dashboard/app.js` (updated: getActiveSummaryRows seam, account scoping, ensureAllRawLoaded pagination, rawdata:ready event, buildGroupedPositions includes side)
- `dashboard/js/account-filter.js` (account switcher A/B/All, localStorage persistence, filterRowsByAccount, deriveDailySummary, account:changed event)
- `dashboard/js/metrics-equity-drawdown.js` (equity curve, balance curve, drawdown %, monthly gain)
- `dashboard/js/metrics-capital-ledger.js` (A↔B transfer matching, ledger metrics: net capital in, profit taken, cash out, retained, realized/total gain %)
- `dashboard/js/metrics-edge-stats.js` (expectancy, R, avg win/loss, payoff, streaks, PnL by hour/duration/lot, long vs short, best/worst)
- `dashboard/data/daily_summary_history.csv`
- `dashboard/data/raw_events_history.csv`
- `scripts/build_dashboard_data.py`

## Update dashboard data
Sau khi pipeline extract xong:
```powershell
python scripts/build_dashboard_data.py --raw-input out/raw_events_2026-02-23.csv
```

Script se merge:
- `daily_summary_history.csv` theo key `trade_date_vn`
- `raw_events_history.csv` theo key `event_id`

## Dashboard features
- KPI co tach `Trading PnL` va `Net PnL` de doi chieu so lieu ro rang.
- Trade details co filter (`date`, `action`, `symbol`).
- Pagination 50 records/page.
- Lazy-load raw data khi section details vao viewport.
- **Account filter** (A/B/All) — persisted in localStorage, filters daily summary and trade details per account.
- **Equity & Drawdown analytics** — trading equity curve per closed position, balance curve (deposits+withdrawals+trade PnL, credit excluded), drawdown % underwater chart, monthly gain table.
- **Capital Ledger** — A→B transfer matching (withdrawal A + deposit B, same trade_date_vn, amount ±$0.01), with net capital in, profit taken, cash out, retained, realized gain %, total gain %, and bonus tracking.
- **Edge Statistics** — expectancy $, R, avg win/loss, payoff, max win/loss streaks, PnL by entry hour (VN), holding duration buckets, lot buckets, long vs short, best/worst trade.

## Data derivation caveat
**Important:** Pipeline `daily_summary_history.csv` is contaminated on some days (credit/deposit counted inside net_profit). The dashboard now derives daily summary client-side from raw_events once loaded, which intentionally diverges from the pipeline CSV and is correct per canonical rules (trades only, credit=bonus excluded). This client-side derivation is the source of truth.

## Preview local
```powershell
python -m http.server 8080
# mo http://localhost:8080/dashboard/
```

## API mode (recommended for sensitive data)
- Start API:
```powershell
uvicorn scripts.api_server:app --host 0.0.0.0 --port 8787
```
- Configure browser:
```js
localStorage.setItem("dashboard_api_base", "http://localhost:8787");
// optional token if API_TOKEN is enabled:
// localStorage.setItem("dashboard_api_token", "your-token");
```
- Dashboard will use API first, and fallback to CSV if API is unreachable.

## Publish on GitHub Pages
1. Vao repo `Settings` -> `Pages`.
2. Chon `Deploy from a branch`.
3. Branch: `main`, Folder: `/ (root)`.
4. URL dashboard: `https://<your-username>.github.io/TradingDailyJournal/dashboard/`.
