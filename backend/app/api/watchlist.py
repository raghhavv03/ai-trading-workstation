from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_cache, get_db, get_registry
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()

TICKER_PATTERN = re.compile(r"^[A-Z0-9]{1,5}$")
WATCHLIST_CAP = 30
DEFAULT_USER_ID = "default"


def _serialize(ticker: str, cache: PriceCache) -> dict:
    tick = cache.get(ticker)
    if tick is None:
        return {"ticker": ticker, "price": None, "previous_price": None, "direction": None}
    return {
        "ticker": ticker,
        "price": round(tick.price, 2),
        "previous_price": round(tick.previous_price, 2),
        "direction": tick.direction,
    }


@router.get("/watchlist")
async def get_watchlist(
    db: aiosqlite.Connection = Depends(get_db),
    cache: PriceCache = Depends(get_cache),
):
    rows = await db.execute_fetchall(
        "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at", (DEFAULT_USER_ID,)
    )
    return [_serialize(row[0], cache) for row in rows]


@router.post("/watchlist")
async def add_ticker(
    body: dict,
    db: aiosqlite.Connection = Depends(get_db),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = str(body.get("ticker", "")).strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(400, f"Invalid ticker format: {ticker!r}")

    count_row = await db.execute_fetchall(
        "SELECT COUNT(*) FROM watchlist WHERE user_id = ?", (DEFAULT_USER_ID,)
    )
    if count_row[0][0] >= WATCHLIST_CAP:
        raise HTTPException(400, "Watchlist is full (30 ticker limit)")

    await db.execute(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()

    # Write-through: the provider's tick loop picks this up on its very next
    # cycle via registry.get(), no restart needed.
    registry.add_watchlist_ticker(ticker)

    return {"ticker": ticker}


@router.delete("/watchlist/{ticker}")
async def remove_ticker(
    ticker: str,
    db: aiosqlite.Connection = Depends(get_db),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = ticker.upper()
    await db.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (DEFAULT_USER_ID, ticker)
    )
    await db.commit()

    # Only drops the watchlist half of the union -- an open position (if any)
    # keeps it tracked via the positions half, per PLAN.md §6.
    registry.remove_watchlist_ticker(ticker)

    return {"ticker": ticker}
