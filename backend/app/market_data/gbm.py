from __future__ import annotations

import math
import random

TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600  # ~252 trading days, 6.5h sessions


def dt_for_interval(interval_seconds: float) -> float:
    return interval_seconds / TRADING_SECONDS_PER_YEAR


def step(price: float, drift: float, volatility: float, dt: float, z: float) -> float:
    """S(t+dt) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z)"""
    exponent = (drift - 0.5 * volatility**2) * dt + volatility * math.sqrt(dt) * z
    return price * math.exp(exponent)


def correlated_z(rng: random.Random, group_z: float, rho: float) -> float:
    """Blend a shared group factor with an idiosyncratic draw so tickers in
    the same correlation group move together. rho=0 -> independent, rho=1 -> lockstep."""
    idiosyncratic = rng.gauss(0, 1)
    return rho * group_z + math.sqrt(1 - rho**2) * idiosyncratic
