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


@pytest.mark.asyncio
async def test_unrealized_pnl_and_market_value_track_the_live_price():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 100.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 130.0)
    result = await portfolio.get_portfolio(db, cache)

    pos = result["positions"][0]
    assert pos["current_price"] == 130.0
    assert pos["market_value"] == 1300.0
    assert pos["unrealized_pnl"] == 300.0  # 10 * (130 - 100)
    assert result["total_value"] == 10300.0  # 9000 cash + 1300 market value
    await db.close()


@pytest.mark.asyncio
async def test_unrealized_pnl_goes_negative_when_price_falls_below_cost():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 100.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 3}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 90.333333)
    pos = (await portfolio.get_portfolio(db, cache))["positions"][0]

    # Rounding is applied at serialization only (PLAN.md §7): 3 * (90.333333 - 100).
    assert pos["unrealized_pnl"] == -29.0
    assert pos["current_price"] == 90.33
    await db.close()


@pytest.mark.asyncio
async def test_position_falls_back_to_avg_cost_when_no_price_is_cached():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 100.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    # A restart leaves the position in the DB but the cache empty until the first tick.
    result = await portfolio.get_portfolio(db, PriceCache())

    pos = result["positions"][0]
    assert pos["current_price"] == 100.0
    assert pos["unrealized_pnl"] == 0.0
    assert result["total_value"] == 10000.0
    await db.close()


@pytest.mark.asyncio
async def test_partial_sell_at_a_loss_keeps_avg_cost_and_leaves_the_rest_underwater():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 150.0)
    result = await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "sell", "quantity": 4}, db, cache, registry
    )

    assert result["fill_price"] == 150.0
    assert result["cash_balance"] == 8600.0  # 8000 + 4 * 150

    pos = (await portfolio.get_portfolio(db, cache))["positions"][0]
    assert pos["quantity"] == 6.0
    assert pos["avg_cost"] == 200.0  # a sell never re-bases cost, it only realizes the loss
    assert pos["unrealized_pnl"] == -300.0  # 6 * (150 - 200)
    await db.close()


@pytest.mark.asyncio
async def test_full_sellout_at_a_loss_realizes_the_loss_in_cash():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)
    await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "buy", "quantity": 10}, db, cache, registry
    )

    await _seed_price(cache, "AAPL", 150.0)
    result = await portfolio.execute_trade(
        {"ticker": "AAPL", "side": "sell", "quantity": 10}, db, cache, registry
    )

    assert result["cash_balance"] == 9500.0  # 8000 + 10 * 150, a realized $500 loss
    port = await portfolio.get_portfolio(db, cache)
    assert port["positions"] == []
    assert port["total_value"] == 9500.0
    await db.close()


@pytest.mark.asyncio
async def test_invalid_side_is_rejected():
    db = await _make_db()
    cache = PriceCache()
    await _seed_price(cache, "AAPL", 200.0)

    with pytest.raises(HTTPException) as exc_info:
        await portfolio.execute_trade(
            {"ticker": "AAPL", "side": "short", "quantity": 1}, db, cache, _registry()
        )
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("quantity", ["abc", None, 0, -5])
async def test_unusable_quantity_is_rejected(quantity):
    db = await _make_db()
    cache = PriceCache()
    await _seed_price(cache, "AAPL", 200.0)

    with pytest.raises(HTTPException) as exc_info:
        await portfolio.execute_trade(
            {"ticker": "AAPL", "side": "buy", "quantity": quantity}, db, cache, _registry()
        )
    assert exc_info.value.status_code == 400
    await db.close()
