# Market Data Backend — Detailed Design

Implementation-ready design for `backend/app/market_data/` and its integration points in the rest of the FastAPI app. This document consolidates and extends `PLAN.md` §6, `MARKET_SIMULATOR.md`, `MASSIVE_API.md`, and `MASSIVE_CLIENT.md` into one buildable spec — full module code, the FastAPI wiring around it (startup/shutdown, SSE route, trade fill, watchlist sync), and the test plan. Where earlier docs left a detail implicit (how the provider's synchronous ticker callback gets fed by an async database, how the SSE loop's cadence relates to the provider's own update cadence), this document makes the decision explicit and shows it in code.

---

## 1. Goals & non-goals

**Goals**
- One `MarketDataProvider` interface, two implementations (simulator, Massive), selected once at startup by `MASSIVE_API_KEY`.
- SSE streaming, trade fills, and the watchlist/portfolio REST endpoints never branch on which provider is active — they only ever touch the shared `PriceCache`.
- The provider's tick loop needs the current "which tickers matter" set on every cycle, without hitting SQLite every 500ms.
- Everything above the pure-math layer (`gbm.py`, `_parse`) is unit-testable without asyncio or a network.

**Non-goals**
- Multi-user fan-out (the schema reserves `user_id` for later; the price cache and tracked-ticker set are process-global today, matching the single-user MVP).
- WebSocket/bidirectional streaming — SSE only, per `PLAN.md` §3.
- Order types beyond instant-fill market orders — no order book, no partial fills.

---

## 2. Full module layout

```
backend/app/market_data/
├── __init__.py
├── base.py                # MarketDataProvider protocol, PriceTick dataclass
├── cache.py                # PriceCache — shared in-memory store
├── tracked_tickers.py       # TrackedTickerRegistry — sync ticker-set view, backed by watchlist+positions
├── seed_prices.py           # per-ticker starting price, drift, volatility, correlation group
├── gbm.py                    # pure math: dt_for_interval(), step(), correlated_z()
├── simulator.py              # SimulatorProvider — in-process GBM tick loop
├── massive_client.py         # MassiveProvider — REST polling against Massive/Polygon
└── factory.py                # get_provider() -> MarketDataProvider, based on env

backend/app/
├── main.py                    # FastAPI app, lifespan startup/shutdown wiring
├── deps.py                    # FastAPI dependency providers (cache, registry, db)
├── db/
│   ├── schema.sql              # CREATE TABLE statements (PLAN.md §7)
│   └── connection.py            # aiosqlite connection + lazy init
└── api/
    ├── stream.py                # GET /api/stream/prices (SSE)
    ├── watchlist.py             # GET/POST /api/watchlist, DELETE /api/watchlist/{ticker}
    └── portfolio.py              # GET /api/portfolio, POST /api/portfolio/trade
```

```
backend/tests/market_data/
├── test_gbm.py                  # pure-math unit tests
├── test_simulator.py             # SimulatorProvider + contract test
├── test_massive_parse.py          # MassiveProvider._parse, no network
├── test_cache.py                  # PriceCache concurrency
├── test_tracked_tickers.py         # registry union/update behavior
└── test_stream_route.py            # SSE integration test (simulator, seeded)
```

---

## 3. Shared data model — `base.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol


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


GetWatchedTickers = Callable[[], set[str]]


class MarketDataProvider(Protocol):
    """Implemented identically by SimulatorProvider and MassiveProvider.
    Nothing outside market_data/ imports a concrete provider class directly —
    only this protocol and the PriceCache it writes into."""

    async def start(self, get_watched_tickers: GetWatchedTickers) -> None:
        ...

    async def stop(self) -> None:
        ...
```

`get_watched_tickers` is **synchronous** and cheap to call every tick (§5) — it is not an async DB query. Both providers call it once per cycle to pick up watchlist/position changes without a restart.

---

## 4. Shared price cache — `cache.py`

```python
import asyncio

from .base import PriceTick


class PriceCache:
    """Single instance, created at app startup, shared by the active
    provider (writer), the SSE route, and the trade endpoint (readers)."""

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

Reads are lock-free — single writer (the provider's tick loop), many readers (SSE connections, trade endpoint), and a dict read is already atomic under the GIL. Only `update()` takes the lock, so it never blocks a reader.

---

## 5. Tracked-ticker registry — `tracked_tickers.py`

**The problem this solves**: `PLAN.md` §6 requires the provider to track the *union of the watchlist and any ticker with an open position*, re-resolved every cycle. But the tick loop runs every 500ms on a plain sync callback (`base.py` §3), while watchlist/positions live in SQLite behind an async driver. Querying the DB from inside the tick loop would mean an async round-trip (and a DB read) twice a second forever, purely to answer a question that only changes when a user acts.

**The fix**: an in-memory `TrackedTickerRegistry` is the single source of truth for "which tickers matter right now." It's loaded from the DB once at startup, then kept in sync by write-through calls from the watchlist and trade routes — the same places that already mutate `watchlist`/`positions` in SQLite. The provider's `get_watched_tickers` callback is just `registry.get`, a synchronous dict/set read.

```python
import threading


class TrackedTickerRegistry:
    """In-memory mirror of `union(watchlist.ticker, positions.ticker WHERE quantity > 0)`.
    Loaded from SQLite at startup; updated write-through by the routes that
    mutate those tables, so the provider never queries the DB itself."""

    def __init__(self) -> None:
        self._watchlist: set[str] = set()
        self._positions: set[str] = set()
        self._lock = threading.Lock()

    def load_initial(self, watchlist: set[str], positions: set[str]) -> None:
        with self._lock:
            self._watchlist = set(watchlist)
            self._positions = set(positions)

    def add_watchlist_ticker(self, ticker: str) -> None:
        with self._lock:
            self._watchlist.add(ticker)

    def remove_watchlist_ticker(self, ticker: str) -> None:
        with self._lock:
            self._watchlist.discard(ticker)

    def set_position_ticker(self, ticker: str, quantity: float) -> None:
        """Call after every trade fill with the position's new quantity."""
        with self._lock:
            if quantity > 0:
                self._positions.add(ticker)
            else:
                self._positions.discard(ticker)

    def get(self) -> set[str]:
        with self._lock:
            return self._watchlist | self._positions
```

`threading.Lock` rather than `asyncio.Lock`: the registry is read from a sync context (the provider's tick loop calls `registry.get` with no `await`), so an asyncio primitive doesn't fit. The critical sections are microseconds of set arithmetic, so a plain lock is not a contention risk under FastAPI's single-process event loop plus background task.

**Startup load** (`main.py`, detailed in §9):

```python
watchlist_rows = await db.execute_fetchall("SELECT ticker FROM watchlist WHERE user_id = ?", ("default",))
position_rows = await db.execute_fetchall("SELECT ticker FROM positions WHERE user_id = ? AND quantity > 0", ("default",))
registry.load_initial(
    watchlist={row[0] for row in watchlist_rows},
    positions={row[0] for row in position_rows},
)
```

**Write-through from routes** — shown in full in §10 (watchlist) and §11 (trade execution).

---

## 6. Seed data — `seed_prices.py`

(As specified in `MARKET_SIMULATOR.md` §3 — reproduced here for completeness since this document is the single implementation reference.)

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class TickerSeed:
    price: float
    drift: float         # annualized, e.g. 0.08 = 8%/year
    volatility: float     # annualized, e.g. 0.30 = 30%/year
    group: str             # correlation group


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

A ticker with no `SEED_PRICES` entry (added via watchlist or LLM at runtime) gets `DEFAULT_SEED` — market-average drift/volatility, `"neutral"` group (no correlated peers) — with no lookup against a real symbol registry.

---

## 7. Pure GBM math — `gbm.py`

```python
import math
import random

TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600  # ~252 trading days, 6.5h sessions


def dt_for_interval(interval_seconds: float) -> float:
    return interval_seconds / TRADING_SECONDS_PER_YEAR


def step(price: float, drift: float, volatility: float, dt: float, z: float) -> float:
    """S(t+dt) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z)"""
    exponent = (drift - 0.5 * volatility ** 2) * dt + volatility * math.sqrt(dt) * z
    return price * math.exp(exponent)


def correlated_z(rng: random.Random, group_z: float, rho: float) -> float:
    """Blend a shared group factor with an idiosyncratic draw so tickers in
    the same correlation group move together. rho=0 -> independent, rho=1 -> lockstep."""
    idiosyncratic = rng.gauss(0, 1)
    return rho * group_z + math.sqrt(1 - rho ** 2) * idiosyncratic
```

Stdlib-only (`math`, `random`) — no `numpy` needed at this tick rate/ticker count, and it keeps this module trivially unit-testable without any async or cache dependency.

---

## 8. Simulator provider — `simulator.py`

```python
import asyncio
import random
from datetime import datetime, timezone

from .base import GetWatchedTickers, MarketDataProvider, PriceTick
from .cache import PriceCache
from .gbm import correlated_z, dt_for_interval, step
from .seed_prices import DEFAULT_SEED, SEED_PRICES, TickerSeed

TICK_INTERVAL_SECONDS = 0.5
EVENT_PROBABILITY = 0.001            # per ticker, per tick
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
                await self._cache.update(PriceTick(
                    ticker=ticker,
                    price=new_price,
                    previous_price=previous,
                    timestamp=datetime.now(timezone.utc),
                ))

            await asyncio.sleep(TICK_INTERVAL_SECONDS)
```

Key points:
- **Group `Z` drawn once per tick, not per ticker** — every `"tech"` ticker that tick shares the same `group_z["tech"]` draw before adding its own idiosyncratic noise. This is what produces correlated moves.
- **State is in-process** (`self._prices`, `self._seeds`) — the simulator is explicitly single-instance, no external dependency, so it doesn't need to survive a restart; a fresh process just reseeds from `SEED_PRICES`.
- **`stop()` awaits the cancelled task** so tests can call `await provider.stop()` and know the loop has actually exited before asserting on cache state, instead of racing a fire-and-forget `.cancel()`.

---

## 9. Massive-backed provider — `massive_client.py`

Wraps the official `massive` SDK (`pip install massive`; reads `MASSIVE_API_KEY` from env automatically per `MASSIVE_API.md` §1).

```python
import asyncio
from datetime import datetime, timezone

from massive import RESTClient

from .base import GetWatchedTickers, MarketDataProvider, PriceTick
from .cache import PriceCache

REAL_TIME_POLL_INTERVAL_SECONDS = 5     # Advanced/Business tier
DELAYED_POLL_INTERVAL_SECONDS = 15       # Basic/Starter/Developer tier


class MassiveProvider:
    def __init__(
        self,
        api_key: str,
        cache: PriceCache,
        poll_interval: float = DELAYED_POLL_INTERVAL_SECONDS,
    ) -> None:
        self._client = RESTClient(api_key=api_key)
        self._cache = cache
        self._poll_interval = poll_interval
        self._task: asyncio.Task | None = None

    async def start(self, get_watched_tickers: GetWatchedTickers) -> None:
        self._task = asyncio.create_task(self._poll_loop(get_watched_tickers))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self, get_watched_tickers: GetWatchedTickers) -> None:
        while True:
            tickers = sorted(get_watched_tickers())
            if tickers:
                try:
                    await self._poll_once(tickers)
                except Exception:
                    # One failed cycle (network blip, 429, transient 5xx) must
                    # never kill the background task -- log and try again next cycle.
                    logging.getLogger(__name__).exception("Massive poll cycle failed")
            await asyncio.sleep(self._poll_interval)

    async def _poll_once(self, tickers: list[str]) -> None:
        # SDK call is sync/blocking -- keep it off the event loop so it
        # doesn't stall SSE delivery or the trade endpoint mid-request.
        snapshot = await asyncio.to_thread(self._client.get_snapshot_all, "stocks", tickers)
        for item in snapshot:
            tick = self._parse(item)
            if tick is not None:
                await self._cache.update(tick)

    def _parse(self, item) -> PriceTick | None:
        """item is one entry from get_snapshot_all's result list (an SDK
        TickerSnapshot object). A bad/delisted ticker is simply absent from
        the response (MASSIVE_API.md §10), never passed here."""
        if item.ticker is None:
            return None

        current = None
        if item.day is not None and item.day.close is not None:
            current = item.day.close
        elif item.last_trade is not None and item.last_trade.price is not None:
            current = item.last_trade.price
        if current is None:
            return None

        # previous_price is the LAST CACHE VALUE, not prevDay.close: prevDay.close
        # is yesterday's close, which would make every poll register as a
        # "change" relative to a stale reference. Cache continuity gives
        # tick-over-tick direction for the frontend's green/red flash; only
        # the very first poll for a ticker falls back to prevDay.close.
        existing = self._cache.get(item.ticker)
        if existing is not None:
            previous = existing.price
        elif item.prev_day is not None and item.prev_day.close is not None:
            previous = item.prev_day.close
        else:
            previous = current

        return PriceTick(
            ticker=item.ticker,
            price=float(current),
            previous_price=float(previous),
            timestamp=datetime.now(timezone.utc),
        )
```

```python
import logging  # placed at top of file in the real module; shown separately here for clarity
```

Design notes (from `MASSIVE_CLIENT.md` §6-7, reproduced with the reasoning inline since it's easy to "fix" incorrectly during implementation):

- **One call per poll cycle regardless of watchlist size** — `get_snapshot_all("stocks", tickers)` (`MASSIVE_API.md` §3) takes the whole ticker list in one request. Never loop the single-ticker snapshot endpoint per ticker.
- **`asyncio.to_thread`** wraps the blocking SDK call — the app is otherwise fully async (FastAPI + SSE), so a synchronous HTTP round-trip on the event loop would stall every other coroutine, including in-flight SSE pushes.
- **Tickers missing from the response** are simply not written to the cache that cycle; the last known price stays in place (stale-but-present), matching how any real feed degrades on a partial outage — never delete or null out a cache entry on a miss.
- **429 / transient errors**: caught by the blanket `except Exception` in `_poll_loop`, logged, and left to the next fixed-interval cycle — the poll interval itself is already the backoff; a second retry timer would just fight with it. A 429 at the configured interval means the interval is misconfigured for the account's tier (`MASSIVE_API.md` §2), which is a config problem to fix, not a runtime condition to special-case.

**Poll interval selection**: the constructor default is the safe Basic/Starter/Developer cadence (15s). If the project later wants to expose tier selection, it's a single environment variable read in `factory.py` (§10) — not required for MVP since every tier is safe at 15s.

---

## 10. Provider selection — `factory.py`

```python
import os

from .base import MarketDataProvider
from .cache import PriceCache


def get_provider(cache: PriceCache) -> MarketDataProvider:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if api_key:
        from .massive_client import MassiveProvider
        return MassiveProvider(api_key=api_key, cache=cache)
    from .simulator import SimulatorProvider
    return SimulatorProvider(cache=cache)
```

Deferred imports keep `massive` an optional dependency at import time — a simulator-only deployment never needs the package installed. Called exactly once, in the FastAPI lifespan handler below; the env var is never re-checked mid-run.

---

## 11. FastAPI wiring — `main.py`

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db.connection import get_db_connection, init_db_if_needed
from .market_data.cache import PriceCache
from .market_data.factory import get_provider
from .market_data.tracked_tickers import TrackedTickerRegistry

DEFAULT_USER_ID = "default"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = await get_db_connection()
    await init_db_if_needed(db)

    cache = PriceCache()
    registry = TrackedTickerRegistry()

    watchlist_rows = await db.execute_fetchall(
        "SELECT ticker FROM watchlist WHERE user_id = ?", (DEFAULT_USER_ID,)
    )
    position_rows = await db.execute_fetchall(
        "SELECT ticker FROM positions WHERE user_id = ? AND quantity > 0", (DEFAULT_USER_ID,)
    )
    registry.load_initial(
        watchlist={row[0] for row in watchlist_rows},
        positions={row[0] for row in position_rows},
    )

    provider = get_provider(cache)
    await provider.start(registry.get)

    app.state.db = db
    app.state.cache = cache
    app.state.registry = registry
    app.state.provider = provider

    yield

    await provider.stop()
    await db.close()


app = FastAPI(lifespan=lifespan)

from .api import portfolio, stream, watchlist  # noqa: E402  (after `app` exists, for router registration)

app.include_router(stream.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
```

`deps.py` exposes the shared instances to route handlers via FastAPI's `Depends`:

```python
from fastapi import Request

from .market_data.cache import PriceCache
from .market_data.tracked_tickers import TrackedTickerRegistry


def get_cache(request: Request) -> PriceCache:
    return request.app.state.cache


def get_registry(request: Request) -> TrackedTickerRegistry:
    return request.app.state.registry


def get_db(request: Request):
    return request.app.state.db
```

---

## 12. SSE streaming route — `api/stream.py`

Per `PLAN.md` §6: `GET /api/stream/prices`, ~500ms cadence, one event per tracked ticker per tick, `event: price` with a JSON payload.

```python
import asyncio
import json

from fastapi import APIRouter, Depends, Request
from starlette.responses import StreamingResponse

from ..deps import get_cache, get_registry
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()

STREAM_INTERVAL_SECONDS = 0.5


def _format_event(tick) -> str:
    payload = {
        "ticker": tick.ticker,
        "price": tick.price,
        "previous_price": tick.previous_price,
        "timestamp": tick.timestamp.isoformat().replace("+00:00", "Z"),
        "direction": tick.direction,
    }
    return f"event: price\ndata: {json.dumps(payload)}\n\n"


async def _price_events(
    request: Request, cache: PriceCache, registry: TrackedTickerRegistry
):
    try:
        while True:
            if await request.is_disconnected():
                break
            tracked = registry.get()
            snapshot = cache.all()
            for ticker in tracked:
                tick = snapshot.get(ticker)
                if tick is not None:
                    yield _format_event(tick)
            await asyncio.sleep(STREAM_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        # Client disconnected mid-sleep/mid-yield -- let the generator exit
        # cleanly rather than propagating into StreamingResponse's teardown.
        return


@router.get("/stream/prices")
async def stream_prices(
    request: Request,
    cache: PriceCache = Depends(get_cache),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    return StreamingResponse(
        _price_events(request, cache, registry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx/proxy response buffering, if fronted by one
        },
    )
```

Design notes:
- **Per-client independent loop**: each connected browser tab gets its own generator instance and its own 500ms `asyncio.sleep` — they all read the same shared `PriceCache`, so this scales fine for the single-user MVP (a handful of tabs) without any pub/sub machinery.
- **Cadence is decoupled from provider refresh rate, deliberately**: the simulator writes to the cache every 500ms (so this loop sees a fresh tick every cycle), but Massive only writes every 5-15s. In between Massive polls, this loop re-emits the *same* `PriceTick` (same price, same `previous_price`, same `direction`) every 500ms. That's intentional and matches `PLAN.md`'s literal wire format ("one event per ticker per tick") — the frontend's flash animation is keyed off an actual price change, so repeated identical values are inert, not a visible glitch, and the client always has a fresh `timestamp` to reason about staleness if it wants to.
- **`request.is_disconnected()`** is checked each cycle so a client that closes the tab doesn't leave the generator (and its per-ticker cache reads) running forever; `EventSource`'s own auto-reconnect on the frontend then opens a fresh stream.
- **Only tracked tickers are ever streamed** — `registry.get()` gives the exact watchlist ∪ open-positions union per `PLAN.md` §6, so a position kept after its ticker leaves the watchlist keeps streaming (and its live P&L keeps working) automatically.

---

## 13. Watchlist route — write-through to the registry

`api/watchlist.py` (add/remove), showing only the registry-sync-relevant parts:

```python
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_db, get_registry
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()

TICKER_PATTERN = re.compile(r"^[A-Z0-9]{1,5}$")
WATCHLIST_CAP = 30
DEFAULT_USER_ID = "default"


@router.post("/watchlist")
async def add_ticker(
    body: dict,
    db=Depends(get_db),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = body["ticker"].strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(400, f"Invalid ticker format: {ticker!r}")

    count_row = await db.execute_fetchall(
        "SELECT COUNT(*) FROM watchlist WHERE user_id = ?", (DEFAULT_USER_ID,)
    )
    if count_row[0][0] >= WATCHLIST_CAP:
        raise HTTPException(400, "Watchlist is full (30 ticker limit)")

    await db.execute(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()

    # Write-through: the simulator/Massive tick loop picks this up on its
    # very next cycle via registry.get(), no restart, no DB poll from the provider.
    registry.add_watchlist_ticker(ticker)

    return {"ticker": ticker}


@router.delete("/watchlist/{ticker}")
async def remove_ticker(
    ticker: str,
    db=Depends(get_db),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = ticker.upper()
    await db.execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (DEFAULT_USER_ID, ticker)
    )
    await db.commit()

    # Only drop it from the registry's watchlist half -- if there's an open
    # position, set_position_ticker already keeps it in the positions half,
    # so the union in registry.get() still includes it (PLAN.md §6).
    registry.remove_watchlist_ticker(ticker)

    return {"ticker": ticker}
```

---

## 14. Trade execution — fill price from the cache, position write-through

`api/portfolio.py`, the part relevant to market data (full trade/portfolio-math validation is out of scope for this document):

```python
from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_cache, get_db, get_registry
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()
DEFAULT_USER_ID = "default"


@router.post("/portfolio/trade")
async def execute_trade(
    body: dict,
    db=Depends(get_db),
    cache: PriceCache = Depends(get_cache),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = body["ticker"].strip().upper()
    side = body["side"]
    quantity = float(body["quantity"])

    tick = cache.get(ticker)
    if tick is None:
        raise HTTPException(400, f"No price available for {ticker!r} yet")
    fill_price = tick.price  # same value the SSE stream just pushed -- no separate trade-price source

    # ... cash/shares validation, position + trade-row writes, cash update ...
    new_quantity = ...  # computed from existing position +/- `quantity`

    # Write-through: a fresh buy (0 -> >0) must start streaming even if the
    # ticker was never on the watchlist; a full sell-out (>0 -> 0) of a ticker
    # already off the watchlist must stop streaming.
    registry.set_position_ticker(ticker, new_quantity)

    return {"ticker": ticker, "fill_price": fill_price, "quantity": quantity, "side": side}
```

This is what makes the fill price and the last SSE-pushed price provably identical: both read `cache.get(ticker).price` off the exact same `PriceCache` instance, so there is no window where a trade could fill at a value the client never saw streamed.

---

## 15. Configuration

Environment variables consumed by the market data layer (superset of `PLAN.md` §5, with defaults/behavior spelled out):

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `MASSIVE_API_KEY` | `factory.get_provider` | unset | Set + non-empty → `MassiveProvider`. Unset/empty → `SimulatorProvider`. Checked once at startup, never per-request. |

No other market-data-specific env vars are required for MVP — tick interval, poll interval, correlation, and event probability are code constants (`TICK_INTERVAL_SECONDS`, `DELAYED_POLL_INTERVAL_SECONDS`, `GROUP_CORRELATION`, `EVENT_PROBABILITY`), which keeps the two providers' tuning knobs in one reviewable place rather than scattered across `.env.example`. If tier-based Massive poll interval selection becomes a real need, add `MASSIVE_POLL_INTERVAL_SECONDS` and read it in `factory.py` alongside the key — not before it's needed.

---

## 16. Error handling & resilience summary

| Failure | Where handled | Behavior |
|---|---|---|
| Unknown/delisted ticker (simulator) | `simulator._seed_for` | Synthesized via `DEFAULT_SEED`, never rejected |
| Unknown/delisted ticker (Massive) | `massive_client._parse` / `_poll_once` | Simply absent from response; cache entry (if any) left stale, not deleted |
| Massive network/HTTP error, 429 | `massive_client._poll_loop` | Caught, logged, next cycle proceeds on schedule; no extra retry/backoff timer |
| Client disconnects mid-SSE-stream | `stream._price_events` | `request.is_disconnected()` check ends the generator; `EventSource` auto-reconnects client-side |
| Trade attempted before any price tick exists for a ticker | `portfolio.execute_trade` | `cache.get()` returns `None` → `400` with a clear message, no fill |
| Provider task raises unexpectedly | N/A by design | `simulator`'s loop has no fallible I/O to guard; `massive_client`'s loop wraps the one fallible call (`_poll_once`) in `try/except Exception` so the outer `while True` never dies |

---

## 17. Testing plan

Mirrors `PLAN.md` §12 ("Market data: simulator generates valid prices, GBM math is correct, Massive API response parsing works, both implementations conform to the abstract interface"), made concrete:

### 17.1 Pure math — `test_gbm.py`

```python
import math
import random

from app.market_data.gbm import correlated_z, dt_for_interval, step


def test_step_zero_z_grows_at_drift_minus_half_variance():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=0.0)
    expected = 100.0 * math.exp((0.10 - 0.5 * 0.30 ** 2) * dt)
    assert math.isclose(price, expected, rel_tol=1e-9)


def test_step_never_produces_negative_or_nan_price():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=-8.0)  # extreme down-shock
    assert price > 0
    assert not math.isnan(price)


def test_correlated_z_rho_one_matches_group_exactly():
    rng = random.Random(0)
    assert correlated_z(rng, group_z=1.5, rho=1.0) == 1.5


def test_correlated_z_rho_zero_ignores_group():
    rng = random.Random(0)
    idiosyncratic_only = rng.gauss(0, 1)
    rng2 = random.Random(0)
    assert correlated_z(rng2, group_z=999.0, rho=0.0) == idiosyncratic_only
```

### 17.2 Simulator — `test_simulator.py`

```python
import asyncio

import pytest

from app.market_data.cache import PriceCache
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
async def test_same_group_tickers_correlate_more_than_cross_group(monkeypatch):
    # Statistical property test: run many ticks, assert same-group log-returns
    # are more correlated than tech-vs-financial, catching a mis-wired rho
    # or group_z reuse bug that a single fixed-seed test could miss.
    ...
```

### 17.3 Massive parsing — `test_massive_parse.py`

```python
from types import SimpleNamespace

from app.market_data.cache import PriceCache
from app.market_data.massive_client import MassiveProvider


def make_snapshot_item(ticker, day_close, prev_close, last_trade_price=None):
    return SimpleNamespace(
        ticker=ticker,
        day=SimpleNamespace(close=day_close),
        prev_day=SimpleNamespace(close=prev_close),
        last_trade=SimpleNamespace(price=last_trade_price),
    )


def test_first_poll_falls_back_to_prev_day_close():
    provider = MassiveProvider(api_key="test", cache=PriceCache())
    item = make_snapshot_item("AAPL", day_close=191.0, prev_close=189.5)
    tick = provider._parse(item)
    assert tick.price == 191.0
    assert tick.previous_price == 189.5  # no cache entry yet -> prevDay.close


def test_subsequent_poll_uses_cache_not_prev_day_close():
    cache = PriceCache()
    provider = MassiveProvider(api_key="test", cache=cache)
    import asyncio
    from app.market_data.base import PriceTick
    from datetime import datetime, timezone
    asyncio.run(cache.update(PriceTick("AAPL", price=190.0, previous_price=189.0,
                                        timestamp=datetime.now(timezone.utc))))

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
```

`_poll_once` itself is tested by monkey-patching `client.get_snapshot_all` to return a canned list and asserting on `cache.all()` afterward — no network involved.

### 17.4 Contract test — both providers satisfy the same protocol

```python
import asyncio

import pytest

from app.market_data.cache import PriceCache
from app.market_data.simulator import SimulatorProvider

# MassiveProvider variant uses a monkeypatched RESTClient; omitted here for brevity,
# but registered against the same parametrized test function.

@pytest.mark.asyncio
@pytest.mark.parametrize("make_provider", [
    lambda cache: SimulatorProvider(cache, seed=7),
    # lambda cache: build_fake_massive_provider(cache),
])
async def test_provider_writes_ticks_for_all_watched_tickers(make_provider):
    cache = PriceCache()
    provider = make_provider(cache)
    await provider.start(lambda: {"AAPL", "MSFT"})
    await asyncio.sleep(1.0)
    await provider.stop()
    assert cache.get("AAPL") is not None
    assert cache.get("MSFT") is not None
```

### 17.5 Tracked-ticker registry — `test_tracked_tickers.py`

```python
from app.market_data.tracked_tickers import TrackedTickerRegistry


def test_union_of_watchlist_and_positions():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions={"TSLA"})
    assert registry.get() == {"AAPL", "TSLA"}


def test_removing_from_watchlist_keeps_open_position():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist={"AAPL"}, positions=set())
    registry.set_position_ticker("AAPL", quantity=5.0)
    registry.remove_watchlist_ticker("AAPL")
    assert registry.get() == {"AAPL"}  # still tracked via the open position


def test_full_sellout_stops_tracking_ticker_not_on_watchlist():
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions={"TSLA"})
    registry.set_position_ticker("TSLA", quantity=0.0)
    assert registry.get() == set()
```

### 17.6 SSE integration — `test_stream_route.py`

```python
import httpx
import pytest

from app.main import app


@pytest.mark.asyncio
async def test_stream_emits_price_events_for_seeded_watchlist():
    async with httpx.AsyncClient(app=app, base_url="http://test") as client:
        async with client.stream("GET", "/api/stream/prices") as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            lines = []
            async for line in response.aiter_lines():
                lines.append(line)
                if len(lines) > 4:
                    break
            assert any(line == "event: price" for line in lines)
```

Full E2E (browser-level `EventSource`, reconnection-on-disconnect) is covered in Playwright per `PLAN.md` §12, run against the simulator (`LLM_MOCK=true`, no `MASSIVE_API_KEY`) so CI never depends on the live Massive API.

---

## 18. End-to-end request flow (reference)

```
┌──────────────┐   POST /api/watchlist {"ticker":"PYPL"}
│   Frontend    │ ─────────────────────────────────────────┐
└──────────────┘                                            ▼
                                                    ┌───────────────────┐
                                                    │ watchlist route     │
                                                    │ - INSERT into DB     │
                                                    │ - registry.add_...() │
                                                    └───────────────────┘
                                                              │
                          next tick (<=500ms later)           ▼
                                                    ┌───────────────────┐
                                                    │ provider tick loop  │
                                                    │ registry.get()       │──┐
                                                    │ includes "PYPL"       │  │ lazily seeds PYPL
                                                    └───────────────────┘  │ (simulator) or
                                                              │             │ includes it in next
                                                              ▼             │ Massive batch call
                                                    ┌───────────────────┐  │
                                                    │   PriceCache        │◄─┘
                                                    │   .update(tick)       │
                                                    └───────────────────┘
                                                              │
                             every 500ms, per client           ▼
┌──────────────┐   event: price  data:{"ticker":"PYPL",...}
│   Frontend    │ ◄─────────────────────────────────────────┘
│  (EventSource)│
└──────────────┘
```

A `POST /api/portfolio/trade {"ticker":"PYPL","side":"buy","quantity":3}` sent any time after the first tick reads `cache.get("PYPL").price` for its fill — the exact value the SSE stream last pushed to every connected client.
