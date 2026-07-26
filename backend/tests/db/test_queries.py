import json

import aiosqlite
import pytest

from app.db.connection import DEFAULT_USER_ID, init_db_if_needed
from app.db.queries import (
    get_portfolio_history,
    get_recent_chat_messages,
    insert_chat_message,
    insert_portfolio_snapshot,
)


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await init_db_if_needed(db)
    return db


@pytest.mark.asyncio
async def test_snapshot_roundtrip_is_ordered_by_recorded_at():
    db = await _make_db()

    await insert_portfolio_snapshot(db, DEFAULT_USER_ID, 10500.0, "2026-07-25T12:01:00+00:00")
    await insert_portfolio_snapshot(db, DEFAULT_USER_ID, 10000.0, "2026-07-25T12:00:00+00:00")
    await insert_portfolio_snapshot(db, DEFAULT_USER_ID, 10250.5, "2026-07-25T12:02:00+00:00")

    history = await get_portfolio_history(db, DEFAULT_USER_ID)
    assert [row["total_value"] for row in history] == [10000.0, 10500.0, 10250.5]
    assert history[0]["recorded_at"] == "2026-07-25T12:00:00+00:00"
    await db.close()


@pytest.mark.asyncio
async def test_portfolio_history_is_scoped_to_user():
    db = await _make_db()

    await insert_portfolio_snapshot(db, DEFAULT_USER_ID, 10000.0, "2026-07-25T12:00:00+00:00")
    await insert_portfolio_snapshot(db, "someone-else", 999.0, "2026-07-25T12:00:00+00:00")

    history = await get_portfolio_history(db, DEFAULT_USER_ID)
    assert [row["total_value"] for row in history] == [10000.0]
    await db.close()


@pytest.mark.asyncio
async def test_empty_portfolio_history():
    db = await _make_db()
    assert await get_portfolio_history(db, DEFAULT_USER_ID) == []
    await db.close()


@pytest.mark.asyncio
async def test_chat_message_roundtrip_preserves_actions_json():
    db = await _make_db()

    actions = json.dumps({"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 10}]})
    await insert_chat_message(db, DEFAULT_USER_ID, "user", "buy 10 AAPL")
    await insert_chat_message(db, DEFAULT_USER_ID, "assistant", "Bought 10 AAPL.", actions)

    messages = await get_recent_chat_messages(db, DEFAULT_USER_ID, 10)
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["actions"] is None
    assert json.loads(messages[1]["actions"]) == json.loads(actions)
    assert messages[0]["created_at"] <= messages[1]["created_at"]
    await db.close()


@pytest.mark.asyncio
async def test_recent_chat_messages_returns_newest_window_oldest_first():
    db = await _make_db()

    for i in range(5):
        await insert_chat_message(db, DEFAULT_USER_ID, "user", f"message {i}")

    messages = await get_recent_chat_messages(db, DEFAULT_USER_ID, 3)
    assert [m["content"] for m in messages] == ["message 2", "message 3", "message 4"]
    await db.close()


@pytest.mark.asyncio
async def test_chat_messages_scoped_to_user():
    db = await _make_db()

    await insert_chat_message(db, DEFAULT_USER_ID, "user", "mine")
    await insert_chat_message(db, "someone-else", "user", "theirs")

    messages = await get_recent_chat_messages(db, DEFAULT_USER_ID, 10)
    assert [m["content"] for m in messages] == ["mine"]
    await db.close()
