# Step 2 - MT5 Extract Script

## Files
- `scripts/extract_mt5_events.py`: extract incremental tu MT5 va normalize theo `raw_events` schema.
- `requirements.txt`: dependencies Python.
- `.env.example`: mau bien moi truong MT5.

## Setup
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Cap nhat `.env`:
- `MT5_LOGIN`
- `MT5_PASSWORD`
- `MT5_SERVER`
- `MT5_PATH` (optional)

## Run
```powershell
python scripts/extract_mt5_events.py --output out/raw_events_latest.jsonl --output-format jsonl
```

Lay full hom nay theo gio VN (00:00-24:00):
```powershell
python scripts/extract_mt5_events.py --today-vn --output out/raw_events_today.csv --output-format csv --dry-run
```

Lay full 1 ngay cu the theo gio VN:
```powershell
python scripts/extract_mt5_events.py --day-vn 2026-02-22 --output out/raw_events_2026-02-22.csv --output-format csv --dry-run
```

Lay full hom qua theo gio VN:
```powershell
$yesterday = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
python scripts/extract_mt5_events.py --day-vn $yesterday --output out/raw_events_yesterday.csv --output-format csv --dry-run
```

Dry run (khong update state):
```powershell
python scripts/extract_mt5_events.py --dry-run
```

Backfill co dinh range:
```powershell
python scripts/extract_mt5_events.py --since 2026-02-01T00:00:00Z --until 2026-02-23T00:00:00Z
```

## Output
- File ket qua: `out/raw_events_latest.jsonl` (hoac CSV)
- File tong hop ngay: `out/daily_summary_latest.csv` (co `total_positions` de doi chieu so lenh kieu XM)
- Sync state: `state/mt5_sync_state.json`

## Notes
- Timezone quy uoc: XM = GMT+2, VN = GMT+7.
- FX/VND columns de `null` trong Step 2, se bo sung Step 3.
- `open_price/close_price` hien de o muc co ban tu deal; se enrich them o step tiep theo neu can.

## Health checks & logs
- Log mac dinh: logs/extract_mt5_events.log`n- Post-check: xac nhan output + summary file ton tai.
- Canh bao neu 	otal_positions lech lon hon nguong (--warn-position-delta-ratio, mac dinh 0.5).
- Neu no event: ghi warning de tranh silent failure.


## Multi-account mode (2 accounts)
- Tao file cau hinh tu mau: docs/accounts.example.json.
- Chay extract voi file account:
`powershell
python scripts/extract_mt5_events.py --accounts-file state/accounts.json --day-vn 2026-02-23 --output out/raw_events_2026-02-23.csv --output-format csv
`
- event_id se duoc namespace theo account (ccount_id:deal_ticket) de tranh trung giua nhieu account.


