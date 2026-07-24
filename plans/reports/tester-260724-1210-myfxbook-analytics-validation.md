# Analytics Modules Validation Report

**Date:** 2026-07-24 12:10  
**Test Environment:** Node.js validation script (no test framework)  
**Scope:** Frontend analytics modules for static dashboard (plain `<script>` tags, global scope)

---

## Executive Summary

Validation of 5 new analytics modules against real trading data (830 raw events, 9 baseline days):

- **Modules Tested:** `account-filter.js`, `metrics-equity-drawdown.js`, `metrics-capital-ledger.js`, `metrics-edge-stats.js` + app.js modifications
- **Tests Passed:** 28/32 (87.5%)
- **Tests Failed:** 4/32
- **Key Metrics:** Trading PnL = -$969.99, Deposits = $1673.79, Positions = 408, Bonus credits = $506.08

---

## Test Results

### PASSING ASSERTIONS (28/32)

**TEST 2: Account Filtering (A vs All)**
- ✓ Derived daily summaries match between activeAccountId="A" and "all"
- ✓ Account A rows identical (no exclusive A data on account B)
- **Implication:** Account scoping works correctly for supported accounts

**TEST 3: Account B (Empty Account)**
- ✓ deriveDailySummary("92234341") returns empty array (length=0)
- ✓ No exception thrown on empty account
- **Implication:** Edge case handling for non-existent account works

**TEST 4: Equity Curve Validation**
- ✓ Last equity = total trade PnL (-$969.99)
- ✓ Peak >= equity at all points (peak monotonicity correct)
- ✓ Timestamps strictly monotonic
- **Implication:** Equity curve logic sound for single-account scenario

**TEST 5: Balance Curve (Partial)**
- ✓ Final balance = deposits + trading PnL ($1673.79 + (-$969.99) = $703.80)
- ✗ FAILED: Some drawdown values outside [0,1] range (see issue below)
- **Implication:** Balance calculation correct; drawdown % logic has edge case bug

**TEST 6: Capital Ledger (Partial)**
- ✓ netCapitalIn = $1673.79 (deposits only, no initial balance, no unmatched withdrawals)
- ✓ profitTaken ≈ $0 (no A→B transfers matched)
- ✓ cashOut ≈ $0 (no B withdrawals)
- ✓ transferCount = 0 (no matched transfers as expected)
- ✓ hasWithdrawals = false (correct; raw data shows no withdrawal events)
- ✓ retained = -$969.99 (trading PnL since no profit taken)
- ✓ totalGainPct = -0.5795 (-$969.99 / $1673.79)
- ✗ FAILED: bonus = $506.08 (credit events DO exist; see issue below)
- **Implication:** Ledger logic mostly sound; bonus calculation correct (data assumption was wrong)

**TEST 7: Transfer Matching (Synthetic)**
- ✓ Single A-withdrawal + B-deposit matched (amount=500, same date)
- ✓ Tolerance test: 500 vs 500.005 matches (within 0.01 tol)
- ✓ Tolerance test: 500 vs 501 does NOT match (1.00 > 0.01 tol)
- **Implication:** matchTransfers() logic works correctly on synthetic data

**TEST 9: Rendering Functions**
- ✓ renderLedger() no exception
- ✓ renderEquityDrawdown() no exception
- ✓ renderEdgeStats() no exception
- ✓ renderMonthlyGainTable() no exception
- **Implication:** DOM stubs sufficient; rendering harness doesn't throw

**TEST 10: Syntax Check**
- ✓ app.js syntax valid
- ✓ account-filter.js syntax valid
- ✓ metrics-equity-drawdown.js syntax valid
- ✓ metrics-capital-ledger.js syntax valid
- ✓ metrics-edge-stats.js syntax valid
- **Implication:** No syntax errors in any module

---

## FAILING ASSERTIONS (4/32)

### FAIL #1: TEST 1 – Daily Summary Derivation Mismatch (15 drifts)

**Issue:** deriveDailySummary("all") does NOT match daily_summary_history.csv baseline on 5 days

**Sample Drifts:**
| Date | Field | Baseline | Derived | Diff |
|------|-------|----------|---------|------|
| 2026-03-02 | net_profit | 1181.95 | 37.76 | 1144.19 |
| 2026-03-02 | total_positions | 23 | 0 | 23 |
| 2026-03-03 | win_positions | 16 | 17 | 1 |
| 2026-03-04 | net_profit | -163.41 | -189.32 | 25.91 |
| 2026-03-04 | total_positions | 135 | 145 | 10 |

**Root Cause (Analysis):**
- Derived has 8 days; baseline has 9 days (missing one day)
- Large PnL discrepancy on 2026-03-02 (1144.19 = ~7 positions at ~160 each)
- Position count discrepancy suggests buildGroupedPositions groups differently than pipeline
- Possible causes:
  1. Multi-leg position grouping logic differs (entry/exit/adjustment detection)
  2. Pipeline groups by ticket; script groups by position_id (both present in data)
  3. Position assignment to date logic (last.trade_date_vn vs first vs opening_date)
  4. Some trades may lack position_id (would be excluded from grouping)

**Impact:** Daily summary derivation unreliable; accounts with multi-leg positions will show incorrect daily stats

**Recommendation:** 
- Audit buildGroupedPositions vs pipeline grouping logic
- Check position_id completeness in raw data
- Verify position-to-date assignment strategy

---

### FAIL #2: TEST 5 – Balance Curve Drawdown Out of Range

**Issue:** Some drawdown values (dd) fall outside [0, 1] range

**Details:**
- computeBalanceCurve returns balance points with `dd: (peak - bal) / peak`
- Some dd values negative or > 1 (indicates balance > peak or negative peak)
- This suggests peak calculation is incorrect in one or more rows

**Root Cause (Hypothesis):**
```javascript
let bal = edStartBalance(); // 0 or INITIAL_BALANCE_A
let peak = Math.max(0, bal); // min 0
rows.forEach((r) => {
  bal += num(r.profit); // trade, deposit, or withdrawal
  peak = Math.max(peak, bal);
  return { ..., dd: peak > 0 ? (peak - bal) / peak : 0 };
});
```
- If bal goes negative (more withdrawals/losses than deposits), dd can exceed 1
- If peak = 0 (no deposits, only losses), denominator is 0, dd = 0 (handled)
- If INITIAL_BALANCE_A > 0 initially, then bal drops below, dd > 1 is possible

**Impact:** Drawdown % misrepresented for underwater accounts; rendering may fail on bad values

**Recommendation:**
- Add guard: `dd: Math.max(0, Math.min(1, (peak - bal) / peak))` or use `Math.abs(peak - bal) / Math.max(peak, Math.abs(bal))`
- Define clear semantics: is dd "drawdown from peak" or "current underwater %"?

---

### FAIL #3: TEST 6 – Bonus Credit Events Exist (Data vs Expectation)

**Issue:** Assertion expected bonus = $0, but found bonus = $506.08

**Root Cause (Data Issue):**
- Raw data contains 7 credit events totaling $506.08 (after offsets)
  - 500.00 (credit)
  - 6.08 (credit)
  - -0.80 (credit reversal)
  - -24.31 (credit reversal)
  - -61.12 (credit reversal)
  - -295.17 (credit reversal)
  - 381.40 (credit)
- **Sum:** 500 + 6.08 - 0.80 - 24.31 - 61.12 - 295.17 + 381.40 = **506.08**

**Note:** This is NOT a code bug; the test assumption was wrong. The module correctly sums credit events.

**Impact:** None on code; assertion should be updated

**Recommendation:**
- Update test to assert bonus = $506.08 (credit events DO exist in the data)
- Document that bonus is distinct from capital (credits/bonuses tracked separately)

---

### FAIL #4: TEST 8 – Edge Positions Returns 0

**Issue:** edgePositions() returns empty array despite 408 grouped positions available

**Debug Output:**
```
filterRowsByAccount(rawEvents).length: 830 (all rows, activeAccountId="all")
buildGroupedPositions(filtered).length: 408 (correct)
edgePositions().length: 0 (WRONG)
```

**Root Cause (Hypothesis):**
- After TEST 6 calls `setCurrentAccount("all")`, activeAccountId = "all"
- TEST 8 calls `setCurrentAccount("400862814")` to switch back
- BUT edgePositions() may be called BEFORE the switch completes, OR
- edgePositions() definition captured wrong reference to rawEvents/activeAccountId, OR
- setCurrentAccount doesn't immediately update activeAccountId (async issue)

**Critical:** Function still returns an array (doesn't throw), but returns 0 positions instead of 408

**Impact:** Edge statistics (expectancy, payoff, streaks, hour/duration/lot buckets) will all be empty/zero; renders as no-data state rather than error

**Recommendation:**
- Add logging to edgePositions() to print filterRowsByAccount result length before .map
- Verify activeAccountId is correctly set at function execution time
- Check for race conditions if setCurrentAccount is async (it shouldn't be, but document)
- Ensure edgePositions() captures variables by reference, not by value

---

## Key Metrics Summary

| Metric | Value | Notes |
|--------|-------|-------|
| Raw Events | 830 | All on account 400862814 (A) |
| Grouped Positions | 408 | Multi-leg positions summed |
| Trading PnL (A) | -$969.99 | Cumulative loss |
| Total Deposits | $1,673.79 | 5 deposit events |
| Total Withdrawals | $0 | No withdrawal events in data |
| Bonus Credits | $506.08 | 7 credit events (net) |
| Final Balance | $703.80 | deposits + trading PnL |
| Daily Summary Rows | 8 derived vs 9 baseline | Mismatch on early days |
| Baseline Coverage | Partial pass | Must resolve TEST 1 drifts |

---

## Unresolved Questions

1. **Why does buildGroupedPositions produce different daily summaries than the pipeline?**
   - Is position_id → date assignment different?
   - Are some trades excluded due to missing position_id?
   - Does the pipeline use a different grouping key?

2. **What is the correct semantics for drawdown %?**
   - Should dd = (peak - bal) / peak (peak-relative), or
   - Should dd = drawdown in absolute dollars, or
   - Should dd be clamped to [0, 1]?

3. **Why does edgePositions() return 0 positions?**
   - Is this a scoping/reference issue with rawEvents or filterRowsByAccount?
   - Does setCurrentAccount need async await?
   - Are there circular dependencies between modules?

4. **Are the missing credit/withdrawal columns intentional?**
   - Raw data has event_type ∈ {trade, deposit, withdrawal, credit}
   - But daily_summary_history doesn't have separate withdrawal/credit columns
   - Are they aggregated, or omitted by design?

---

## Recommendations (Priority Order)

### Critical
1. **Resolve TEST 1 (Daily Summary Mismatch)**
   - Audit grouping logic; validate against pipeline code
   - Check if data is stale relative to baseline
   - If logic differs intentionally, update baseline

2. **Fix TEST 8 (Edge Positions = 0)**
   - Add logging to edgePositions() to diagnose activeAccountId/rawEvents state
   - Verify account switching doesn't have race conditions

### High
3. **Fix TEST 5 (Drawdown Out of Range)**
   - Define clear semantics for dd
   - Add guards to clamp or abs values appropriately

4. **Update TEST 6 Assertion**
   - Change bonus assertion from 0 to $506.08 (credit events confirmed to exist)

### Medium
5. **Code Quality**
   - All modules have valid syntax (good)
   - No rendering exceptions (good)
   - Add more descriptive comments in buildGroupedPositions about grouping strategy

---

## Test Execution Environment

- **Platform:** Windows 11, Node.js v22.17.1
- **Test Data:** Real CSV files (830 events, 9 baseline days)
- **Harness:** Custom Node.js script with DOM/Chart stubs
- **No Test Framework:** Direct assertions without Jest/Mocha
- **Coverage:** 5 modules, 10 test scenarios, 32 assertions

