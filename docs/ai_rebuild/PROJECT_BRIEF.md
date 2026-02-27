# Project Brief

## Problem statement
Xay dung he thong nhat ky giao dich tu MT5 (XM), gom:
- Extract du lieu giao dich hang ngay.
- Chuan hoa du lieu theo schema on dinh.
- Tong hop KPI theo ngay.
- Hien thi dashboard web va dong bo du lieu len Cloudflare D1.

## Current scope
- Data source: MetaTrader 5 (XM server timezone GMT+2).
- Reporting timezone: Vietnam timezone GMT+7.
- Frontend host: Cloudflare Pages.
- API + auth layer: Cloudflare Worker + Cloudflare Access.
- Storage: Cloudflare D1.

## Core outcomes
1. Dashboard cap nhat data moi khong can commit CSV data.
2. Trade details co the cross-check voi tong hop.
3. Co the backfill theo ngay XM, nhung report theo ngay VN.
4. Pipeline co kha nang catch-up khi miss ngay.

## Non-goals (hien tai)
- Khong lam realtime tick-by-tick streaming.
- Khong lam portfolio risk engine phuc tap.
- Khong build full user management trong app (dung Cloudflare Access).

## Key business rules
- Collect theo ngay XM (GMT+2).
- Report theo ngay VN (GMT+7).
- Luu dong thoi `trade_date_xm` va `trade_date_vn`.
- Day boundary theo VN la `00:00:00 -> 23:59:59` cho report.
- Upsert de tranh duplicate (khong append vo han theo event da ton tai).

## Critical constraints
- Data nhay cam, uu tien private infra + Access policy.
- Timezone phai nhat quan trong toan he thong.
- Co the co multi-account MT5, event_id phai tranh collision.

