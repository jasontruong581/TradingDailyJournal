# Trading Daily Journal

Automated daily trading journal pipeline for MetaTrader 5 (XM timezone) with Google Sheets sync.

## What this project does
- Extracts MT5 deals daily (full Vietnam day window).
- Extracts MT5 deals daily by XM server day (`GMT+2`) and stores both XM/VN dates.
- Normalizes data into a stable `raw_events` schema.
- Builds daily metrics (`daily_summary`) including XM-like order count (`total_positions`).
- Uploads data to Google Sheets (`raw_events`, `daily_summary`, `config`).
- Runs automatically via Windows Task Scheduler at 9:00 AM.

## Architecture
- `scripts/extract_mt5_events.py`
  - Connect to MT5 terminal.
  - Pull `history_deals_get` in a day window.
- Convert timezone XM `GMT+2` -> VN `GMT+7`.
  - Keep both `trade_date_xm` and `trade_date_vn` for tracking.
  - Output `raw_events` CSV/JSONL.
  - Generate `daily_summary_latest.csv`.
- `scripts/push_to_gsheet.py`
  - Push CSV outputs to Google Sheets.
  - Refreshes tabs:
    - `raw_events`
    - `daily_summary`
    - `config`
- `tasks/run_daily_pipeline.ps1`
  - Full daily pipeline (extract yesterday + push to Google Sheets).
- `scripts/api_server.py`
  - Serve `daily_summary_history.csv` and `raw_events_history.csv` as JSON API.
  - Optional token auth via `API_TOKEN`.
- `scripts/push_to_cloudflare_worker.py`
  - Push merged history CSV (`dashboard/data/*_history.csv`) to Worker `/api/sync`.
  - Uses env `WORKER_API_URL`, `WORKER_API_TOKEN`.
  - If Worker is protected by Cloudflare Access, also set `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.

## Project structure
```text
scripts/
  extract_mt5_events.py
  push_to_gsheet.py
tasks/
  run_daily_pipeline.ps1
docs/
  mt5_to_gsheet_mapping.md
  step2_mt5_extract.md
  step3_gsheet_upload.md
```

## Requirements
- Windows machine with MetaTrader 5 terminal installed and logged in.
- Python 3.10+
- Google Cloud service account (Sheets API enabled).

## Setup
1. Create virtual environment and install deps:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Create `.env` from template:
```powershell
copy .env.example .env
```

3. Fill `.env`:
```env
MT5_LOGIN=
MT5_PASSWORD=
MT5_SERVER=
MT5_PATH=C:\Program Files\MetaTrader 5\terminal64.exe

GOOGLE_SERVICE_ACCOUNT_FILE=C:\path\to\service-account.json
GOOGLE_SHEET_ID=your_google_sheet_id
```

## Run manually
- Extract full today (XM day):
```powershell
python scripts/extract_mt5_events.py --today-xm --output out/raw_events_today.csv --output-format csv --dry-run
```

- Extract a specific XM day:
```powershell
python scripts/extract_mt5_events.py --day-xm 2026-02-23 --output out/raw_events_2026-02-23.csv --output-format csv
```

- Push to Google Sheets:
```powershell
python scripts/push_to_gsheet.py --raw-events out/raw_events_2026-02-23.csv --daily-summary out/daily_summary_latest.csv
```

- Run API server for dashboard:
```powershell
uvicorn scripts.api_server:app --host 0.0.0.0 --port 8787
```

- Push full history to Cloudflare Worker:
```powershell
python scripts/push_to_cloudflare_worker.py --summary-input dashboard/data/daily_summary_history.csv --raw-input dashboard/data/raw_events_history.csv
```

## Daily automation (9:00 AM)
Run the prepared script:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Hoang\Side Project\.net pj\trading\tasks\run_daily_pipeline.ps1"
```

Create Scheduled Task:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File \"d:\Hoang\Side Project\.net pj\trading\tasks\run_daily_pipeline.ps1\""
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName "TradingDailyPipeline" -Action $action -Trigger $trigger -Settings $settings -Description "Extract MT5 data and push to Google Sheets daily"
```

## Notes
- `total_positions` in `daily_summary` is the position-level count (closest to XM order count).
- `raw_events` is event-level and may be ~2x for open/close deal pairs.
- Runtime folders (`logs/`, `out/`, `state/`) are ignored by git.

## Security
- Never commit `.env` or service account JSON keys.
- Keep credentials local and rotate keys periodically.

## Dashboard (GitHub Pages)
- Frontend files are in `dashboard/`.
- Build/update dashboard data after each extract:
```powershell
python scripts/build_dashboard_data.py --raw-input out/raw_events_2026-02-23.csv
```
- Dashboard URL (after enabling Pages):
  - `https://<your-username>.github.io/TradingDailyJournal/dashboard/`

Detailed guide: `docs/step4_dashboard.md`.
Architecture guide: `docs/architecture_cloudflare.md`.

### Dashboard data source (API-first with CSV fallback)
- Dashboard will try API first if configured:
  - `localStorage.dashboard_api_base` (example: `https://api.yourdomain.com`)
  - optional `localStorage.dashboard_api_token`
- If API is unavailable, dashboard falls back to local CSV in `dashboard/data/`.


## Multi-account collect (trade + cashflow)
You can extract multiple MT5 accounts in one run using `--accounts-file`.

1. Create `state/accounts.json` from `docs/accounts.example.json`.
2. Run:
```powershell
python scripts/extract_mt5_events.py --accounts-file state/accounts.json --day-xm 2026-02-23 --output out/raw_events_2026-02-23.csv --output-format csv
```

Notes:
- `event_id` is namespaced as `account_id:deal_ticket` to avoid collisions across accounts.
- `tasks/run_daily_pipeline.ps1` auto-detects `state/accounts.json` and uses multi-account mode automatically.

