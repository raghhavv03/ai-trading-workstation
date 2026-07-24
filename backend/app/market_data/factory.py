from __future__ import annotations

import os

from .base import MarketDataProvider
from .cache import PriceCache


def get_provider(cache: PriceCache) -> MarketDataProvider:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if api_key:
        from .massive_client import MassiveProvider

        return MassiveProvider(api_key=api_key, cache=cache)
    from .simulator import SimulatorProvider

    return SimulatorProvider(cache=cache)
