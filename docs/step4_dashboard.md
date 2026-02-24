# Step 4 - GitHub Pages Dashboard

## Files
- `dashboard/index.html`
- `dashboard/styles.css`
- `dashboard/app.js`
- `dashboard/data/daily_summary_history.csv`
- `scripts/build_dashboard_data.py`

## Update dashboard data
Sau khi pipeline extract xong:
```powershell
python scripts/build_dashboard_data.py
```

Script se merge vao `dashboard/data/daily_summary_history.csv` theo key `trade_date_vn` (dedup theo ngay).

## Preview local
```powershell
# bat ky static server nao deu duoc
python -m http.server 8080
# mo http://localhost:8080/dashboard/
```

## Publish on GitHub Pages
1. Vao repo `Settings` -> `Pages`.
2. Chon `Deploy from a branch`.
3. Branch: `main`, Folder: `/ (root)`.
4. URL dashboard: `https://<your-username>.github.io/TradingDailyJournal/dashboard/`.
