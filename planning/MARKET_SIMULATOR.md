# Market Simulator Design

Default market data source (no `MASSIVE_API_KEY` required, see `PLAN.md` §5-6). Implements the same `MarketDataProvider` protocol defined in `MASSIVE_CLIENT.md` §3, so SSE streaming, the price cache, and trade execution work identically regardless of which provider is active.

## 1. Model: correlated geometric Brownian motion

Each ticker's price follows GBM:

```
S(t+dt) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z)
```

- `mu` — annualized drift (expected return)
- `sigma` — annualized volatility
- `dt` — time step as a fraction of a trading year, derived from the ~500ms tick interval
- `Z` — standard normal random draw

**Correlation across tickers** (`PLAN.md` §6: "tech stocks move together") is produced by splitting `Z` into a shared group factor and an idiosyncratic residual:

```
Z_ticker = rho * Z_group + sqrt(1 - rho^2) * Z_idiosyncratic
```

`Z_group` is drawn once per correlation group per tick and shared by every ticker in that group; `Z_idiosyncratic` is drawn independently per ticker. `rho` (e.g. 0.6) controls how tightly a group moves together — 0 is fully independent, 1 is lockstep.

## 2. Module layout

```
backend/app/market_data/
├── simulator.py         # SimulatorProvider — the background tick loop
├── seed_prices.py       # per-ticker starting price, drift, volatility, group
└── gbm.py               # pure math: step(), next_price()
```

## 3. Seed data (`seed_prices.py`)

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class TickerSeed:
    price: float
    drift: float        # annualized, e.g. 0.08 = 8%/year
    volatility: float    # annualized, e.g. 0.30 = 30%/year
    group: str           # correlation group

SEED_PRICES: dict[str, TickerSeed] = {
    "AAPL":  TickerSeed(price=190.00, drift=0.10, volatility=0.28, group="tech"),
    "GOOGL": TickerSeed(price=175.00, drift=0.09, volatility=0.30, group="tech"),
    "MSFT":  TickerSeed(price=420.00, drift=0.11, volatility=0.26, group="tech"),
    "AMZN":  TickerSeed(price=185.00, drift=0.12, volatility=0.34, group="tech"),
    "TSLA":  TickerSeed(price=250.00, drift=0.05, volatility=0.55, group="ev"),
    "NVDA":  TickerSeed(price=125.00, drift=0.20, volatility=0.45, group="tech"),
    "META":  TickerSeed(price=505.00, drift=0.10, volatility=0.32, group="tech"),
    "JPM":   TickerSeed(price=200.00, drift=0.07, volatility=0.22, group="financial"),
    "V":     TickerSeed(price=280.00, drift=0.08, volatility=0.20, group="financial"),
    "NFLX":  TickerSeed(price=650.00, drift=0.09, volatility=0.35, group="media"),
}

DEFAULT_SEED = TickerSeed(price=100.00, drift=0.08, volatility=0.25, group="neutral")
```

`DEFAULT_SEED` backs the "tickers outside the seeded list" rule from `PLAN.md` §6 — a ticker with no `SEED_PRICES` entry (added via watchlist or LLM) is synthesized with market-average drift/volatility and dropped into a `"neutral"` group that has no correlated peers, rather than validated against any real symbol registry.

## 4. Pure math (`gbm.py`)

```python
import math
import random

TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600  # ~252 trading days, 6.5h sessions

def dt_for_interval(interval_seconds: float) -> float:
    return interval_seconds / TRADING_SECONDS_PER_YEAR

def step(price: float, drift: float, volatility: float, dt: float, z: float) -> float:
    exponent = (drift - 0.5 * volatility**2) * dt + volatility * math.sqrt(dt) * z
    return price * math.exp(exponent)

def correlated_z(rng: random.Random, group_z: float, rho: float) -> float:
    idiosyncratic = rng.gauss(0, 1)
    return rho * group_z + math.sqrt(1 - rho**2) * idiosyncratic
```

Kept dependency-free (stdlib `math`/`random` only — no `numpy` needed at this scale) and fully unit-testable without touching asyncio or the cache.

## 5. Random events

On top of GBM, each tick has a small independent chance (e.g. 0.1% per ticker per tick, tunable) of an extra one-off jump of ±2-5%, applied as a multiplicative shock after the GBM step — "occasional random events... for drama" (`PLAN.md` §6). Implemented as a separate coin-flip in the tick loop rather than folded into `sigma`, so it stays a rare, visible spike rather than raising the baseline noise floor.

## 6. Background loop (`simulator.py`)

```python
import asyncio
import random
from datetime import datetime, timezone

from .base import MarketDataProvider, PriceTick
from .cache import PriceCache
from .seed_prices import SEED_PRICES, DEFAULT_SEED
from .gbm import dt_for_interval, step, correlated_z

TICK_INTERVAL_SECONDS = 0.5
EVENT_PROBABILITY = 0.001
EVENT_MAGNITUDE_RANGE = (0.02, 0.05)
GROUP_CORRELATION = 0.6

class SimulatorProvider:
    def __init__(self, cache: PriceCache, seed: int | None = None):
        self._cache = cache
        self._rng = random.Random(seed)
        self._prices: dict[str, float] = {}
        self._seeds: dict[str, "TickerSeed"] = {}
        self._task: asyncio.Task | None = None

    async def start(self, get_watched_tickers) -> None:
        self._task = asyncio.create_task(self._tick_loop(get_watched_tickers))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def _seed_for(self, ticker: str):
        if ticker not in self._seeds:
            self._seeds[ticker] = SEED_PRICES.get(ticker, DEFAULT_SEED)
            self._prices[ticker] = self._seeds[ticker].price
        return self._seeds[ticker]

    async def _tick_loop(self, get_watched_tickers) -> None:
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
                await self._cache.update(PriceTick(
                    ticker=ticker,
                    price=new_price,
                    previous_price=previous,
                    timestamp=datetime.now(timezone.utc),
                ))
            await asyncio.sleep(TICK_INTERVAL_SECONDS)
```

Notes:

- **Lazy seeding**: a ticker's running price and seed parameters are only materialized the first time it appears in `get_watched_tickers()`, matching the "synthesize defaults on first sight" behavior from `PLAN.md` §6 without needing an upfront pass over every possible ticker.
- **Group Z drawn once per tick, not per ticker**: this is what makes tickers in the same group move together — every `"tech"` ticker that tick shares the same `group_z["tech"]` draw before adding its own idiosyncratic noise.
- **State lives in-process** (`self._prices`, `self._seeds`) — acceptable since the simulator is explicitly single-instance/in-process (`PLAN.md` §6: "no external dependencies"); it does not need to survive a restart, since a fresh run just reseeds from `SEED_PRICES`.

## 7. Determinism & testing

- `SimulatorProvider(cache, seed=42)` makes an entire run reproducible — pass a fixed seed in tests to assert exact price sequences.
- `gbm.step` and `gbm.correlated_z` are pure functions, tested directly with hand-picked `z` values (no RNG, no asyncio) to verify the GBM formula and correlation blending are implemented correctly.
- A test using a large tick count can assert the *statistical* properties (sample mean/variance of log-returns converge to `drift`/`volatility`) without asserting exact values, to catch parameter-wiring bugs (e.g. drift and volatility swapped) that a single fixed-seed test could miss.
- Per `PLAN.md` §12, unit tests cover: GBM math correctness, valid price generation (no negative/NaN prices), and conformance to the same `MarketDataProvider` protocol the Massive-backed provider implements (a shared contract test run against both providers).
