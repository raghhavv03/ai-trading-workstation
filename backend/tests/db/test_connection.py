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
