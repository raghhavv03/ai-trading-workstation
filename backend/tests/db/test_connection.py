import aiosqlite
import pytest

from app.db.connection import DEFAULT_USER_ID, init_db_if_needed


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    return db


@pytest.mark.asyncio
async def test_init_seeds_default_user_and_watchlist():
    db = await _make_db()
    await init_db_if_needed(db)

    user_rows = await db.execute_fetchall(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    )
    assert user_rows[0][0] == 10000.0

    ticker_rows = await db.execute_fetchall("SELECT ticker FROM watchlist")
    assert len(ticker_rows) == 10
    await db.close()


@pytest.mark.asyncio
async def test_init_is_idempotent_and_does_not_reseed():
    db = await _make_db()
    await init_db_if_needed(db)

    await db.execute(
        "UPDATE users_profile SET cash_balance = 42.0 WHERE id = ?", (DEFAULT_USER_ID,)
    )
    await db.commit()

    await init_db_if_needed(db)  # simulate a restart against the same DB

    rows = await db.execute_fetchall(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    )
    assert rows[0][0] == 42.0  # not reset back to the seed default
    await db.close()


@pytest.mark.asyncio
async def test_init_creates_all_tables():
    db = await _make_db()
    await init_db_if_needed(db)

    rows = await db.execute_fetchall("SELECT name FROM sqlite_master WHERE type = 'table'")
    tables = {row[0] for row in rows}
    assert {
        "users_profile",
        "watchlist",
        "positions",
        "trades",
        "portfolio_snapshots",
        "chat_messages",
    } <= tables
    await db.close()


@pytest.mark.asyncio
async def test_reinit_preserves_snapshot_and_chat_rows():
    db = await _make_db()
    await init_db_if_needed(db)

    await db.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES ('s1', ?, 10000.0, '2026-07-25T12:00:00+00:00')",
        (DEFAULT_USER_ID,),
    )
    await db.execute(
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
        "VALUES ('m1', ?, 'user', 'hello', NULL, '2026-07-25T12:00:00+00:00')",
        (DEFAULT_USER_ID,),
    )
    await db.commit()

    await init_db_if_needed(db)  # simulate a restart against the same DB

    snapshots = await db.execute_fetchall("SELECT id FROM portfolio_snapshots")
    messages = await db.execute_fetchall("SELECT id FROM chat_messages")
    assert [row[0] for row in snapshots] == ["s1"]
    assert [row[0] for row in messages] == ["m1"]
    await db.close()


@pytest.mark.asyncio
async def test_chat_message_actions_is_nullable_and_user_id_defaults():
    db = await _make_db()
    await init_db_if_needed(db)

    await db.execute(
        "INSERT INTO chat_messages (id, role, content, created_at) "
        "VALUES ('m1', 'user', 'hello', '2026-07-25T12:00:00+00:00')"
    )
    await db.commit()

    rows = await db.execute_fetchall("SELECT user_id, actions FROM chat_messages")
    assert rows[0]["user_id"] == DEFAULT_USER_ID
    assert rows[0]["actions"] is None
    await db.close()
