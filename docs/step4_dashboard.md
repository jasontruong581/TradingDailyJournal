# Step 4 - GitHub Pages Dashboard

## Files
- `dashboard/index.html`
- `dashboard/styles.css`
- `dashboard/app.js`
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

## Preview local
```powershell
python -m http.server 8080
# mo http://localhost:8080/dashboard/
```

## Publish on GitHub Pages
1. Vao repo `Settings` -> `Pages`.
2. Chon `Deploy from a branch`.
3. Branch: `main`, Folder: `/ (root)`.
4. URL dashboard: `https://<your-username>.github.io/TradingDailyJournal/dashboard/`.
