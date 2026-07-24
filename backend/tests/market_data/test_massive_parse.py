import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.massive_client import MassiveProvider


def make_snapshot_item(ticker, day_close=None, prev_close=None, last_trade_price=None):
    return SimpleNamespace(
        ticker=ticker,
        day=None if day_close is None else SimpleNamespace(close=day_close),
        prev_day=None if prev_close is None else SimpleNamespace(close=prev_close),
        last_trade=None if last_trade_price is None else SimpleNamespace(price=last_trade_price),
    )


def test_first_poll_falls_back_to_prev_day_close():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=191.0, prev_close=189.5)
    tick = provider._parse(item)
    assert tick.price == 191.0
    assert tick.previous_price == 189.5  # no cache entry yet -> prevDay.close


@pytest.mark.asyncio
async def test_subsequent_poll_uses_cache_not_prev_day_close():
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache)
    await cache.update(
        PriceTick("AAPL", price=190.0, previous_price=189.0, timestamp=datetime.now(timezone.utc))
    )

    item = make_snapshot_item("AAPL", day_close=191.5, prev_close=150.0)  # stale prevDay on purpose
    tick = provider._parse(item)
    assert tick.price == 191.5
    assert tick.previous_price == 190.0  # from cache, NOT the 150.0 prevDay.close


def test_missing_day_close_falls_back_to_last_trade():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=None, prev_close=189.0, last_trade_price=190.25)
    tick = provider._parse(item)
    assert tick.price == 190.25


def test_no_usable_price_returns_none():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=None, prev_close=189.0, last_trade_price=None)
    assert provider._parse(item) is None


def test_missing_ticker_returns_none():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item(None, day_close=191.0, prev_close=189.5)
    assert provider._parse(item) is None


def test_no_prev_day_and_no_cache_falls_back_to_current_price():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=191.0, prev_close=None)
    tick = provider._parse(item)
    assert tick.price == 191.0
    assert tick.previous_price == 191.0
    assert tick.direction == "flat"


def test_direction_property_reflects_up_move():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=191.0, prev_close=189.5)
    tick = provider._parse(item)
    assert tick.direction == "up"


@pytest.mark.asyncio
async def test_poll_once_writes_every_parsed_ticker_to_cache(monkeypatch):
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache)

    canned = [
        make_snapshot_item("AAPL", day_close=191.0, prev_close=189.5),
        make_snapshot_item("TSLA", day_close=250.0, prev_close=248.0),
    ]
    monkeypatch.setattr(provider._client, "get_snapshot_all", lambda *a, **k: canned)

    await provider._poll_once(["AAPL", "TSLA"])

    assert cache.get("AAPL").price == 191.0
    assert cache.get("TSLA").price == 250.0


@pytest.mark.asyncio
async def test_poll_once_skips_unparseable_items(monkeypatch):
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache)

    canned = [
        # unparseable: no day close, no prev close, no last trade
        make_snapshot_item("AAPL", day_close=None, prev_close=None, last_trade_price=None),
        make_snapshot_item("TSLA", day_close=250.0, prev_close=248.0),
    ]
    monkeypatch.setattr(provider._client, "get_snapshot_all", lambda *a, **k: canned)

    await provider._poll_once(["AAPL", "TSLA"])

    assert cache.get("AAPL") is None
    assert cache.get("TSLA") is not None


@pytest.mark.asyncio
async def test_poll_loop_survives_a_raising_cycle_and_keeps_polling(monkeypatch):
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache, poll_interval=0.05)

    calls = {"n": 0}

    async def flaky_poll_once(tickers):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated transient network error")
        await cache.update(
            PriceTick(
                "AAPL", price=100.0, previous_price=99.0, timestamp=datetime.now(timezone.utc)
            )
        )

    monkeypatch.setattr(provider, "_poll_once", flaky_poll_once)

    await provider.start(lambda: {"AAPL"})
    await asyncio.sleep(0.2)
    await provider.stop()

    assert calls["n"] >= 2
    assert cache.get("AAPL") is not None


@pytest.mark.asyncio
async def test_stop_before_start_does_not_raise():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    await provider.stop()


@pytest.mark.asyncio
async def test_poll_loop_skips_cycle_when_no_tickers_watched(monkeypatch):
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache, poll_interval=0.05)

    called = {"n": 0}

    async def counting_poll_once(tickers):
        called["n"] += 1

    monkeypatch.setattr(provider, "_poll_once", counting_poll_once)

    await provider.start(lambda: set())
    await asyncio.sleep(0.2)
    await provider.stop()

    assert called["n"] == 0
