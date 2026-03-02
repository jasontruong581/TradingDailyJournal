#!/usr/bin/env python3
"""Serve trading dashboard data via HTTP API.

Default behavior:
- Read merged history CSV files from dashboard/data
- Expose JSON endpoints for summary and raw events
- Optional token auth for sensitive deployments
"""

from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware


def _split_csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [x.strip() for x in raw.split(",") if x.strip()]


load_dotenv(encoding="utf-8-sig")

DATA_DIR = Path(os.getenv("API_DATA_DIR", "dashboard/data"))
SUMMARY_PATH = DATA_DIR / "daily_summary_history.csv"
RAW_PATH = DATA_DIR / "raw_events_history.csv"
API_TOKEN = os.getenv("API_TOKEN", "").strip()
CORS_ALLOW_ORIGINS = _split_csv_env("CORS_ALLOW_ORIGINS")

app = FastAPI(title="Trading Dashboard API", version="1.0.0")

if CORS_ALLOW_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOW_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )


def require_token(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> None:
    if not API_TOKEN:
        return
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    provided = bearer or (x_api_key or "").strip()
    if provided != API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Missing data file: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "summary_exists": SUMMARY_PATH.exists(),
        "raw_exists": RAW_PATH.exists(),
    }


@app.get("/api/summary")
def get_summary(_: None = Depends(require_token)) -> dict[str, Any]:
    rows = read_csv_rows(SUMMARY_PATH)
    return {"rows": rows, "count": len(rows)}


@app.get("/api/raw-events")
def get_raw_events(
    from_date: str = "",
    to_date: str = "",
    limit: int = 0,
    _: None = Depends(require_token),
) -> dict[str, Any]:
    rows = read_csv_rows(RAW_PATH)

    if from_date or to_date:
        rows = [
            r
            for r in rows
            if (
                (not from_date or (r.get("trade_date_vn", "") >= from_date))
                and (not to_date or (r.get("trade_date_vn", "") <= to_date))
            )
        ]
    if limit and limit > 0:
        rows = rows[:limit]

    return {"rows": rows, "count": len(rows)}

