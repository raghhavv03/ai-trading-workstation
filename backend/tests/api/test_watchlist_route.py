from datetime import datetime, timezone

import aiosqlite
import pytest
from fastapi import HTTPException

from app.api import watchlist
from app.db.connection import init_db_if_needed
from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.tracked_tickers import TrackedTickerRegistry

DEFAULT_TICKERS = {"AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"}


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await init_db_if_needed(db)
    return db


def _registry(watchlist_tickers: set[str] = frozenset()) -> TrackedTickerRegistry:
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(watchlist_tickers), positions=set())
    return registry


@pytest.mark.asyncio
async def test_get_watchlist_returns_seeded_default_tickers():
    db = await _make_db()
    result = await watchlist.get_watchlist(db, PriceCache())
    assert {row["ticker"] for row in result} == DEFAULT_TICKERS
    assert all(row["price"] is None for row in result)
    await db.close()


@pytest.mark.asyncio
async def test_get_watchlist_includes_cached_price():
    db = await _make_db()
    cache = PriceCache()
    await cache.update(
        PriceTick("AAPL", price=191.23, previous_price=190.0, timestamp=datetime.now(timezone.utc))
    )
    result = await watchlist.get_watchlist(db, cache)
    aapl = next(row for row in result if row["ticker"] == "AAPL")
    assert aapl["price"] == 191.23
    assert aapl["direction"] == "up"
    await db.close()


@pytest.mark.asyncio
async def test_add_ticker_writes_through_to_registry_and_db():
    db = await _make_db()
    registry = _registry()
    await watchlist.add_ticker({"ticker": "pypl"}, db, registry)
    assert "PYPL" in registry.get()
    rows = await db.execute_fetchall("SELECT ticker FROM watchlist WHERE ticker = 'PYPL'")
    assert len(rows) == 1
    await db.close()


@pytest.mark.asyncio
async def test_add_ticker_rejects_invalid_format():
    db = await _make_db()
    registry = _registry()
    with pytest.raises(HTTPException) as exc_info:
        await watchlist.add_ticker({"ticker": "toolong1"}, db, registry)
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_add_ticker_rejects_when_watchlist_full():
    db = await _make_db()
    registry = _registry()
    for i in range(20):  # 10 seeded + 20 = 30, the cap
        await watchlist.add_ticker({"ticker": f"T{i}"}, db, registry)
    with pytest.raises(HTTPException) as exc_info:
        await watchlist.add_ticker({"ticker": "OVER"}, db, registry)
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_remove_ticker_drops_from_watchlist_but_keeps_open_position():
    db = await _make_db()
    registry = _registry({"AAPL"})
    registry.set_position_ticker("AAPL", quantity=5.0)
    await watchlist.remove_ticker("AAPL", db, registry)
    assert registry.get() == {"AAPL"}  # still tracked via the open position
    rows = await db.execute_fetchall("SELECT ticker FROM watchlist WHERE ticker = 'AAPL'")
    assert rows == []
    await db.close()
