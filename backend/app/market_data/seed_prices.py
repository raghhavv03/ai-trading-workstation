from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TickerSeed:
    price: float
    drift: float  # annualized, e.g. 0.08 = 8%/year
    volatility: float  # annualized, e.g. 0.30 = 30%/year
    group: str  # correlation group


SEED_PRICES: dict[str, TickerSeed] = {
    "AAPL": TickerSeed(price=190.00, drift=0.10, volatility=0.28, group="tech"),
    "GOOGL": TickerSeed(price=175.00, drift=0.09, volatility=0.30, group="tech"),
    "MSFT": TickerSeed(price=420.00, drift=0.11, volatility=0.26, group="tech"),
    "AMZN": TickerSeed(price=185.00, drift=0.12, volatility=0.34, group="tech"),
    "TSLA": TickerSeed(price=250.00, drift=0.05, volatility=0.55, group="ev"),
    "NVDA": TickerSeed(price=125.00, drift=0.20, volatility=0.45, group="tech"),
    "META": TickerSeed(price=505.00, drift=0.10, volatility=0.32, group="tech"),
    "JPM": TickerSeed(price=200.00, drift=0.07, volatility=0.22, group="financial"),
    "V": TickerSeed(price=280.00, drift=0.08, volatility=0.20, group="financial"),
    "NFLX": TickerSeed(price=650.00, drift=0.09, volatility=0.35, group="media"),
}

DEFAULT_SEED = TickerSeed(price=100.00, drift=0.08, volatility=0.25, group="neutral")
