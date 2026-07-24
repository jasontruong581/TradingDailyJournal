# Phase 2 — Capital Ledger + A→B Transfer Matching

## Context Links
- Plan overview: [plan.md](plan.md)
- Phase 1 (provides `filterRowsByAccount`, cashflow detection): [phase-01](phase-01-account-filter-equity-drawdown.md)
- Brainstorm decisions: `plans/reports/brainstorm-...-two-account-capital-ledger.md`

## Overview
- Priority: P1
- Status: completed
- Auto-match A→B internal transfers and render a one-glance capital/cashflow ledger:
  Net capital in / Profit taken (A→B) / Cash out (B→external) / Retained profit on A /
  True realized gain % on capital.

## Key Insights
- **No `withdrawal` events exist in data yet** (verified) → the ledger is currently
  unvalidated. Every ledger line must render `$0.00` / "no data" cleanly. Do NOT hard-fail.
- **`credit` = broker bonus, NOT capital.** Exclude from Net capital in and from the
  true-gain denominator. Optionally show as a separate "Bonus (broker)" line.
- Transfer matching is pure JS over the full raw set; needs BOTH accounts' events →
  operate on unfiltered `rawEvents`, not the account-filtered view.
- A→B transfer = a `withdrawal` on A paired with a `deposit` on B, same
  `trade_date_vn`, amounts equal within tolerance.

## Requirements
Functional — ledger block with lines:
- **Net capital in** = Σ external deposits on A − Σ external withdrawals on A that are NOT
  matched A→B transfers. (Bonuses excluded.)
- **Profit taken (A→B)** = Σ matched transfer amounts (money moved A→vault).
- **Cash out (B→external)** = Σ B withdrawals that are NOT the receiving side of an A→B
  transfer (real money pocketed).
- **Retained profit on A ("Paper")** = A trading PnL − Profit taken (still working in A;
  label as paper/unlocked — NOT counted as true gain per user rule).
- **Realized gain % ("True gain")** = Profit taken (A→B) / Net capital in. USER RULE
  (2026-07-24): true gain only counts when money is withdrawn to B. Show alongside:
  **Total gain %** = A trading PnL / Net capital in (paper+realized, headline metric).
  TWR rejected (control-oriented design, see plan.md Decisions #5).
- Capital epoch = data start (2026-03-02); support `INITIAL_BALANCE_A` const (default 0)
  added to Net capital in, correctable if A balance was non-zero at epoch.
- Show matched-transfer count + a small "unmatched withdrawals" note when any exist.

## Architecture (data flow)
```
rawEvents (full, both accounts)
   ├─ depositsA  = A & event_type=deposit
   ├─ withdrawalsA = A & event_type=withdrawal
   ├─ depositsB  = B & event_type=deposit
   ├─ withdrawalsB = B & event_type=withdrawal
   └─ matchTransfers(withdrawalsA, depositsB) ─► [{amount, date}], matchedA[], matchedB[]
        │
        ▼
   ledger = { netCapitalIn, profitTaken, cashOut, retained, trueGainPct, bonus }
        ▼  renderLedger() → ledger panel (stat list, styled like .stats-list)
```

## Related Code Files
Create:
- `dashboard/js/metrics-capital-ledger.js` — matching + ledger compute + render (<200 LOC).

Modify:
- `dashboard/index.html` — add Ledger `.panel` (stat-list markup + formula tooltips + VN
  title); add `<script src="js/metrics-capital-ledger.js?v=...">` after app.js.
- (No app.js change needed — module listens to `rawdata:ready` and `account:changed`;
  ledger is account-aware only for the "which account is A vs B" framing, which is fixed.)

## Implementation Steps
1. **Constants.** `const ACCT_A="400862814", ACCT_B="92234341", TRANSFER_TOL=0.01;`
   (tolerance = 1 cent; brainstorm allows ±amount + same-day window).
2. **Bucket events** by account + event_type using the canonical cashflow detection
   (Phase 1 table). Amount = `num(profit)`; withdrawals stored as abs for matching.
3. **matchTransfers(withdrawalsA, depositsB):**
   ```
   const matchedA=new Set(), matchedB=new Set(), transfers=[];
   withdrawalsA.forEach((w,i)=>{
     const j = depositsB.findIndex((d,k)=>!matchedB.has(k)
        && d.trade_date_vn === w.trade_date_vn
        && Math.abs(Math.abs(num(d.profit)) - Math.abs(num(w.profit))) <= TRANSFER_TOL);
     if (j>=0){ matchedA.add(i); matchedB.add(j);
       transfers.push({ date:w.trade_date_vn, amount:Math.abs(num(w.profit)) }); }
   });
   return { transfers, matchedA, matchedB };
   ```
   - `MANUAL_OVERRIDES = []` const stub for future mis-matches (YAGNI until observed).
4. **Compute ledger:**
   ```
   netCapitalIn = sum(depositsA.profit) 
                - sum(withdrawalsA where NOT matchedA |profit|);   // external A outflow
   profitTaken  = sum(transfers.amount);
   cashOut      = sum(withdrawalsB where NOT matchedB |profit|);
   tradingPnlA  = sum(position_pnl for A positions);               // reuse buildGroupedPositions on A
   retained     = tradingPnlA - profitTaken;
   trueGainPct  = netCapitalIn > 0 ? tradingPnlA / netCapitalIn : null;
   bonus        = sum(A credit profit);                             // display-only
   ```
5. **renderLedger()** into the panel stat-list; format with `money`/`pct`; `.pos/.neg`
   classes; when a value's source set is empty show `$0.00`; if `trueGainPct===null`
   show "—" with tooltip "Chưa có vốn nạp để tính %".
6. **Empty-state note.** If no `withdrawal` events at all: render a muted line
   "Chưa ghi nhận lệnh rút/chuyển — sổ vốn sẽ cập nhật khi có dữ liệu." So the block is
   honest today.
7. Wire: listen `rawdata:ready` (compute once) — ledger is global (A/B fixed), so it does
   NOT need to recompute on `account:changed`, but re-render is harmless.

## Todo
- [x] Add Ledger panel markup + formula tooltips + VN title
- [x] Implement `metrics-capital-ledger.js` (bucket, match, compute, render)
- [x] Handle no-withdrawal empty state cleanly
- [x] Add `MANUAL_OVERRIDES` stub + matched-count display
- [x] Verify numbers = $0 / "—" gracefully with today's data (no withdrawals, no B events)

## Success Criteria
- Ledger answers in one glance: capital in, profit taken, cashed out, retained, true gain %.
- With today's data (no withdrawals/B events): renders zeros + honest empty note, no errors.
- Bonuses excluded from capital in and true-gain denominator.
- When a real A→B transfer appears, it is auto-labeled "Profit taken", not external outflow.

## Risk Assessment
- **Mismatch risk:** multiple same-amount same-day transfers, or an external withdrawal on
  the same day as an internal transfer, can mis-pair. Mitigation: 1-cent tolerance + first
  unused match + `MANUAL_OVERRIDES` escape hatch. Show matched count so user can sanity-check.
- **B never syncs** → Profit taken/Cash out stay $0 forever; retained = full trading PnL.
  Document as data-pipeline gap (unresolved Q5), not a frontend bug.
- **Withdrawal sign assumption** (`profit` negative). Use `Math.abs` throughout to be
  sign-agnostic; verify once real withdrawal data lands.

## Security Considerations
- Read-only; amounts already visible in the dashboard. No new secret exposure.

## Next Steps
- Revisit tolerance/override logic only after real transfer data is observed.
- Phase 4 may add TWR-based true-gain as an alternative line.
