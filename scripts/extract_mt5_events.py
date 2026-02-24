#!/usr/bin/env python3
"""Extract MT5 history deals and normalize into raw_events schema.

Step 2 scope:
- Connect to MetaTrader 5 terminal
- Pull incremental history_deals
- Convert timestamps XM (GMT+2) -> VN (GMT+7)
- Normalize rows to docs/mt5_to_gsheet_mapping.md schema
- Persist last_sync_time_utc in local state file

Google Sheets upsert is intentionally deferred to Step 3.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv

try:
    import MetaTrader5 as mt5
except Exception as exc:  # pragma: no cover
    msg = str(exc)
    if "_ARRAY_API" in msg or "NumPy" in msg or "numpy" in msg:
        raise SystemExit(
            "MetaTrader5 failed to import due to NumPy compatibility. "
            "Please install dependencies with `pip install -r requirements.txt` "
            "so NumPy is pinned below 2."
        ) from exc
    raise SystemExit(
        "MetaTrader5 package is unavailable. Run: pip install -r requirements.txt"
    ) from exc


XM_TZ = timezone(timedelta(hours=2))
VN_TZ = timezone(timedelta(hours=7))
UTC = timezone.utc
ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


@dataclass
class RawEvent:
    event_id: str
    ticket: str
    position_id: str | None
    event_type: str
    action: str
    symbol: str | None
    lots: float | None
    open_price: float | None
    close_price: float | None
    sl: float | None
    tp: float | None
    commission: float
    swap: float
    pips: float | None
    profit: float
    comment: str | None
    magic_number: str | None
    duration_sec: int | None
    account_id: str
    account_currency: str
    open_time_xm: str | None
    close_time_xm: str | None
    open_time_vn: str | None
    close_time_vn: str | None
    trade_date_vn: str
    usd_vnd_rate: float | None
    profit_vnd: float | None
    commission_vnd: float | None
    swap_vnd: float | None
    fx_rate_source: str | None
    fx_rate_time_utc: str | None
    source_system: str
    etl_run_id: str
    synced_at_utc: str
    source_hash: str
    is_deleted: bool


@dataclass
class DailySummary:
    trade_date_vn: str
    total_positions: int
    total_deals: int
    buy_deals: int
    sell_deals: int
    win_positions: int
    loss_positions: int
    net_profit: float
    gross_profit: float
    gross_loss: float
    total_commission: float
    total_swap: float
    total_deposit: float
    total_withdrawal: float
    updated_at_utc: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract MT5 deals to normalized raw_events")
    parser.add_argument("--state-file", default="state/mt5_sync_state.json")
    parser.add_argument("--output", default="out/raw_events_latest.jsonl")
    parser.add_argument("--output-format", choices=["jsonl", "csv"], default="jsonl")
    parser.add_argument("--summary-output", default="out/daily_summary_latest.csv")
    parser.add_argument("--log-file", default="logs/extract_mt5_events.log")
    parser.add_argument(
        "--warn-position-delta-ratio",
        type=float,
        default=0.5,
        help="Warn if total_positions changes by this ratio vs previous run for the same day.",
    )
    day_group = parser.add_mutually_exclusive_group()
    day_group.add_argument(
        "--today-vn",
        action="store_true",
        help="Extract full current Vietnam day (00:00-24:00 VN time).",
    )
    day_group.add_argument(
        "--day-vn",
        help="Extract full Vietnam day by date (YYYY-MM-DD), e.g. 2026-02-22.",
    )
    parser.add_argument("--since", help="UTC ISO time, e.g. 2026-02-01T00:00:00Z")
    parser.add_argument("--until", help="UTC ISO time, default now")
    parser.add_argument("--lookback-hours", type=int, default=24)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_iso_utc(value: str) -> datetime:
    return datetime.strptime(value, ISO_FORMAT).replace(tzinfo=UTC)


def format_iso_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime(ISO_FORMAT)


def format_iso_with_offset(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def parse_iso_datetime(value: str) -> datetime:
    if value.endswith("Z"):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return datetime.fromisoformat(value)


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=True, indent=2)


def getenv_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def init_mt5() -> tuple[str, str]:
    login = int(getenv_required("MT5_LOGIN"))
    password = getenv_required("MT5_PASSWORD")
    server = getenv_required("MT5_SERVER")
    terminal_path = os.getenv("MT5_PATH")

    ok = mt5.initialize(path=terminal_path, login=login, password=password, server=server)
    if not ok:
        code, message = mt5.last_error()
        raise SystemExit(f"MT5 initialize failed: {code} - {message}")

    account_info = mt5.account_info()
    if account_info is None:
        code, message = mt5.last_error()
        mt5.shutdown()
        raise SystemExit(f"MT5 account_info failed: {code} - {message}")

    return str(account_info.login), account_info.currency


def setup_logging(log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def deal_type_to_event_type(deal_type: int, profit: float) -> tuple[str, str]:
    # Mapping based on MT5 DealType constants
    if deal_type == mt5.DEAL_TYPE_BUY:
        return "trade", "Buy"
    if deal_type == mt5.DEAL_TYPE_SELL:
        return "trade", "Sell"
    if deal_type == mt5.DEAL_TYPE_BALANCE:
        return ("deposit", "Deposit") if profit >= 0 else ("withdrawal", "Withdrawal")
    if deal_type == mt5.DEAL_TYPE_CREDIT:
        return "credit", "Credit"
    return "balance_adjustment", "BalanceAdjustment"


def to_xm_iso(epoch_seconds: int | float | None) -> str | None:
    if not epoch_seconds:
        return None
    dt_utc = datetime.fromtimestamp(epoch_seconds, tz=UTC)
    dt_xm = dt_utc.astimezone(XM_TZ)
    return format_iso_with_offset(dt_xm)


def xm_iso_to_vn_iso(xm_iso: str | None) -> str | None:
    if not xm_iso:
        return None
    xm_dt = parse_iso_datetime(xm_iso)
    vn_dt = xm_dt.astimezone(VN_TZ)
    return format_iso_with_offset(vn_dt)


def trade_date_from_vn(close_time_vn: str | None, open_time_vn: str | None) -> str:
    ref = close_time_vn or open_time_vn
    if not ref:
        return datetime.now(tz=VN_TZ).date().isoformat()
    return parse_iso_datetime(ref).astimezone(VN_TZ).date().isoformat()


def calc_source_hash(payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def normalize_deal(
    deal: Any,
    account_id: str,
    account_currency: str,
    etl_run_id: str,
    synced_at_utc: str,
) -> RawEvent:
    profit = float(getattr(deal, "profit", 0.0) or 0.0)
    commission = float(getattr(deal, "commission", 0.0) or 0.0)
    swap = float(getattr(deal, "swap", 0.0) or 0.0)

    event_type, action = deal_type_to_event_type(getattr(deal, "type", -1), profit)

    close_time_xm = to_xm_iso(getattr(deal, "time", None))
    open_time_xm = to_xm_iso(getattr(deal, "time", None))
    close_time_vn = xm_iso_to_vn_iso(close_time_xm)
    open_time_vn = xm_iso_to_vn_iso(open_time_xm)

    business_fields = {
        "event_id": str(getattr(deal, "ticket", "")),
        "ticket": str(getattr(deal, "order", getattr(deal, "ticket", ""))),
        "position_id": str(getattr(deal, "position_id", "")) or None,
        "event_type": event_type,
        "action": action,
        "symbol": (getattr(deal, "symbol", "") or None),
        "lots": float(getattr(deal, "volume", 0.0) or 0.0),
        "open_price": None,
        "close_price": float(getattr(deal, "price", 0.0) or 0.0),
        "sl": None,
        "tp": None,
        "commission": commission,
        "swap": swap,
        "pips": None,
        "profit": profit,
        "comment": (getattr(deal, "comment", "") or None),
        "magic_number": str(getattr(deal, "magic", "")) or None,
        "duration_sec": None,
        "account_id": account_id,
        "account_currency": account_currency,
        "open_time_xm": open_time_xm,
        "close_time_xm": close_time_xm,
        "open_time_vn": open_time_vn,
        "close_time_vn": close_time_vn,
        "trade_date_vn": trade_date_from_vn(close_time_vn, open_time_vn),
    }

    source_hash = calc_source_hash(business_fields)

    return RawEvent(
        **business_fields,
        usd_vnd_rate=None,
        profit_vnd=None,
        commission_vnd=None,
        swap_vnd=None,
        fx_rate_source=None,
        fx_rate_time_utc=None,
        source_system="MT5",
        etl_run_id=etl_run_id,
        synced_at_utc=synced_at_utc,
        source_hash=source_hash,
        is_deleted=False,
    )


def get_deals(since_utc: datetime, until_utc: datetime) -> Iterable[Any]:
    deals = mt5.history_deals_get(since_utc, until_utc)
    if deals is None:
        code, message = mt5.last_error()
        raise SystemExit(f"history_deals_get failed: {code} - {message}")
    return deals


def write_jsonl(path: Path, events: list[RawEvent]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for event in events:
            f.write(json.dumps(asdict(event), ensure_ascii=True) + "\n")


def write_csv(path: Path, events: list[RawEvent]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(e) for e in events]
    if not rows:
        rows = [asdict(RawEvent(**{k: None for k in RawEvent.__annotations__.keys()}))]  # type: ignore[arg-type]
        rows = []
    headers = list(RawEvent.__annotations__.keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_daily_summary_csv(path: Path, summaries: list[DailySummary]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    headers = list(DailySummary.__annotations__.keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for summary in summaries:
            writer.writerow(asdict(summary))


def health_check_preflight(account_id: str, account_currency: str) -> None:
    terminal_info = mt5.terminal_info()
    if terminal_info is None:
        raise SystemExit("Preflight failed: unable to read MT5 terminal_info")
    logging.info(
        "Preflight ok: account_id=%s account_currency=%s terminal_connected=%s",
        account_id,
        account_currency,
        getattr(terminal_info, "connected", "unknown"),
    )


def build_daily_summaries(events: list[RawEvent], updated_at_utc: str) -> list[DailySummary]:
    by_day: dict[str, list[RawEvent]] = {}
    for event in events:
        by_day.setdefault(event.trade_date_vn, []).append(event)

    summaries: list[DailySummary] = []
    for day in sorted(by_day.keys()):
        day_events = by_day[day]
        trade_events = [e for e in day_events if e.event_type == "trade"]
        buy_deals = sum(1 for e in trade_events if e.action == "Buy")
        sell_deals = sum(1 for e in trade_events if e.action == "Sell")

        # Position-level PnL (closer to how XM reports total orders/trades)
        pnl_by_position: dict[str, float] = {}
        for e in trade_events:
            if e.position_id:
                pnl_by_position[e.position_id] = pnl_by_position.get(e.position_id, 0.0) + e.profit

        win_positions = sum(1 for v in pnl_by_position.values() if v > 0)
        loss_positions = sum(1 for v in pnl_by_position.values() if v < 0)

        gross_profit = sum(e.profit for e in day_events if e.profit > 0)
        gross_loss = sum(e.profit for e in day_events if e.profit < 0)
        total_deposit = sum(e.profit for e in day_events if e.event_type == "deposit")
        total_withdrawal = sum(-e.profit for e in day_events if e.event_type == "withdrawal")

        summaries.append(
            DailySummary(
                trade_date_vn=day,
                total_positions=len(pnl_by_position),
                total_deals=len(trade_events),
                buy_deals=buy_deals,
                sell_deals=sell_deals,
                win_positions=win_positions,
                loss_positions=loss_positions,
                net_profit=sum(e.profit for e in day_events),
                gross_profit=gross_profit,
                gross_loss=gross_loss,
                total_commission=sum(e.commission for e in day_events),
                total_swap=sum(e.swap for e in day_events),
                total_deposit=total_deposit,
                total_withdrawal=total_withdrawal,
                updated_at_utc=updated_at_utc,
            )
        )

    return summaries


def full_day_window_utc_from_vn_date(day_vn: datetime.date) -> tuple[datetime, datetime]:
    start_vn = datetime.combine(day_vn, datetime.min.time(), tzinfo=VN_TZ)
    end_vn = start_vn + timedelta(days=1)
    return start_vn.astimezone(UTC), end_vn.astimezone(UTC)


def resolve_window(args: argparse.Namespace, state: dict[str, Any]) -> tuple[datetime, datetime]:
    if args.today_vn:
        return full_day_window_utc_from_vn_date(datetime.now(tz=VN_TZ).date())

    if args.day_vn:
        try:
            day_vn = datetime.strptime(args.day_vn, "%Y-%m-%d").date()
        except ValueError as exc:
            raise SystemExit("Invalid --day-vn format. Use YYYY-MM-DD, e.g. 2026-02-22") from exc
        return full_day_window_utc_from_vn_date(day_vn)

    now_utc = datetime.now(tz=UTC)
    until_utc = parse_iso_utc(args.until) if args.until else now_utc

    if args.since:
        since_utc = parse_iso_utc(args.since)
    elif state.get("last_sync_time_utc"):
        since_utc = parse_iso_utc(state["last_sync_time_utc"]) - timedelta(hours=args.lookback_hours)
    else:
        since_utc = now_utc - timedelta(days=7)

    if since_utc >= until_utc:
        raise SystemExit("Invalid window: since must be earlier than until")

    return since_utc, until_utc


def validate_outputs(output_path: Path, summary_output_path: Path, events_count: int, summaries: list[DailySummary]) -> None:
    if not output_path.exists():
        raise SystemExit(f"Post-check failed: output file not found: {output_path}")
    if not summary_output_path.exists():
        raise SystemExit(f"Post-check failed: summary file not found: {summary_output_path}")
    if len(summaries) == 0 and events_count > 0:
        raise SystemExit("Post-check failed: events exist but daily summary is empty")


def warn_if_abnormal_positions(
    state: dict[str, Any],
    summaries: list[DailySummary],
    threshold_ratio: float,
) -> None:
    if not summaries:
        return
    latest = summaries[-1]
    prev_map = state.get("last_positions_by_day", {})
    prev = prev_map.get(latest.trade_date_vn)
    if prev is None:
        return
    prev = int(prev)
    if prev == 0:
        return
    delta_ratio = abs(latest.total_positions - prev) / prev
    if delta_ratio >= threshold_ratio:
        logging.warning(
            "Position count changed abnormally for %s: prev=%s current=%s delta_ratio=%.2f",
            latest.trade_date_vn,
            prev,
            latest.total_positions,
            delta_ratio,
        )


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    dotenv_path = project_root / ".env"
    load_dotenv(dotenv_path=dotenv_path, override=False, encoding="utf-8-sig")

    args = parse_args()
    state_path = Path(args.state_file)
    output_path = Path(args.output)
    summary_output_path = Path(args.summary_output)
    log_file = Path(args.log_file)
    setup_logging(log_file)

    state = load_state(state_path)
    since_utc, until_utc = resolve_window(args, state)
    logging.info("Run window: since_utc=%s until_utc=%s", format_iso_utc(since_utc), format_iso_utc(until_utc))

    account_id, account_currency = init_mt5()
    health_check_preflight(account_id, account_currency)

    etl_run_id = str(uuid.uuid4())
    synced_at_utc = format_iso_utc(datetime.now(tz=UTC))

    deals = list(get_deals(since_utc, until_utc))
    logging.info("Fetched deals: %s", len(deals))
    events = [
        normalize_deal(
            deal=deal,
            account_id=account_id,
            account_currency=account_currency,
            etl_run_id=etl_run_id,
            synced_at_utc=synced_at_utc,
        )
        for deal in deals
    ]

    if args.output_format == "jsonl":
        write_jsonl(output_path, events)
    else:
        write_csv(output_path, events)
    summaries = build_daily_summaries(events, synced_at_utc)
    write_daily_summary_csv(summary_output_path, summaries)
    validate_outputs(output_path, summary_output_path, len(events), summaries)
    warn_if_abnormal_positions(state, summaries, args.warn_position_delta_ratio)
    if len(events) == 0:
        logging.warning("No events returned for window")

    if not args.dry_run:
        state["last_sync_time_utc"] = format_iso_utc(until_utc)
        state["last_run_event_count"] = len(events)
        state["last_run_id"] = etl_run_id
        state["last_positions_by_day"] = {s.trade_date_vn: s.total_positions for s in summaries}
        save_state(state_path, state)

    print(
        json.dumps(
            {
                "status": "ok",
                "events": len(events),
                "since_utc": format_iso_utc(since_utc),
                "until_utc": format_iso_utc(until_utc),
                "output": str(output_path),
                "summary_output": str(summary_output_path),
                "dry_run": args.dry_run,
            },
            ensure_ascii=True,
        )
    )

    mt5.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
