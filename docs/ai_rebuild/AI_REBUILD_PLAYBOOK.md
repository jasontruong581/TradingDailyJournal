# AI Rebuild Playbook

## Goal
Rebuild system without losing:
- timezone correctness
- data integrity
- auth/security
- deploy reliability

## Recommended workflow with AI
1. **Context loading**
   - Provide `PROJECT_BRIEF.md`, `ARCHITECTURE_AND_FLOWS.md`.
2. **Contract lock**
   - Ask AI to restate schema + timezone invariants from `DATA_CONTRACTS_AND_TIMEZONE.md`.
3. **Plan first**
   - Ask AI to output migration plan with risks and rollback.
4. **Implement in slices**
   - Slice 1: data extraction + contracts
   - Slice 2: API + D1 upsert
   - Slice 3: dashboard read path + lazy load
   - Slice 4: ops automation
5. **Acceptance**
   - Force AI to validate against `ACCEPTANCE_TEST_MATRIX.md`.

## Hard constraints for AI
- Do not change timezone semantics.
- Do not remove `trade_date_xm` or `trade_date_vn`.
- Keep upsert behavior (no duplicate rows).
- Keep Access-compatible headers for sync path.
- Keep dashboard tooltips for chart formulas.

## Code review focus
- Window boundaries and date math.
- Pagination correctness (`limit/offset`).
- CORS + credentials interaction.
- Error handling with actionable logs.
- Backward compatibility of state files.

## Regression traps seen before
- Summary/date mismatch due to XM vs VN grouping.
- Worker pagination missing `offset`.
- Access redirect causing browser fetch CORS failure.
- Git build picking wrong root and failing due to `MetaTrader5`.

