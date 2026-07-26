from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB_PATH = "data/tradeally.db"
DEFAULT_USER_ID = "default"
DEFAULT_CASH_BALANCE = 10000.0
DEFAULT_WATCHLIST = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"]


async def get_db_connection(db_path: str | None = None) -> aiosqlite.Connection:
    path = db_path or os.environ.get("DB_PATH", DEFAULT_DB_PATH)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    return db


async def init_db_if_needed(db: aiosqlite.Connection) -> None:
    """Creates tables if missing, then seeds the default user/watchlist exactly
    once -- a users_profile row already existing is the signal this database
    has been seeded before, so a restart never re-adds the default watchlist
    on top of a user's edited one (PLAN.md §7)."""
    await db.executescript(SCHEMA_PATH.read_text())
    await db.commit()

    existing_user = await db.execute_fetchall(
        "SELECT id FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    )
    if existing_user:
        return

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, now),
    )
    for ticker in DEFAULT_WATCHLIST:
        await db.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, now),
        )
    await db.commit()
