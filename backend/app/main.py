from __future__ import annotations

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

from .api import (  # noqa: E402  (after `app` exists, for router registration)
    portfolio,
    stream,
    watchlist,
)

app.include_router(stream.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
