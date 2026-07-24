import asyncio
from unittest.mock import MagicMock

import pytest

from app.market_data.cache import PriceCache
from app.market_data.massive_client import MassiveProvider
from app.market_data.simulator import SimulatorProvider


def _fake_massive_provider(cache: PriceCache) -> MassiveProvider:
    provider = MassiveProvider(api_key="test", cache=cache, poll_interval=0.05)

    def fake_get_snapshot_all(market_type, tickers):
        from types import SimpleNamespace

        return [
            SimpleNamespace(
                ticker=t,
                day=SimpleNamespace(close=100.0),
                prev_day=SimpleNamespace(close=99.0),
                last_trade=None,
            )
            for t in tickers
        ]

    provider._client = MagicMock(get_snapshot_all=fake_get_snapshot_all)
    return provider


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "make_provider",
    [
        lambda cache: SimulatorProvider(cache, seed=7),
        _fake_massive_provider,
    ],
    ids=["simulator", "massive"],
)
async def test_provider_writes_ticks_for_all_watched_tickers(make_provider):
    cache = PriceCache()
    provider = make_provider(cache)
    await provider.start(lambda: {"AAPL", "MSFT"})
    await asyncio.sleep(1.0)
    await provider.stop()
    assert cache.get("AAPL") is not None
    assert cache.get("MSFT") is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "make_provider",
    [
        lambda cache: SimulatorProvider(cache, seed=8),
        _fake_massive_provider,
    ],
    ids=["simulator", "massive"],
)
async def test_provider_stop_is_idempotent_and_clean(make_provider):
    cache = PriceCache()
    provider = make_provider(cache)
    await provider.start(lambda: {"AAPL"})
    await asyncio.sleep(0.2)
    await provider.stop()
    await provider.stop()  # calling stop twice must not raise
