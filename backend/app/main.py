from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .market_data.cache import PriceCache
from .market_data.factory import get_provider
from .market_data.tracked_tickers import TrackedTickerRegistry

# Default watchlist per PLAN.md §7. Watchlist/positions persistence (SQLite)
# is owned by a separate module; until it exists, the registry seeds from
# these defaults so the market data layer is runnable and demoable on its own.
DEFAULT_WATCHLIST = {"AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache = PriceCache()
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=DEFAULT_WATCHLIST, positions=set())

    provider = get_provider(cache)
    await provider.start(registry.get)

    app.state.cache = cache
    app.state.registry = registry
    app.state.provider = provider

    yield

    await provider.stop()


app = FastAPI(lifespan=lifespan)

from .api import stream  # noqa: E402  (after `app` exists, for router registration)

app.include_router(stream.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
