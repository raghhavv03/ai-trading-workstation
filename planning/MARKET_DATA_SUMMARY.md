# Market Data — Summary

Consolidates `MARKET_DATA_DESIGN.md`, `MARKET_SIMULATOR.md`, `MASSIVE_API.md`, `MASSIVE_CLIENT.md`, `MARKET_DATA_REVIEW.md` (now removed) into one reference. Implements `PLAN.md` §5-8, §12.

## Status

**Implemented and shipped** (commit `9013b58` + follow-up). 68 tests passing, `ruff check .` clean. Verified end-to-end against a live `uvicorn` server. Out of scope for this slice (separate future work): chat/LLM integration, `/api/system/reset`, `/api/portfolio/history`, frontend.

## 1. Architecture

One `MarketDataProvider` protocol, two implementations (`SimulatorProvider`, `MassiveProvider`), selected once at startup by `MASSIVE_API_KEY` (`factory.get_provider`). SSE streaming, trade fills, and watchlist/portfolio routes never branch on which provider is active — they only touch the shared `PriceCache`.

```
backend/app/market_data/
├── base.py             # MarketDataProvider protocol, PriceTick dataclass
├── cache.py             # PriceCache — shared in-memory store
├── tracked_tickers.py    # TrackedTickerRegistry — sync ticker-set view
├── seed_prices.py        # per-ticker starting price, drift, volatility, group
├── gbm.py                 # pure math: dt_for_interval(), step(), correlated_z()
├── simulator.py           # SimulatorProvider — in-process GBM tick loop
├── massive_client.py      # MassiveProvider — REST polling
└── factory.py             # get_provider() -> MarketDataProvider

backend/app/
├── main.py                # lifespan startup/shutdown wiring
├── deps.py                # FastAPI Depends providers (cache, registry, db)
├── db/{schema.sql, connection.py}
└── api/{stream.py, watchlist.py, portfolio.py}
```

### `base.py`

```python
@dataclass(frozen=True)
class PriceTick:
    ticker: str
    price: float
    previous_price: float
    timestamp: datetime

    @property
    def direction(self) -> str:  # "up" | "down" | "flat"
        ...

GetWatchedTickers = Callable[[], set[str]]  # sync, cheap, called every tick

class MarketDataProvider(Protocol):
    async def start(self, get_watched_tickers: GetWatchedTickers) -> None: ...
    async def stop(self) -> None: ...
```

### `PriceCache` (`cache.py`)

Single instance, created at startup, shared by the provider (writer) and SSE route + trade endpoint (readers). `asyncio.Lock` on `update()` only — reads (`get`, `all`) are lock-free since dict reads are atomic under the GIL and there's a single writer.

### `TrackedTickerRegistry` (`tracked_tickers.py`)

**Problem**: the provider must track `union(watchlist, open positions)`, re-resolved every 500ms tick — but that data lives in SQLite behind an async driver, and the tick loop is sync. Querying the DB twice a second just to answer a question that only changes on user action is wasteful.

**Fix**: in-memory registry, loaded from SQLite once at startup, then kept in sync by write-through calls from the watchlist and trade routes (the same places that already mutate `watchlist`/`positions`). The provider's `get_watched_tickers` callback is just `registry.get`. Uses `threading.Lock` (not `asyncio.Lock`) since it's read from a sync context.

```python
class TrackedTickerRegistry:
    def load_initial(self, watchlist: set[str], positions: set[str]) -> None: ...
    def add_watchlist_ticker(self, ticker: str) -> None: ...
    def remove_watchlist_ticker(self, ticker: str) -> None: ...
    def set_position_ticker(self, ticker: str, quantity: float) -> None:  # call after every trade fill
        ...
    def get(self) -> set[str]: ...  # watchlist | positions
```

## 2. Simulator (default, no `MASSIVE_API_KEY`)

Correlated geometric Brownian motion:

```
S(t+dt) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z)
```

- `mu` = annualized drift, `sigma` = annualized volatility, `dt` derived from the 500ms tick interval, `Z` = standard normal draw.
- **Correlation**: `Z_ticker = rho * Z_group + sqrt(1 - rho^2) * Z_idiosyncratic`. `Z_group` drawn once per correlation group per tick (not per ticker) — this is what makes every `"tech"` ticker move together that tick. `rho = 0.6` (`GROUP_CORRELATION`).
- **Random events**: 0.1% chance per ticker per tick (`EVENT_PROBABILITY`) of an extra ±2-5% shock (`EVENT_MAGNITUDE_RANGE`), applied multiplicatively after the GBM step — kept separate from `sigma` so it stays a rare visible spike, not a raised noise floor.
- **Lazy seeding**: a ticker's running price/params only materialize the first time it appears in `get_watched_tickers()`. Known tickers use `SEED_PRICES` (AAPL $190, GOOGL $175, MSFT $420, AMZN $185, TSLA $250, NVDA $125, META $505, JPM $200, V $280, NFLX $650 — grouped `tech`/`ev`/`financial`/`media`). Unknown tickers get `DEFAULT_SEED` (price $100, drift 0.08, volatility 0.25, group `"neutral"` — no correlated peers), never validated against a real symbol registry.
- **State is in-process** (`self._prices`, `self._seeds`) — no external dependency, doesn't survive restart, a fresh process just reseeds.
- **Determinism**: `SimulatorProvider(cache, seed=42)` makes a run fully reproducible for tests.
- Constants: `TICK_INTERVAL_SECONDS = 0.5`.

## 3. Massive API (optional, real data)

Massive = October 2025 rebrand of Polygon.io (same accounts/keys, new base URL `api.massive.com`, new package `pip install massive`). Client auto-reads `MASSIVE_API_KEY` from env.

**Endpoint used**: `GET /v2/snapshot/locale/us/markets/stocks/tickers` (`client.get_snapshot_all("stocks", tickers)`) — one call prices the whole watchlist regardless of size. Never loop the single-ticker snapshot endpoint per ticker.

**Tiers**: Basic (free, 5 calls/min, EOD only) → poll every 15s. Starter/Developer ($29-79/mo, unlimited, 15min delayed) → 15s safe. Advanced/Business ($199+/mo, real-time) → poll every 2-15s. Constants: `DELAYED_POLL_INTERVAL_SECONDS = 15`, `REAL_TIME_POLL_INTERVAL_SECONDS = 5`.

**Response fields** (terse Polygon-style keys): `day.c`/`prevDay.c` = today/yesterday close, `lastTrade.p` = last trade price, `t` = timestamp (**nanoseconds** on snapshot/trade endpoints, **milliseconds** on grouped-aggs — not consistent across endpoints). A bad/unknown ticker is silently omitted from the response array (no per-ticker error on this endpoint).

**Parsing** (`massive_client._parse`):
- `current` = `day.close`, falling back to `last_trade.price`.
- `previous_price` = **last cache value**, not `prevDay.close` — `prevDay.close` is yesterday's close, which would make every poll register as a "change" against a stale reference. Only the very first poll for a ticker (no cache entry yet) falls back to `prevDay.close`, else to `current`.
- Missing/unusable price → returns `None`, ticker simply isn't written to the cache that cycle (stale-but-present, matching how a real feed degrades on partial outage — never delete/null a cache entry on a miss).

**Async/sync boundary**: `RESTClient` calls are blocking; wrapped in `asyncio.to_thread` so a slow HTTP round-trip never stalls the event loop (and therefore SSE delivery).

**Resilience**: `_poll_loop` wraps the one fallible call (`_poll_once`) in a blanket `except Exception` — logged, next cycle proceeds on schedule. No extra retry/backoff timer; the fixed poll interval is already the backoff. A 429 at the configured interval means the interval is misconfigured for the account tier — a config problem, not a runtime condition to special-case.

## 4. FastAPI wiring

- `main.py` lifespan: opens DB, loads `TrackedTickerRegistry` from `watchlist`/`positions` tables, calls `factory.get_provider(cache)`, starts it with `registry.get`, stores `db`/`cache`/`registry`/`provider` on `app.state`. On shutdown: `provider.stop()` then `db.close()`.
- `deps.py` exposes `get_cache`, `get_registry`, `get_db` via `Depends`.
- **SSE route** (`GET /api/stream/prices`): each connected client gets its own generator + independent 500ms loop reading the shared cache; per tick, emits one `event: price` per tracked ticker (`registry.get()`) with a cached tick. `request.is_disconnected()` checked each cycle so a closed tab doesn't leak a generator; `EventSource` auto-reconnects. Cadence is decoupled from provider refresh — between Massive polls (5-15s), the same tick is re-emitted every 500ms; inert since the frontend flash is keyed off an actual value change.
  ```
  event: price
  data: {"ticker":"AAPL","price":191.23,"previous_price":190.87,"timestamp":"2026-07-23T14:02:31.500Z","direction":"up"}
  ```
- **Watchlist routes** write-through to the registry: `POST /api/watchlist` → `registry.add_watchlist_ticker`; `DELETE /api/watchlist/{ticker}` → `registry.remove_watchlist_ticker` only (an open position keeps it tracked via the positions half of the union).
- **Trade route** (`POST /api/portfolio/trade`) fills at `cache.get(ticker).price` — the exact value the SSE stream last pushed, so there's no separate trade-price source to fall out of sync. After the fill, `registry.set_position_ticker(ticker, new_quantity)` write-through (a fresh buy starts streaming even if never watchlisted; a full sell-out of an unwatched ticker stops it).

## 5. Config

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `MASSIVE_API_KEY` | `factory.get_provider` | unset | Set + non-empty → `MassiveProvider`. Unset/empty → `SimulatorProvider`. Checked once at startup only. |

Tick interval, poll interval, correlation, event probability are code constants, not env vars — kept in one reviewable place rather than scattered across `.env.example`.

## 6. Error handling summary

| Failure | Where | Behavior |
|---|---|---|
| Unknown ticker (simulator) | `simulator._seed_for` | `DEFAULT_SEED`, never rejected |
| Unknown/delisted ticker (Massive) | `massive_client._parse` | Absent from response; cache left stale, not deleted |
| Massive network/HTTP error, 429 | `massive_client._poll_loop` | Caught, logged, next cycle proceeds; no extra retry timer |
| Client disconnects mid-SSE | `stream._price_events` | Generator ends cleanly; client auto-reconnects |
| Trade before any price tick exists | `portfolio.execute_trade` | `cache.get()` → `None` → `400`, no fill |
| Provider task raises unexpectedly | N/A | Simulator loop has no fallible I/O; Massive loop's one fallible call is guarded so `while True` never dies |

## 7. Testing (68 tests passing, `ruff check .` clean)

- **Pure math** (`test_gbm.py`): `step()` formula correctness at `z=0`, no negative/NaN price under extreme shock, `correlated_z` at `rho=0`/`rho=1` boundaries.
- **Simulator** (`test_simulator.py`): seeded runs are bit-for-bit reproducible; unseeded ticker gets `DEFAULT_SEED`; same-group tickers statistically correlate more than cross-group (catches mis-wired `rho`/group-`Z` reuse).
- **Massive parsing** (`test_massive_parse.py`): first poll falls back to `prevDay.close`; subsequent polls use cache value not stale `prevDay.close`; missing `day.close` falls back to `last_trade.price`; no usable price → `None`.
- **Contract test** (`test_provider_contract.py`): same parametrized test runs against both `SimulatorProvider` and a faked `MassiveProvider` — proves both satisfy `MarketDataProvider` identically.
- **Registry** (`test_tracked_tickers.py`): union of watchlist+positions; removing from watchlist keeps an open position tracked; full sellout stops tracking an unwatched ticker.
- **SSE route** (`test_stream_route.py`): drives `_price_events` directly with a fake request object rather than draining an infinite stream through `TestClient` (which would hang).
- **DB/API** (`tests/db/`, `tests/api/`): idempotent init (`init_db_if_needed` never re-seeds on a second call), watchlist CRUD, portfolio trade validation (cash/shares/no-shorting).

E2E (Playwright, browser-level `EventSource` + reconnection) runs against the simulator only (`LLM_MOCK=true`, no `MASSIVE_API_KEY`) so CI never depends on the live Massive API — per `PLAN.md` §12.

## 8. Non-blocking notes

- `simulator._tick_loop` uses a fixed `dt` from `TICK_INTERVAL_SECONDS` rather than measured wall-clock delta — invisible at current tick rate/ticker count; only worth revisiting if the watchlist cap grows well past 30.
- `MassiveProvider` has no circuit breaker beyond "log and retry next cycle" — deliberate, not an oversight (a second retry timer would fight with the poll interval).
