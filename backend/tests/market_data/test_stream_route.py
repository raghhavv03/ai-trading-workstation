from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.stream import _format_event, _price_events
from app.main import app
from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.tracked_tickers import TrackedTickerRegistry


class _FakeRequest:
    """Signals connected for `disconnect_after` calls to is_disconnected(),
    then disconnected -- lets us bound an otherwise-infinite SSE generator
    without a real HTTP round trip (Starlette's TestClient fully drains a
    streaming response body before returning, so it can't test an endpoint
    that streams indefinitely; driving the generator directly is correct
    for a unit test of the streaming logic itself)."""

    def __init__(self, disconnect_after: int) -> None:
        self._calls = 0
        self._disconnect_after = disconnect_after

    async def is_disconnected(self) -> bool:
        self._calls += 1
        return self._calls > self._disconnect_after


def test_format_event_wire_shape():
    tick = PriceTick(
        ticker="AAPL",
        price=191.23,
        previous_price=190.87,
        timestamp=datetime(2026, 7, 23, 14, 2, 31, 500000, tzinfo=timezone.utc),
    )
    event = _format_event(tick)
    assert event.startswith("event: price\n")
    assert '"ticker": "AAPL"' in event or '"ticker":"AAPL"' in event
    assert event.endswith("\n\n")


@pytest.mark.asyncio
async def test_price_events_emits_only_tracked_tickers_with_a_tick():
    cache = PriceCache()
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL", "MSFT"}, positions=set())
    await cache.update(
        PriceTick("AAPL", price=100.0, previous_price=99.0, timestamp=datetime.now(timezone.utc))
    )
    # MSFT is tracked but has no cache entry yet -- must be silently skipped, not KeyError.

    request = _FakeRequest(disconnect_after=1)
    events = [chunk async for chunk in _price_events(request, cache, registry)]

    assert len(events) == 1
    assert "AAPL" in events[0]


@pytest.mark.asyncio
async def test_price_events_stops_when_client_disconnects():
    cache = PriceCache()
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    await cache.update(
        PriceTick("AAPL", price=100.0, previous_price=99.0, timestamp=datetime.now(timezone.utc))
    )

    request = _FakeRequest(disconnect_after=3)
    events = [chunk async for chunk in _price_events(request, cache, registry)]

    assert len(events) == 3


@pytest.mark.asyncio
async def test_price_events_emits_nothing_for_untracked_ticker():
    cache = PriceCache()
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions=set())
    await cache.update(
        PriceTick("AAPL", price=100.0, previous_price=99.0, timestamp=datetime.now(timezone.utc))
    )

    request = _FakeRequest(disconnect_after=1)
    events = [chunk async for chunk in _price_events(request, cache, registry)]

    assert events == []


def test_health_endpoint_ok():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
