#!/usr/bin/env python3
"""Build dashboard history CSV from daily summary output.

- Source: out/daily_summary_latest.csv (single or many day rows)
- Target: dashboard/data/daily_summary_history.csv
- Merge by trade_date_vn (latest row wins), sorted ascending
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

KEY = "trade_date_vn"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build dashboard history csv")
    parser.add_argument("--input", default="out/daily_summary_latest.csv")
    parser.add_argument("--output", default="dashboard/data/daily_summary_history.csv")
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


def main() -> int:
    args = parse_args()
    src = Path(args.input)
    dst = Path(args.output)

    headers, new_rows = read_csv(src)
    merged: dict[str, dict[str, str]] = {}

    if dst.exists():
        old_headers, old_rows = read_csv(dst)
        headers = old_headers
        for r in old_rows:
            if r.get(KEY):
                merged[r[KEY]] = r

    for r in new_rows:
        k = r.get(KEY)
        if k:
            merged[k] = r

    out_rows = [merged[k] for k in sorted(merged.keys())]
    write_csv(dst, headers, out_rows)

    print({"status": "ok", "rows": len(out_rows), "output": str(dst)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
