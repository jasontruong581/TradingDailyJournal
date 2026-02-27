# AI Rebuild Docs Index

Muc tieu: bo tai lieu nay la "context package" de dua cho AI model khi can rebuild hoac refactor he thong.

## Files
- `PROJECT_BRIEF.md`: Tong quan project, pham vi, business rules.
- `ARCHITECTURE_AND_FLOWS.md`: Kien truc va luong xu ly end-to-end.
- `DATA_CONTRACTS_AND_TIMEZONE.md`: Schema, key fields, timezone invariants.
- `OPERATIONS_RUNBOOK.md`: Van hanh hằng ngay, deploy, triage su co.
- `AI_REBUILD_PLAYBOOK.md`: Quy trinh rebuild theo AI best practice.
- `AI_PROMPT_TEMPLATE.md`: Prompt template co san de copy-paste cho AI.
- `ACCEPTANCE_TEST_MATRIX.md`: Tieu chi nghiem thu va test checklist.

## How to use with AI
1. Gui cho AI file `PROJECT_BRIEF.md` + `ARCHITECTURE_AND_FLOWS.md` truoc.
2. Khi AI bat dau code, cung cap them `DATA_CONTRACTS_AND_TIMEZONE.md`.
3. Truoc khi merge, bat AI doi chieu voi `ACCEPTANCE_TEST_MATRIX.md`.
4. De AI de xuat migration/deploy theo `OPERATIONS_RUNBOOK.md`.

## Related docs in root docs/
- `docs/architecture_cloudflare.md`
- `docs/chart_tooltip_convention.md`
- `docs/mt5_to_gsheet_mapping.md`
- `docs/step2_mt5_extract.md`
- `docs/step3_gsheet_upload.md`
- `docs/step4_dashboard.md`

