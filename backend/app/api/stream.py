from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from starlette.responses import StreamingResponse

from ..deps import get_cache, get_registry
from ..market_data.base import PriceTick
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()

STREAM_INTERVAL_SECONDS = 0.5


def _format_event(tick: PriceTick) -> str:
    payload = {
        "ticker": tick.ticker,
        "price": tick.price,
        "previous_price": tick.previous_price,
        "timestamp": tick.timestamp.isoformat().replace("+00:00", "Z"),
        "direction": tick.direction,
    }
    return f"event: price\ndata: {json.dumps(payload)}\n\n"


async def _price_events(request: Request, cache: PriceCache, registry: TrackedTickerRegistry):
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
