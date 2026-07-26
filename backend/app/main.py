from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import chat, portfolio, stream, system, watchlist
from .db.connection import get_db_connection, init_db_if_needed
from .market_data.cache import PriceCache
from .market_data.factory import get_provider
from .market_data.tracked_tickers import TrackedTickerRegistry

DEFAULT_USER_ID = "default"
SNAPSHOT_INTERVAL_SECONDS = 60
DEFAULT_STATIC_DIR = "static"

logger = logging.getLogger(__name__)


async def _snapshot_loop(db, cache: PriceCache) -> None:
    while True:
        await asyncio.sleep(SNAPSHOT_INTERVAL_SECONDS)
        try:
            await portfolio.record_snapshot(db, cache)
        except Exception:
            # A failed snapshot is cosmetic (one missing P&L chart point) and
            # must never kill the loop that produces every later one.
            logger.exception("Portfolio snapshot failed")


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
    snapshot_task = asyncio.create_task(_snapshot_loop(db, cache))

    app.state.db = db
    app.state.cache = cache
    app.state.registry = registry
    app.state.provider = provider

    yield

    snapshot_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await snapshot_task
    await provider.stop()
    await db.close()


app = FastAPI(lifespan=lifespan)

app.include_router(stream.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(system.router, prefix="/api")


def static_dir() -> Path:
    return Path(os.environ.get("STATIC_DIR", DEFAULT_STATIC_DIR))


_next_assets = static_dir() / "_next"
if _next_assets.is_dir():
    app.mount("/_next", StaticFiles(directory=_next_assets), name="next-assets")


# Registered last so every /api/* router above wins the match. The explicit
# api/ guard keeps an unknown API path a 404 instead of silently returning
# index.html, which would look to the frontend like a successful fetch.
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not Found")

    root = static_dir()
    if not root.is_dir():
        raise HTTPException(404, "Frontend build not found -- did the Next.js export run?")
    root = root.resolve()

    candidate = (root / full_path).resolve()
    if candidate.is_relative_to(root) and candidate.is_file():
        return FileResponse(candidate)

    index = root / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(404, "Frontend build not found -- did the Next.js export run?")
