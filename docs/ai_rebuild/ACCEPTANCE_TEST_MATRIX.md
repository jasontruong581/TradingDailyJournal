# Acceptance Test Matrix

## A. Timezone and date correctness
- [ ] Event with XM time `YYYY-MM-DD 23:xx +02` maps to correct VN next day when applicable.
- [ ] Date filter `From=To=2026-02-23` includes full VN day `00:00:00..23:59:59`.
- [ ] `trade_date_vn` and `trade_date_xm` are both present in raw events.

## B. Data integrity
- [ ] Re-running same sync does not increase duplicate rows in D1.
- [ ] Summary totals are consistent with raw events in same VN date range.
- [ ] Multi-account event IDs do not collide.

## C. API behavior
- [ ] `/health` returns status ok.
- [ ] `/api/summary` returns rows with expected fields.
- [ ] `/api/raw-events` supports `limit` and `offset` correctly.
- [ ] `/api/sync` accepts chunked uploads and returns ok.

## D. Access and security
- [ ] Service Auth policy allows machine sync with service token headers.
- [ ] User email policy allows browser read.
- [ ] Expired session behavior is understood and recoverable.

## E. Dashboard UX
- [ ] KPI values load with no console errors.
- [ ] Daily Net chart uses bar + latest 7 trading days.
- [ ] Details view lazy-loads beyond first 1000 events.
- [ ] Export CSV returns filtered dataset (not only current page).
- [ ] Chart formula tooltips are visible and accurate.

## F. Ops reliability
- [ ] Daily scheduler handles catch-up for missing XM days.
- [ ] Logs contain actionable error messages.
- [ ] Pipeline exits non-zero on hard failure.

