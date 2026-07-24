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

    async def start(self, get_watched_tickers: GetWatchedTickers) -> None: ...

    async def stop(self) -> None: ...
