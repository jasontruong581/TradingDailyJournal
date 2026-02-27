# Operations Runbook

## Daily run
Command:
```powershell
powershell -ExecutionPolicy Bypass -File "d:\Hoang\Side Project\.net pj\trading\tasks\run_daily_pipeline.ps1"
```

What it does:
1. Resolve missing XM days (`last_success_day_xm` -> yesterday XM).
2. Extract MT5 per day (`--day-xm`).
3. Build dashboard merged history.
4. Push merged history to Google Sheets.
5. Push incremental day data to Cloudflare Worker `/api/sync`.
6. Update runner state.

## Environment variables (important)
- MT5:
  - `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER`, `MT5_PATH`
- Cloudflare sync:
  - `WORKER_API_URL`
  - `WORKER_API_TOKEN`
  - `CF_ACCESS_CLIENT_ID`
  - `CF_ACCESS_CLIENT_SECRET`

## Troubleshooting quick map
- `403 error code: 1010`:
  - Access policy/service token mismatch
  - Missing CF Access headers
- `Failed to fetch` on dashboard:
  - Access session expired
  - CORS/credentials issue
- Details less than expected:
  - Raw not fully synced
  - API pagination/offset issue

## Verification commands
- Worker health:
```powershell
Invoke-RestMethod -Method Get -Uri "https://trading-api.<subdomain>.workers.dev/health"
```
- Worker sync smoke test:
```powershell
Invoke-RestMethod -Method Post -Uri "https://trading-api.<subdomain>.workers.dev/api/sync" -Headers @{ Authorization = "Bearer <API_TOKEN>"; "CF-Access-Client-Id" = "<ID>"; "CF-Access-Client-Secret" = "<SECRET>" } -ContentType "application/json" -Body '{"summary_rows":[],"raw_rows":[]}'
```

## Security practices
- Rotate `API_TOKEN` and service token secrets periodically.
- Keep `.env` local only; never commit secrets.
- Keep Access policy order:
1. `Service Auth` for machine calls
2. `Allow` for user emails

