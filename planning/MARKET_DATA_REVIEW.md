# Market Data Backend — Code Review

Review of commit `9013b58` ("backend implemented") against the design docs in `planning/` (`MARKET_DATA_DESIGN.md`, `MARKET_SIMULATOR.md`, `MASSIVE_API.md`, `MASSIVE_CLIENT.md`) and `PLAN.md` §5-8, §12.

## Verdict

**Ship it.** The implemented slice (`backend/app/market_data/*`, `app/api/stream.py`, `app/main.py`, `app/deps.py`) is a faithful, near line-for-line implementation of `MARKET_DATA_DESIGN.md`. All 53 tests pass. No bugs found. The only gaps are features the design docs describe but this commit doesn't touch (SQLite persistence, watchlist/portfolio routes) — those are out of scope for this slice, not defects in it.

## What was reviewed

- `app/market_data/base.py`, `cache.py`, `tracked_tickers.py`, `seed_prices.py`, `gbm.py`, `simulator.py`, `massive_client.py`, `factory.py`
- `app/main.py`, `app/deps.py`, `app/api/stream.py`
- All 7 test files under `tests/market_data/`
- The installed `massive` SDK's actual model classes (`TickerSnapshot`, `Agg`, `LastTrade`) to confirm the field names `massive_client.py` reads (`item.day.close`, `item.prev_day.close`, `item.last_trade.price`, `item.ticker`) really exist on the SDK objects, not just in the design doc's illustrative code.

## Test results

```
53 passed, 1 warning in 11.45s
```

Ran via `cd backend && source .venv/bin/activate && python -m pytest -q`. The one warning is `httpx`/`starlette.testclient` deprecation noise, unrelated to this code.

Coverage is a superset of the design's own test plan (`MARKET_DATA_DESIGN.md` §17):
- `test_provider_contract.py` parametrizes the *same* test across `SimulatorProvider` and a faked `MassiveProvider` — a real contract test, not the stubbed-out version the design doc sketched.
- `test_massive_parse.py` adds cases the design didn't enumerate: missing ticker, no-prev-day-and-no-cache fallback, `direction` property check.
- `test_tracked_tickers.py` covers every union/overlap case (watchlist-only, position-only, both, sellout while still watched, buy of an unwatched ticker) — more thorough than the design's three examples.
- `test_stream_route.py` drives `_price_events` directly with a fake request object instead of trying to consume an infinite SSE stream through `TestClient` (which fully drains the response body and would hang). This is a better design than the doc's own `httpx.AsyncClient` sketch — it tests the actual generator logic without relying on a real network round-trip or a timeout race.

## Design conformance

Checked line-by-line against `MARKET_DATA_DESIGN.md`; no meaningful deviation found:

- `PriceTick`/`MarketDataProvider` protocol — matches exactly.
- `PriceCache` — single writer lock, lock-free reads, `all()` returns a copy — matches, and `test_all_returns_a_copy_not_a_live_view` proves the copy semantics.
- `TrackedTickerRegistry` — `threading.Lock` (not `asyncio.Lock`) because the provider's tick loop calls `registry.get` synchronously — matches the design's stated rationale, and `test_get_returns_a_copy_not_a_live_view` confirms no live-reference leak.
- `gbm.py` — formula, `dt_for_interval`, `correlated_z` all match; `test_same_group_tickers_correlate_more_than_cross_group` (in `test_simulator.py`, not a separate file as the design sketched) is the statistical property test the design flagged as important to catch a mis-wired `rho`.
- `simulator.py` — group-`Z`-once-per-tick, lazy seeding, `stop()` awaiting the cancelled task — all present.
- `massive_client.py` — cache-value-as-previous-price logic (not stale `prevDay.close`), batch snapshot call, `asyncio.to_thread` for the blocking SDK call, blanket `except Exception` around one poll cycle — all present and correctly reasoned in comments. Verified against the actual installed SDK: `TickerSnapshot.day`/`.prev_day` are `Agg` (has `.close`), `.last_trade` is `LastTrade` (has `.price`), `get_snapshot_all(market_type, tickers)` signature matches the call site exactly.
- `factory.py` — deferred import of `massive_client` so a simulator-only run never needs the `massive` package importable — matches.
- `api/stream.py` — SSE wire format (`event: price`, JSON payload with `ticker`/`price`/`previous_price`/`timestamp`/`direction`), `request.is_disconnected()` check, per-client independent loop — matches `PLAN.md` §6 exactly, including the `Z` suffix on the timestamp.

## Gaps — now closed

The original review of commit `9013b58` found the market-data slice solid but incomplete: no SQLite layer, no watchlist/portfolio routes, no lint config. All three are now implemented (see below); `frontend/` remains empty and out of scope (no frontend work requested), and chat/LLM + `/api/system/reset` + `/api/portfolio/history` remain a deliberately separate future slice (confirmed with the user — not part of this pass).

**1. SQLite layer — `app/db/schema.sql`, `app/db/connection.py`.** Four tables (`users_profile`, `watchlist`, `positions`, `trades` — `portfolio_snapshots`/`chat_messages` deferred since nothing reads/writes them yet). `init_db_if_needed` creates the schema, then seeds the default user ($10,000 cash) and 10-ticker watchlist exactly once — a second call against the same DB (checked by `test_init_is_idempotent_and_does_not_reseed`) never re-seeds over user edits.

**2. `app/api/watchlist.py` + `app/api/portfolio.py`.** `GET/POST/DELETE /api/watchlist` and `GET /api/portfolio` + `POST /api/portfolio/trade`, wired to `main.py`'s lifespan (which now loads the registry from the DB instead of a hardcoded set) and write-through to `TrackedTickerRegistry` exactly as `MARKET_DATA_DESIGN.md` §13-14 specified. Trade execution validates cash (buy) and existing holding (sell, no shorting), computes weighted-average cost on buys, deletes the position row on a full sell-out, and fills at `cache.get(ticker).price` — the same value the SSE stream last pushed.

**3. Lint config.** `ruff` added with `select = ["E", "F", "I", "UP", "B"]`, ignoring `B008` (`Depends(...)` defaults — standard FastAPI idiom) and `UP017` (`datetime.UTC` vs `timezone.utc` — cosmetic churn, not worth it). `ruff check .` passes clean.

**Verified end-to-end, not just unit-tested:** booted the real server (`uvicorn app.main:app`) against a throwaway DB and hit every endpoint over HTTP — `/api/health`, `/api/watchlist` (GET/POST/DELETE), `/api/portfolio` (GET, and a live buy trade that correctly deducted cash and created a position), and `/api/stream/prices` (confirmed still streaming). This exercises the actual FastAPI `Depends` wiring, which the unit tests (which call route functions directly) don't cover.

## Minor notes (non-blocking)

- `simulator._tick_loop` computes `dt` once from the fixed `TICK_INTERVAL_SECONDS` constant rather than measured wall-clock delta between iterations, so a slow tick (many tickers, GC pause) doesn't get a compensating larger `dt`. At the current tick rate and ticker counts this is invisible; only worth revisiting if the watchlist cap grows well past today's 30.
- `MassiveProvider` has no circuit breaker beyond "log and retry next cycle" — this is the documented, deliberate design choice (`MASSIVE_CLIENT.md` §7: a second retry timer would fight with the poll interval), not an oversight.

## Current test results (after finalization)

```
68 passed, 1 warning in 11.53s
```

15 new tests: `tests/db/test_connection.py` (2), `tests/api/test_watchlist_route.py` (6), `tests/api/test_portfolio_route.py` (7). Same warning as before (unrelated `httpx`/`TestClient` deprecation notice).

## Recommendation

Backend is done for this scope: market data, persistence, watchlist, and portfolio all in place and tested. Remaining PLAN.md work — chat/LLM integration, `/api/system/reset`, `/api/portfolio/history`, and the frontend — is separate, explicitly deferred future work, not a gap in what's here.
