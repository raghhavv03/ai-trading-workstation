import asyncio
import math

import pytest

from app.market_data.cache import PriceCache
from app.market_data.seed_prices import DEFAULT_SEED, SEED_PRICES
from app.market_data.simulator import SimulatorProvider


@pytest.mark.asyncio
async def test_seeded_run_is_reproducible():
    cache_a, cache_b = PriceCache(), PriceCache()
    provider_a = SimulatorProvider(cache_a, seed=42)
    provider_b = SimulatorProvider(cache_b, seed=42)

    await provider_a.start(lambda: {"AAPL", "TSLA"})
    await provider_b.start(lambda: {"AAPL", "TSLA"})
    await asyncio.sleep(1.1)  # a couple of ticks at 500ms
    await provider_a.stop()
    await provider_b.stop()

    assert cache_a.get("AAPL").price == cache_b.get("AAPL").price
    assert cache_a.get("TSLA").price == cache_b.get("TSLA").price


@pytest.mark.asyncio
async def test_unseeded_ticker_gets_default_seed_price_as_start():
    cache = PriceCache()
    provider = SimulatorProvider(cache, seed=1)
    await provider.start(lambda: {"ZZZZ"})  # not in SEED_PRICES
    await asyncio.sleep(0.6)
    await provider.stop()
    tick = cache.get("ZZZZ")
    assert tick is not None
    assert tick.price > 0


@pytest.mark.asyncio
async def test_seeded_ticker_starts_near_its_seed_price():
    cache = PriceCache()
    provider = SimulatorProvider(cache, seed=2)
    await provider.start(lambda: {"AAPL"})
    await asyncio.sleep(0.6)  # exactly one tick
    await provider.stop()
    tick = cache.get("AAPL")
    # One 500ms GBM step shouldn't move price by an order of magnitude.
    assert math.isclose(tick.price, SEED_PRICES["AAPL"].price, rel_tol=0.05)


@pytest.mark.asyncio
async def test_stop_before_start_does_not_raise():
    cache = PriceCache()
    provider = SimulatorProvider(cache, seed=3)
    await provider.stop()  # no task ever started


@pytest.mark.asyncio
async def test_stop_actually_halts_the_tick_loop():
    cache = PriceCache()
    provider = SimulatorProvider(cache, seed=4)
    await provider.start(lambda: {"AAPL"})
    await asyncio.sleep(0.6)
    await provider.stop()
    price_at_stop = cache.get("AAPL").price
    await asyncio.sleep(0.6)
    assert cache.get("AAPL").price == price_at_stop


@pytest.mark.asyncio
async def test_new_ticker_added_mid_run_is_picked_up_next_cycle():
    cache = PriceCache()
    tracked = {"AAPL"}
    provider = SimulatorProvider(cache, seed=5)
    await provider.start(lambda: tracked)
    await asyncio.sleep(0.6)
    assert cache.get("MSFT") is None
    tracked.add("MSFT")
    await asyncio.sleep(0.6)
    await provider.stop()
    assert cache.get("MSFT") is not None


@pytest.mark.asyncio
async def test_previous_price_reflects_prior_tick_not_seed_every_time():
    cache = PriceCache()
    provider = SimulatorProvider(cache, seed=6)
    await provider.start(lambda: {"AAPL"})
    await asyncio.sleep(1.1)  # at least two ticks
    await provider.stop()
    tick = cache.get("AAPL")
    assert tick.previous_price != SEED_PRICES["AAPL"].price or tick.price == SEED_PRICES["AAPL"].price


def test_same_group_tickers_correlate_more_than_cross_group():
    # Statistical property test, run against the tick math directly (no asyncio,
    # no cache) so it's fast and exercises many ticks: same-group tickers' log
    # returns should correlate more strongly with each other than with a
    # different-group ticker. Catches a mis-wired rho or group_z reuse bug that
    # a single fixed-seed price-equality test could miss.
    import random
    import statistics

    from app.market_data.gbm import correlated_z, dt_for_interval, step
    from app.market_data.simulator import GROUP_CORRELATION
    from app.market_data.seed_prices import SEED_PRICES

    rng = random.Random(99)
    dt = dt_for_interval(0.5)
    tickers = ["AAPL", "MSFT", "GOOGL", "JPM"]  # first 3 "tech", JPM "financial"
    prices = {t: SEED_PRICES[t].price for t in tickers}
    returns: dict[str, list[float]] = {t: [] for t in tickers}

    for _ in range(500):
        group_z: dict[str, float] = {}
        for ticker in tickers:
            seed = SEED_PRICES[ticker]
            if seed.group not in group_z:
                group_z[seed.group] = rng.gauss(0, 1)
            z = correlated_z(rng, group_z[seed.group], GROUP_CORRELATION)
            previous = prices[ticker]
            new_price = step(previous, seed.drift, seed.volatility, dt, z)
            returns[ticker].append(math.log(new_price / previous))
            prices[ticker] = new_price

    def corr(a: list[float], b: list[float]) -> float:
        return statistics.correlation(a, b)

    same_group_corr = corr(returns["AAPL"], returns["MSFT"])
    cross_group_corr = corr(returns["AAPL"], returns["JPM"])
    assert same_group_corr > cross_group_corr
