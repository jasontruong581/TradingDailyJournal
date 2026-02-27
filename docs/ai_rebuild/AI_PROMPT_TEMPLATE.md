# AI Prompt Template (Copy-Paste)

Use this prompt when asking an AI model to rebuild or refactor this project.

```text
You are rebuilding a trading journal system.

Read and follow these docs first:
1) docs/ai_rebuild/PROJECT_BRIEF.md
2) docs/ai_rebuild/ARCHITECTURE_AND_FLOWS.md
3) docs/ai_rebuild/DATA_CONTRACTS_AND_TIMEZONE.md
4) docs/ai_rebuild/OPERATIONS_RUNBOOK.md
5) docs/ai_rebuild/AI_REBUILD_PLAYBOOK.md
6) docs/ai_rebuild/ACCEPTANCE_TEST_MATRIX.md

Non-negotiable constraints:
- Collect can be XM day (GMT+2), report is VN day (GMT+7).
- Keep both trade_date_xm and trade_date_vn.
- Keep upsert semantics (no duplicate records):
  - raw_events key: event_id
  - daily_summary key: trade_date_vn
- Keep Cloudflare Access compatible sync path:
  - CF-Access-Client-Id
  - CF-Access-Client-Secret
  - Bearer API token
- Keep dashboard chart formula tooltips.

Your output format:
1) Architecture plan (steps and risks)
2) Files to modify
3) Exact code changes
4) Test plan mapped to acceptance matrix
5) Rollback plan

If you are unsure about any assumption, explicitly list it and propose a safe default.
```

## Optional variables to append
- Current issue:
- Target timeline:
- Must-keep files:
- Allowed breaking changes:

