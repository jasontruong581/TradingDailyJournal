#!/usr/bin/env python3
"""Push merged dashboard CSV history to Cloudflare Worker API.

Expected Worker endpoint:
- POST {worker_base_url}/api/sync
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload dashboard history CSV to Cloudflare Worker")
    parser.add_argument("--worker-url", help="Base Worker URL; fallback env WORKER_API_URL")
    parser.add_argument("--api-token", help="API token; fallback env WORKER_API_TOKEN")
    parser.add_argument("--cf-access-client-id", help="Cloudflare Access Service Token Client ID; fallback env CF_ACCESS_CLIENT_ID")
    parser.add_argument(
        "--cf-access-client-secret",
        help="Cloudflare Access Service Token Client Secret; fallback env CF_ACCESS_CLIENT_SECRET",
    )
    parser.add_argument("--summary-input", default="dashboard/data/daily_summary_history.csv")
    parser.add_argument("--raw-input", default="dashboard/data/raw_events_history.csv")
    parser.add_argument("--chunk-size", type=int, default=80)
    parser.add_argument("--timeout-sec", type=int, default=30)
    parser.add_argument(
        "--user-agent",
        default="Mozilla/5.0 (Windows NT 10.0; Win64; x64) WindowsPowerShell/5.1",
        help="HTTP User-Agent for Worker sync requests.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-if-missing", action="store_true")
    return parser.parse_args()


def getenv_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"Input file not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def post_sync(
    worker_url: str,
    api_token: str,
    summary_rows: list[dict[str, str]],
    raw_rows: list[dict[str, str]],
    timeout_sec: int,
    user_agent: str,
    cf_access_client_id: str = "",
    cf_access_client_secret: str = "",
) -> dict:
    payload = json.dumps({"summary_rows": summary_rows, "raw_rows": raw_rows}, ensure_ascii=True).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_token}",
        "User-Agent": user_agent,
    }
    if cf_access_client_id and cf_access_client_secret:
        headers["CF-Access-Client-Id"] = cf_access_client_id
        headers["CF-Access-Client-Secret"] = cf_access_client_secret

    req = urllib.request.Request(
        url=f"{worker_url.rstrip('/')}/api/sync",
        data=payload,
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise SystemExit(f"Worker sync failed: HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Worker sync failed: {exc}") from exc


def chunks(rows: list[dict[str, str]], chunk_size: int) -> list[list[dict[str, str]]]:
    if chunk_size <= 0:
        return [rows]
    return [rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)]


def main() -> int:
    load_dotenv(encoding="utf-8-sig")
    args = parse_args()

    worker_url = (args.worker_url or os.getenv("WORKER_API_URL", "")).strip()
    api_token = (args.api_token or os.getenv("WORKER_API_TOKEN", "")).strip()
    cf_access_client_id = (args.cf_access_client_id or os.getenv("CF_ACCESS_CLIENT_ID", "")).strip()
    cf_access_client_secret = (args.cf_access_client_secret or os.getenv("CF_ACCESS_CLIENT_SECRET", "")).strip()
    if not worker_url or not api_token:
        if args.skip_if_missing:
            print(json.dumps({"status": "skipped", "reason": "missing WORKER_API_URL or WORKER_API_TOKEN"}, ensure_ascii=True))
            return 0
        if not worker_url:
            worker_url = getenv_required("WORKER_API_URL")
        if not api_token:
            api_token = getenv_required("WORKER_API_TOKEN")

    summary_rows = read_csv_rows(Path(args.summary_input))
    raw_rows = read_csv_rows(Path(args.raw_input))

    if args.dry_run:
        print(
            json.dumps(
                {
                    "status": "dry_run",
                    "worker_url": worker_url,
                    "summary_rows": len(summary_rows),
                    "raw_rows": len(raw_rows),
                    "chunk_size": args.chunk_size,
                    "raw_chunks": len(chunks(raw_rows, args.chunk_size)),
                    "use_cf_access_service_token": bool(cf_access_client_id and cf_access_client_secret),
                },
                ensure_ascii=True,
            )
        )
        return 0

    # First sync summary in one call.
    summary_resp = post_sync(
        worker_url=worker_url,
        api_token=api_token,
        summary_rows=summary_rows,
        raw_rows=[],
        timeout_sec=args.timeout_sec,
        user_agent=args.user_agent,
        cf_access_client_id=cf_access_client_id,
        cf_access_client_secret=cf_access_client_secret,
    )

    raw_chunks = chunks(raw_rows, args.chunk_size)
    sent_rows = 0
    for idx, part in enumerate(raw_chunks, start=1):
        post_sync(
            worker_url=worker_url,
            api_token=api_token,
            summary_rows=[],
            raw_rows=part,
            timeout_sec=args.timeout_sec,
            user_agent=args.user_agent,
            cf_access_client_id=cf_access_client_id,
            cf_access_client_secret=cf_access_client_secret,
        )
        sent_rows += len(part)
        print(f"chunk {idx}/{len(raw_chunks)} synced: {len(part)} rows", file=sys.stderr)

    print(
        json.dumps(
            {
                "status": "ok",
                "summary_rows": len(summary_rows),
                "raw_rows": len(raw_rows),
                "raw_rows_synced": sent_rows,
                "summary_response_status": summary_resp.get("status"),
            },
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
