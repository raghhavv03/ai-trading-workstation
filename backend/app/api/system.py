from __future__ import annotations

import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends

from .. import llm
from ..db.connection import DEFAULT_CASH_BALANCE, DEFAULT_WATCHLIST
from ..deps import get_db, get_registry
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()
DEFAULT_USER_ID = "default"


@router.get("/health")
async def health():
    return {"status": "ok", "ollama": await llm.check_ollama()}


@router.post("/system/reset")
async def reset(
    db: aiosqlite.Connection = Depends(get_db),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    for table in ("positions", "trades", "portfolio_snapshots", "chat_messages", "watchlist"):
        await db.execute(f"DELETE FROM {table} WHERE user_id = ?", (DEFAULT_USER_ID,))

    now = datetime.now(timezone.utc).isoformat()
    for ticker in DEFAULT_WATCHLIST:
        await db.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, now),
        )
    await db.execute(
        "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
        (DEFAULT_CASH_BALANCE, DEFAULT_USER_ID),
    )
    await db.commit()

    # Re-sync the streaming registry, or tickers added since the last restart
    # would keep ticking despite no longer existing in the database.
    registry.load_initial(watchlist=set(DEFAULT_WATCHLIST), positions=set())

    return {
        "status": "reset",
        "cash_balance": DEFAULT_CASH_BALANCE,
        "watchlist": list(DEFAULT_WATCHLIST),
    }
