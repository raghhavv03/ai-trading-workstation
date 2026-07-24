from datetime import datetime, timezone

import aiosqlite
import pytest
from fastapi import HTTPException

from app.api import portfolio
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
async def test_get_portfolio_starts_empty_with_seeded_cash():
    db = await _make_db()
    result = await portfolio.get_portfolio(db, PriceCache())
    assert result == {"cash_balance": 10000.0, "positions": [], "total_value": 10000.0}
    await db.close()


@pytest.mark.asyncio
async def test_buy_deducts_cash_and_creates_position():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)

    result = await portfolio.execute_trade(
        {"ticker": "aapl", "side": "buy", "quantity": 10}, db, cache, registry
    )

    assert result["fill_price"] == 200.0
    assert result["cash_balance"] == 8000.0
    assert registry.get() == {"AAPL"}

    port = await portfolio.get_portfolio(db, cache)
    assert port["cash_balance"] == 8000.0
    assert port["positions"][0]["quantity"] == 10.0
    assert port["positions"][0]["avg_cost"] == 200.0
    await db.close()


@pytest.mark.asyncio
async def test_buy_rejects_insufficient_cash():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)

    with pytest.raises(HTTPException) as exc_info:
        await portfolio.execute_trade(
            {"ticker": "AAPL", "side": "buy", "quantity": 1000}, db, cache, registry
        )
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_sell_more_than_owned_is_rejected():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 5}, db, cache, registry
    )

    with pytest.raises(HTTPException) as exc_info:
        await portfolio.execute_trade(
            {"ticker": "AAPL", "side": "sell", "quantity": 10}, db, cache, registry
        )
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_full_sellout_removes_position_and_stops_tracking():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 5}, db, cache, registry
    )
    result = await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "sell", "quantity": 5}, db, cache, registry
    )

    assert result["cash_balance"] == 10000.0
    assert registry.get() == set()
    port = await portfolio.get_portfolio(db, cache)
    assert port["positions"] == []
    await db.close()


@pytest.mark.asyncio
async def test_trade_rejected_when_no_price_available_yet():
    db = await _make_db()
    registry = _registry()

    with pytest.raises(HTTPException) as exc_info:
        await portfolio.execute_trade(
            {"ticker": "ZZZZ", "side": "buy", "quantity": 1}, db, PriceCache(), registry
        )
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_average_cost_updates_on_second_buy_at_a_different_price():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 100.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    pos = (await portfolio.get_portfolio(db, cache))["positions"][0]
    assert pos["quantity"] == 20.0
    assert pos["avg_cost"] == 150.0  # (10*100 + 10*200) / 20
    await db.close()
