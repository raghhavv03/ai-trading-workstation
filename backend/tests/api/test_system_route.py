from datetime import datetime, timezone

import aiosqlite
import pytest

from app.api import chat, portfolio, system, watchlist
from app.db.connection import DEFAULT_WATCHLIST, init_db_if_needed
from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.tracked_tickers import TrackedTickerRegistry


@pytest.fixture(autouse=True)
def _mock_llm(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await init_db_if_needed(db)
    return db


def _registry() -> TrackedTickerRegistry:
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(DEFAULT_WATCHLIST), positions=set())
    return registry


@pytest.mark.asyncio
async def test_reset_restores_seeded_state():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await cache.update(
        PriceTick("AAPL", price=200.0, previous_price=200.0, timestamp=datetime.now(timezone.utc))
    )

    await watchlist.add_ticker({"ticker": "PYPL"}, db, registry)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 5}, db, cache, registry
    )
    await chat.send_message({"message": "hello"}, db, cache, registry)

    await system.reset(db, registry)

    assert (await portfolio.get_portfolio(db, cache)) == {
        "cash_balance": 10000.0,
        "positions": [],
        "total_value": 10000.0,
    }
    assert await portfolio.get_portfolio_history(db) == []
    assert await chat.get_chat_history(db) == []
    assert {row["ticker"] for row in await watchlist.get_watchlist(db, cache)} == set(
        DEFAULT_WATCHLIST
    )
    assert (await db.execute_fetchall("SELECT * FROM trades")) == []
    await db.close()


@pytest.mark.asyncio
async def test_reset_resyncs_the_streaming_registry():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await cache.update(
        PriceTick("AAPL", price=200.0, previous_price=200.0, timestamp=datetime.now(timezone.utc))
    )
    await watchlist.add_ticker({"ticker": "PYPL"}, db, registry)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 5}, db, cache, registry
    )

    await system.reset(db, registry)

    # PYPL is gone from the DB, so it must stop streaming; AAPL survives only
    # because it is a default watchlist ticker, not because of the closed position.
    assert registry.get() == set(DEFAULT_WATCHLIST)
    await db.close()


@pytest.mark.asyncio
async def test_reset_is_idempotent():
    db = await _make_db()
    registry = _registry()
    await system.reset(db, registry)
    await system.reset(db, registry)

    rows = await db.execute_fetchall("SELECT ticker FROM watchlist")
    assert len(rows) == len(DEFAULT_WATCHLIST)
    await db.close()


@pytest.mark.asyncio
async def test_health_reports_ollama_status(monkeypatch):
    async def _unreachable():
        return "unreachable"

    monkeypatch.setattr(system.llm, "check_ollama", _unreachable)
    assert await system.health() == {"status": "ok", "ollama": "unreachable"}
