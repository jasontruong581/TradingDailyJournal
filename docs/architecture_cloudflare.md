# Cloudflare Architecture (Pages + Worker + D1)

## Overview
This project uses:
- Cloudflare Pages for frontend hosting (`tradingdailyjournal.pages.dev`)
- Cloudflare Worker for API (`trading-api.<subdomain>.workers.dev`)
- Cloudflare D1 for persistent trade data
- Local Windows pipeline for MT5 extraction and sync

## End-to-End Flow
```text
               (code push)
Developer ----------------------> GitHub (main)
                                      |
                                      v
                              Cloudflare Pages
                              deploy static dashboard
                                      |
                                      v
User browser -----------------> tradingdailyjournal.pages.dev
                                      |
                                      | fetch /api/*
                                      v
                          trading-api.<subdomain>.workers.dev
                           (Cloudflare Access protected)
                                      |
                                      v
                                  D1 database


Local scheduler (Windows Task) --> extract_mt5_events.py
                                 --> build_dashboard_data.py
                                 --> push_to_cloudflare_worker.py (/api/sync)
                                      |
                                      v
                          Worker upsert (INSERT OR REPLACE) into D1
```

## Runtime Request Path (Dashboard Read)
1. Browser loads static HTML/CSS/JS from Pages.
2. Frontend calls Worker endpoints:
   - `GET /api/summary`
   - `GET /api/raw-events`
3. Worker queries D1 and returns JSON.
4. Dashboard renders KPIs/charts/tables.

## Data Sync Path (Local Write)
1. `extract_mt5_events.py` creates daily CSV output from MT5.
2. `push_to_cloudflare_worker.py` sends data to Worker `/api/sync` in chunks.
3. Worker validates token and upserts into D1.
4. Duplicate protection is handled by primary keys:
   - `raw_events.event_id`
   - `daily_summary.trade_date_vn`

## Access / Auth Model
- Cloudflare Access policy protects Worker URL.
- For machine-to-machine sync from local pipeline:
  - `CF-Access-Client-Id`
  - `CF-Access-Client-Secret`
  - Worker `API_TOKEN` (Bearer) for application-level auth
- For interactive browser access:
  - User signs in via Access (session duration configured in Access app).

## Deployment Behavior
### Frontend (Pages)
- Trigger: new commit on configured branch (usually `main`) or manual redeploy.
- Typical update time: ~1-3 minutes.

### Worker API
- Trigger: `Save and Deploy` in Worker editor (or CI/wrangler deploy).
- Applies immediately after deployment.

### D1 Data
- Trigger: local pipeline sync calls `/api/sync`.
- No Git commit needed for new trade data to appear on dashboard.

## Daily Operations Checklist
1. Scheduler runs local pipeline.
2. Confirm worker sync result status is `ok`.
3. Open dashboard and verify latest date updated.
4. Check Worker logs if sync/read fails.

## Weekly Operations Checklist
1. Rotate `API_TOKEN` and Access service token secrets (recommended).
2. Check D1 usage metrics in Cloudflare dashboard.
3. Validate Access policy order:
   - `Service Auth` first
   - `Allow (email users)` after

## Common Failure Modes
- `Failed to fetch` on dashboard:
  - Access session expired
  - CORS not configured correctly
  - Redirect to Access login in cross-origin fetch
- `403 / 1010` on local sync:
  - Missing/invalid Access service token headers
  - Service Auth policy not applied or wrong app host/path
- Data appears stale:
  - frontend still reading CSV fallback
  - worker sync failed
  - browser cache not refreshed

