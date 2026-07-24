from __future__ import annotations

import aiosqlite
from fastapi import Request

from .market_data.cache import PriceCache
from .market_data.tracked_tickers import TrackedTickerRegistry


def get_cache(request: Request) -> PriceCache:
    return request.app.state.cache


def get_registry(request: Request) -> TrackedTickerRegistry:
    return request.app.state.registry


def get_db(request: Request) -> aiosqlite.Connection:
    return request.app.state.db
