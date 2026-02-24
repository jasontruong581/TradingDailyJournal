#!/usr/bin/env python3
"""Build dashboard data files from extract outputs.

Outputs:
- dashboard/data/daily_summary_history.csv (merge by trade_date_vn)
- dashboard/data/raw_events_history.csv (merge by event_id)
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Iterable

SUMMARY_KEY = "trade_date_vn"
EVENT_KEY = "event_id"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build dashboard data csv files")
    parser.add_argument("--summary-input", default="out/daily_summary_latest.csv")
    parser.add_argument("--summary-output", default="dashboard/data/daily_summary_history.csv")
    parser.add_argument("--raw-input", default="")
    parser.add_argument("--raw-output", default="dashboard/data/raw_events_history.csv")
    return parser.parse_args()


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        raise SystemExit(f"Missing source file: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        if reader.fieldnames is None:
            raise SystemExit(f"Invalid csv header: {path}")
        return list(reader.fieldnames), rows


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def merge_rows(
    existing_path: Path,
    new_headers: list[str],
    new_rows: Iterable[dict[str, str]],
    key: str,
    sort_key: str,
    reverse: bool = False,
) -> tuple[list[str], list[dict[str, str]]]:
    merged: dict[str, dict[str, str]] = {}
    headers = new_headers

    if existing_path.exists():
        old_headers, old_rows = read_csv(existing_path)
        headers = old_headers
        for row in old_rows:
            k = row.get(key)
            if k:
                merged[k] = row

    for row in new_rows:
        k = row.get(key)
        if k:
            merged[k] = row

    out_rows = sorted(merged.values(), key=lambda r: r.get(sort_key, ""), reverse=reverse)
    return headers, out_rows


def pick_latest_raw_input(raw_arg: str) -> Path:
    if raw_arg:
        return Path(raw_arg)

    candidates = sorted(Path("out").glob("raw_events_*.csv"))
    if candidates:
        return candidates[-1]

    fallback = Path("out/raw_events_today.csv")
    if fallback.exists():
        return fallback

    raise SystemExit("Missing raw input. Use --raw-input or generate out/raw_events_*.csv first.")


def main() -> int:
    args = parse_args()

    summary_src = Path(args.summary_input)
    summary_dst = Path(args.summary_output)

    summary_headers, summary_rows = read_csv(summary_src)
    summary_headers, summary_out_rows = merge_rows(
        existing_path=summary_dst,
        new_headers=summary_headers,
        new_rows=summary_rows,
        key=SUMMARY_KEY,
        sort_key=SUMMARY_KEY,
        reverse=False,
    )
    write_csv(summary_dst, summary_headers, summary_out_rows)

    raw_src = pick_latest_raw_input(args.raw_input)
    raw_dst = Path(args.raw_output)
    raw_headers, raw_rows = read_csv(raw_src)
    raw_headers, raw_out_rows = merge_rows(
        existing_path=raw_dst,
        new_headers=raw_headers,
        new_rows=raw_rows,
        key=EVENT_KEY,
        sort_key="close_time_vn",
        reverse=True,
    )
    write_csv(raw_dst, raw_headers, raw_out_rows)

    print(
        {
            "status": "ok",
            "summary_rows": len(summary_out_rows),
            "summary_output": str(summary_dst),
            "raw_rows": len(raw_out_rows),
            "raw_output": str(raw_dst),
            "raw_input_used": str(raw_src),
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
