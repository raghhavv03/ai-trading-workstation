import asyncio
from datetime import datetime, timezone

import pytest

from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache


def make_tick(ticker="AAPL", price=100.0, previous_price=99.0):
    return PriceTick(
        ticker=ticker,
        price=price,
        previous_price=previous_price,
        timestamp=datetime.now(timezone.utc),
    )


def test_get_missing_ticker_returns_none():
    cache = PriceCache()
    assert cache.get("AAPL") is None


@pytest.mark.asyncio
async def test_update_then_get_returns_tick():
    cache = PriceCache()
    tick = make_tick()
    await cache.update(tick)
    assert cache.get("AAPL") == tick


@pytest.mark.asyncio
async def test_update_overwrites_previous_tick_for_same_ticker():
    cache = PriceCache()
    await cache.update(make_tick(price=100.0))
    await cache.update(make_tick(price=105.0))
    assert cache.get("AAPL").price == 105.0


@pytest.mark.asyncio
async def test_all_returns_snapshot_of_every_ticker():
    cache = PriceCache()
    await cache.update(make_tick(ticker="AAPL"))
    await cache.update(make_tick(ticker="TSLA"))
    snapshot = cache.all()
    assert set(snapshot.keys()) == {"AAPL", "TSLA"}


@pytest.mark.asyncio
async def test_all_returns_a_copy_not_a_live_view():
    cache = PriceCache()
    await cache.update(make_tick(ticker="AAPL"))
    snapshot = cache.all()
    await cache.update(make_tick(ticker="AAPL", price=200.0))
    # The earlier snapshot must not mutate after a later update.
    assert snapshot["AAPL"].price != 200.0


@pytest.mark.asyncio
async def test_concurrent_updates_do_not_lose_writes():
    cache = PriceCache()
    tickers = [f"T{i}" for i in range(50)]
    await asyncio.gather(*(cache.update(make_tick(ticker=t)) for t in tickers))
    assert set(cache.all().keys()) == set(tickers)
