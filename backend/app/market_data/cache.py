from __future__ import annotations

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
