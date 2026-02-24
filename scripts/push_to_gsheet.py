#!/usr/bin/env python3
"""Push extracted CSV outputs to Google Sheets.

Writes/refreshes:
- raw_events worksheet from raw events CSV
- daily_summary worksheet from summary CSV
- config worksheet with last_sync_time_utc and run metadata
"""

from __future__ import annotations

import argparse
import csv
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import gspread
from dotenv import load_dotenv

UTC = timezone.utc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload MT5 extracted CSV data to Google Sheets")
    parser.add_argument("--raw-events", default="out/raw_events_today.csv")
    parser.add_argument("--daily-summary", default="out/daily_summary_latest.csv")
    parser.add_argument("--sheet-id", help="Google Sheet ID; fallback to env GOOGLE_SHEET_ID")
    parser.add_argument("--service-account", help="Path to service account JSON; fallback env GOOGLE_SERVICE_ACCOUNT_FILE")
    parser.add_argument("--raw-sheet", default="raw_events")
    parser.add_argument("--summary-sheet", default="daily_summary")
    parser.add_argument("--config-sheet", default="config")
    return parser.parse_args()


def getenv_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def read_csv_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    if not path.exists():
        raise SystemExit(f"Input file not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        raise SystemExit(f"CSV is empty: {path}")
    header = rows[0]
    data = rows[1:]
    return header, data


def ensure_worksheet(sh: gspread.Spreadsheet, title: str, cols: int) -> gspread.Worksheet:
    try:
        ws = sh.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=title, rows=1000, cols=max(cols, 26))
    return ws


def replace_sheet_content(ws: gspread.Worksheet, header: list[str], data_rows: list[list[str]]) -> None:
    values = [header] + data_rows
    ws.clear()
    # Single update keeps result deterministic and avoids duplicate append behavior.
    ws.update(values, value_input_option="USER_ENTERED")


def upsert_config(ws: gspread.Worksheet, kv_rows: Iterable[tuple[str, str]]) -> None:
    ws.clear()
    rows = [["key", "value"]] + [[k, v] for k, v in kv_rows]
    ws.update(rows, value_input_option="USER_ENTERED")


def main() -> int:
    load_dotenv(encoding="utf-8-sig")
    args = parse_args()

    raw_path = Path(args.raw_events)
    summary_path = Path(args.daily_summary)

    sheet_id = args.sheet_id or getenv_required("GOOGLE_SHEET_ID")
    service_account_file = args.service_account or getenv_required("GOOGLE_SERVICE_ACCOUNT_FILE")

    gc = gspread.service_account(filename=service_account_file)
    sh = gc.open_by_key(sheet_id)

    raw_header, raw_rows = read_csv_rows(raw_path)
    summary_header, summary_rows = read_csv_rows(summary_path)

    raw_ws = ensure_worksheet(sh, args.raw_sheet, len(raw_header))
    summary_ws = ensure_worksheet(sh, args.summary_sheet, len(summary_header))
    config_ws = ensure_worksheet(sh, args.config_sheet, 2)

    replace_sheet_content(raw_ws, raw_header, raw_rows)
    replace_sheet_content(summary_ws, summary_header, summary_rows)

    now_utc = datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    upsert_config(
        config_ws,
        [
            ("last_sync_time_utc", now_utc),
            ("raw_events_row_count", str(len(raw_rows))),
            ("daily_summary_row_count", str(len(summary_rows))),
            ("updated_at_utc", now_utc),
        ],
    )

    print(
        {
            "status": "ok",
            "sheet_id": sheet_id,
            "raw_rows": len(raw_rows),
            "summary_rows": len(summary_rows),
            "updated_at_utc": now_utc,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
