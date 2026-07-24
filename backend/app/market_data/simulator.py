from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone

from .base import GetWatchedTickers, PriceTick
from .cache import PriceCache
from .gbm import correlated_z, dt_for_interval, step
from .seed_prices import DEFAULT_SEED, SEED_PRICES, TickerSeed

TICK_INTERVAL_SECONDS = 0.5
EVENT_PROBABILITY = 0.001  # per ticker, per tick
EVENT_MAGNITUDE_RANGE = (0.02, 0.05)  # +/- 2-5% one-off shock
GROUP_CORRELATION = 0.6


class SimulatorProvider:
    def __init__(self, cache: PriceCache, seed: int | None = None) -> None:
        self._cache = cache
        self._rng = random.Random(seed)
        self._prices: dict[str, float] = {}
        self._seeds: dict[str, TickerSeed] = {}
        self._task: asyncio.Task | None = None

    async def start(self, get_watched_tickers: GetWatchedTickers) -> None:
        self._task = asyncio.create_task(self._tick_loop(get_watched_tickers))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def _seed_for(self, ticker: str) -> TickerSeed:
        """Lazily materialize a ticker's running price/params on first sighting —
        matches the 'synthesize defaults on first sight' rule in PLAN.md §6."""
        if ticker not in self._seeds:
            seed = SEED_PRICES.get(ticker, DEFAULT_SEED)
            self._seeds[ticker] = seed
            self._prices[ticker] = seed.price
        return self._seeds[ticker]

    async def _tick_loop(self, get_watched_tickers: GetWatchedTickers) -> None:
        dt = dt_for_interval(TICK_INTERVAL_SECONDS)
        while True:
            tickers = get_watched_tickers()
            group_z: dict[str, float] = {}

            for ticker in tickers:
                seed = self._seed_for(ticker)
                if seed.group not in group_z:
                    group_z[seed.group] = self._rng.gauss(0, 1)
                z = correlated_z(self._rng, group_z[seed.group], GROUP_CORRELATION)

                previous = self._prices[ticker]
                new_price = step(previous, seed.drift, seed.volatility, dt, z)

                if self._rng.random() < EVENT_PROBABILITY:
                    magnitude = self._rng.uniform(*EVENT_MAGNITUDE_RANGE)
                    direction = 1 if self._rng.random() < 0.5 else -1
                    new_price *= 1 + direction * magnitude

                self._prices[ticker] = new_price
                await self._cache.update(
                    PriceTick(
                        ticker=ticker,
                        price=new_price,
                        previous_price=previous,
                        timestamp=datetime.now(timezone.utc),
                    )
                )

            await asyncio.sleep(TICK_INTERVAL_SECONDS)
