# Market Data Client Design

How the backend abstracts real market data (Massive API) and simulated data (`MARKET_SIMULATOR.md`) behind one interface, per `PLAN.md` §6 ("Two Implementations, One Interface"). Read `MASSIVE_API.md` first for the underlying endpoints this wraps.

## 1. Goal

SSE streaming, the price cache, trade fills, and the frontend must not know or care whether prices come from the simulator or from Massive. Source selection is a single environment-variable check at startup (`MASSIVE_API_KEY` set → Massive; unset → simulator), done once, never re-checked per-request.

## 2. Module layout

```
backend/app/market_data/
├── __init__.py
├── base.py            # MarketDataProvider protocol, PriceTick dataclass
├── cache.py            # PriceCache — shared in-memory store, read by SSE + trade execution
├── massive_client.py    # Massive-backed provider
├── simulator.py        # GBM-backed provider (see MARKET_SIMULATOR.md)
└── factory.py          # get_provider() -> MarketDataProvider, based on env
```

## 3. Shared data model (`base.py`)

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

@dataclass(frozen=True)
class PriceTick:
    ticker: str
    price: float
    previous_price: float
    timestamp: datetime

    @property
    def direction(self) -> str:
        if self.price > self.previous_price:
            return "up"
        if self.price < self.previous_price:
            return "down"
        return "flat"


class MarketDataProvider(Protocol):
    async def start(self, get_watched_tickers: "Callable[[], set[str]]") -> None:
        """Begin the background update loop. `get_watched_tickers` is called each
        cycle so newly added/removed tickers are picked up without a restart."""
        ...

    async def stop(self) -> None:
        """Cancel the background loop cleanly (used in tests and shutdown)."""
        ...
```

`get_watched_tickers` is a callback rather than a fixed set because the watchlist changes at runtime (manual add/remove, LLM-driven changes) and positions can keep a ticker "live" after it leaves the watchlist (`PLAN.md` §6, SSE Streaming). Both implementations re-resolve the ticker set every cycle instead of being reconstructed on every watchlist edit.

Both providers write into the same `PriceCache` (§4) rather than returning values directly — this is what lets SSE streaming and trade execution stay source-agnostic; they only ever talk to the cache, never to a provider.

## 4. Shared price cache (`cache.py`)

```python
import asyncio

class PriceCache:
    def __init__(self) -> None:
        self._prices: dict[str, PriceTick] = {}
        self._lock = asyncio.Lock()

    async def update(self, tick: PriceTick) -> None:
        async with self._lock:
            self._prices[tick.ticker] = tick

    def get(self, ticker: str) -> PriceTick | None:
        return self._prices.get(ticker)

    def all(self) -> dict[str, PriceTick]:
        return dict(self._prices)
```

One `PriceCache` instance is created at app startup and injected into whichever provider is selected, and separately handed to the SSE route and the trade endpoint. Reads are lock-free (dict access is atomic enough for our single-writer-many-readers case); only writes take the lock.

## 5. Provider selection (`factory.py`)

```python
import os

def get_provider(cache: PriceCache) -> MarketDataProvider:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if api_key:
        from .massive_client import MassiveProvider
        return MassiveProvider(api_key=api_key, cache=cache)
    from .simulator import SimulatorProvider
    return SimulatorProvider(cache=cache)
```

Called once in the FastAPI app's startup event. The chosen provider's `start()` is launched as an `asyncio` background task; `stop()` is called on shutdown.

## 6. Massive-backed provider (`massive_client.py`)

Wraps the official `massive` SDK (`pip install massive`, see `MASSIVE_API.md` §1).

```python
import asyncio
from massive import RESTClient
from .base import MarketDataProvider, PriceTick
from .cache import PriceCache

REAL_TIME_POLL_INTERVAL_SECONDS = 5   # Advanced/Business tier
DELAYED_POLL_INTERVAL_SECONDS = 15    # Basic/Starter/Developer tier

class MassiveProvider:
    def __init__(self, api_key: str, cache: PriceCache, poll_interval: float = DELAYED_POLL_INTERVAL_SECONDS):
        self._client = RESTClient(api_key=api_key)
        self._cache = cache
        self._poll_interval = poll_interval
        self._task: asyncio.Task | None = None

    async def start(self, get_watched_tickers) -> None:
        self._task = asyncio.create_task(self._poll_loop(get_watched_tickers))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _poll_loop(self, get_watched_tickers) -> None:
        while True:
            tickers = sorted(get_watched_tickers())
            if tickers:
                await self._poll_once(tickers)
            await asyncio.sleep(self._poll_interval)

    async def _poll_once(self, tickers: list[str]) -> None:
        # SDK call is sync; keep it off the event loop.
        snapshot = await asyncio.to_thread(
            self._client.get_snapshot_all, "stocks", tickers
        )
        for item in snapshot:
            tick = self._parse(item)
            if tick is not None:
                await self._cache.update(tick)

    def _parse(self, item) -> "PriceTick | None":
        if item.ticker is None or item.day is None:
            return None
        current = item.day.close or item.last_trade.price
        previous = item.prev_day.close if item.prev_day else current
        if current is None:
            return None
        existing = self._cache.get(item.ticker)
        prev_for_direction = existing.price if existing else (previous or current)
        return PriceTick(
            ticker=item.ticker,
            price=float(current),
            previous_price=float(prev_for_direction),
            timestamp=datetime.now(timezone.utc),
        )
```

Design notes:

- **One call per poll cycle regardless of watchlist size**, per `PLAN.md` §6 — this is the entire reason to prefer `get_snapshot_all("stocks", tickers)` (`MASSIVE_API.md` §3) over per-ticker calls.
- **`previous_price` is the last cache value, not `prevDay.close`.** `prevDay.close` is yesterday's close, which would make every single poll register as a "change" relative to a stale reference. Using the cache's existing entry gives tick-over-tick direction (for the green/red flash), falling back to `prevDay.close` only on the very first poll for a ticker.
- **Sync SDK, async app**: `RESTClient` methods are blocking, so calls are wrapped in `asyncio.to_thread` to avoid stalling the event loop (and therefore the SSE stream) during the HTTP round-trip.
- **Tickers dropped from the response** (unknown symbol, `MASSIVE_API.md` §10) are simply not written to the cache that cycle — the last known price stays in place rather than disappearing, same failure mode as a stale quote from any real feed.
- **Poll interval** is chosen from account tier at startup (constructor default assumes Basic/Starter/Developer's 15s-safe delayed cadence); an environment variable could override it later if the project wants to expose tier selection, but is not required for the MVP.

## 7. Error handling & resilience

- Network/HTTP errors from `_poll_once` are caught and logged inside `_poll_loop`, not allowed to kill the background task — one failed cycle should not stop future polling.
- No retry-with-backoff beyond "try again next cycle": the fixed poll interval already acts as natural backoff, and adding a second retry timer would fight with it for no benefit at this scale.
- Rate-limit errors (HTTP 429) are treated the same as any other cycle failure — the fixed interval should already stay under the Basic-tier 5-calls/minute ceiling if configured per `MASSIVE_API.md` §2, so a 429 signals misconfiguration and is worth a log line, not special-cased handling.

## 8. Testing

- `MassiveProvider._parse` is pure and unit-testable with hand-built SDK-model instances, no network.
- `_poll_once` is tested with the SDK's `get_snapshot_all` monkey-patched to return canned data, verifying cache contents afterward.
- Full end-to-end tests against the live Massive API are out of scope for CI (see `PLAN.md` §12 — E2E tests run with `LLM_MOCK=true` and no `MASSIVE_API_KEY`, so they exercise the simulator path).
