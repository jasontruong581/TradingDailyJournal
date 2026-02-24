# Step 3 - Push to Google Sheets

## Prerequisites
- Tao Google Service Account va tai file JSON key.
- Share Google Sheet cho email service account voi quyen Editor.
- Dien `.env`:
  - `GOOGLE_SERVICE_ACCOUNT_FILE=C:\\path\\to\\service-account.json`
  - `GOOGLE_SHEET_ID=your_google_sheet_id`

## Upload len Google Sheets
```powershell
python scripts/push_to_gsheet.py --raw-events out/raw_events_today.csv --daily-summary out/daily_summary_latest.csv
```

Mac dinh script se ghi/refresh 3 tabs:
- `raw_events`
- `daily_summary`
- `config`

## Full pipeline (de chay 9:00 moi ngay, lay hom qua)
```powershell
$day = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
python scripts/extract_mt5_events.py --day-vn $day --output out/raw_events_$day.csv --output-format csv
python scripts/push_to_gsheet.py --raw-events out/raw_events_$day.csv --daily-summary out/daily_summary_latest.csv
```

## Task Scheduler script
- Script san sang: `tasks/run_daily_pipeline.ps1`
- Chay tay test:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Hoang\Side Project\.net pj\trading\tasks\run_daily_pipeline.ps1"
```

- Tao task luc 9:00 AM moi ngay:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File \"d:\Hoang\Side Project\.net pj\trading\tasks\run_daily_pipeline.ps1\""
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM
Register-ScheduledTask -TaskName "TradingDailyPipeline" -Action $action -Trigger $trigger -Description "Extract MT5 data and push to Google Sheets daily"
```

## Note
- Step 3 dang dung che do replace worksheet content de tranh duplicate.
- Neu ban muon true upsert theo `event_id`, minh se nang cap o buoc tiep theo.
