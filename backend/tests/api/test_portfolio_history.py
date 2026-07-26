from datetime import datetime, timezone

import aiosqlite
import pytest

from app.api import portfolio
from app.db import queries
from app.db.connection import init_db_if_needed
from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.tracked_tickers import TrackedTickerRegistry


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await init_db_if_needed(db)
    return db


def _registry() -> TrackedTickerRegistry:
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions=set())
    return registry


async def _seed_price(cache: PriceCache, ticker: str, price: float) -> None:
    await cache.update(
        PriceTick(ticker, price=price, previous_price=price, timestamp=datetime.now(timezone.utc))
    )


@pytest.mark.asyncio
async def test_history_is_empty_before_any_snapshot():
    db = await _make_db()
    assert await portfolio.get_portfolio_history(db) == []
    await db.close()


@pytest.mark.asyncio
async def test_history_returns_snapshots_oldest_first():
    db = await _make_db()
    for value, recorded_at in [
        (10200.0, "2026-07-25T12:02:00+00:00"),
        (10000.0, "2026-07-25T12:00:00+00:00"),
        (10100.0, "2026-07-25T12:01:00+00:00"),
    ]:
        await queries.insert_portfolio_snapshot(db, "default", value, recorded_at)

    history = await portfolio.get_portfolio_history(db)
    assert [row["total_value"] for row in history] == [10000.0, 10100.0, 10200.0]
    await db.close()


@pytest.mark.asyncio
async def test_trade_records_a_snapshot_immediately():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)

    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    history = await portfolio.get_portfolio_history(db)
    assert len(history) == 1
    # 8000 cash + 10 shares at the 200.0 fill price -- unchanged total right after the fill.
    assert history[0]["total_value"] == 10000.0
    await db.close()


@pytest.mark.asyncio
async def test_snapshot_tracks_price_moves_after_the_fill():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 220.0)
    await portfolio.record_snapshot(db, cache)

    history = await portfolio.get_portfolio_history(db)
    assert [row["total_value"] for row in history] == [10000.0, 10200.0]
    await db.close()
