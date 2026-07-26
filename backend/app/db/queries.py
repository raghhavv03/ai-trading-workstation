from __future__ import annotations

import uuid
from datetime import datetime, timezone

import aiosqlite


async def insert_portfolio_snapshot(
    db: aiosqlite.Connection,
    user_id: str,
    total_value: float,
    recorded_at: str,
) -> str:
    snapshot_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (snapshot_id, user_id, total_value, recorded_at),
    )
    await db.commit()
    return snapshot_id


async def get_portfolio_history(db: aiosqlite.Connection, user_id: str) -> list[dict]:
    rows = await db.execute_fetchall(
        "SELECT total_value, recorded_at FROM portfolio_snapshots "
        "WHERE user_id = ? ORDER BY recorded_at, rowid",
        (user_id,),
    )
    return [{"total_value": row[0], "recorded_at": row[1]} for row in rows]


async def insert_chat_message(
    db: aiosqlite.Connection,
    user_id: str,
    role: str,
    content: str,
    actions_json: str | None = None,
) -> str:
    message_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            message_id,
            user_id,
            role,
            content,
            actions_json,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    await db.commit()
    return message_id


async def get_recent_chat_messages(
    db: aiosqlite.Connection, user_id: str, limit: int
) -> list[dict]:
    """Returns the `limit` most recent messages, oldest-first -- callers render
    and prompt in chronological order, so the newest-first slice is reversed here."""
    rows = await db.execute_fetchall(
        "SELECT role, content, actions, created_at FROM chat_messages "
        "WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        (user_id, limit),
    )
    return [
        {"role": row[0], "content": row[1], "actions": row[2], "created_at": row[3]}
        for row in reversed(rows)
    ]
