from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from massive import RESTClient

from .base import GetWatchedTickers, PriceTick
from .cache import PriceCache

REAL_TIME_POLL_INTERVAL_SECONDS = 5  # Advanced/Business tier
DELAYED_POLL_INTERVAL_SECONDS = 15  # Basic/Starter/Developer tier

logger = logging.getLogger(__name__)


class MassiveProvider:
    def __init__(
        self,
        api_key: str,
        cache: PriceCache,
        poll_interval: float = DELAYED_POLL_INTERVAL_SECONDS,
    ) -> None:
        self._client = RESTClient(api_key=api_key)
        self._cache = cache
        self._poll_interval = poll_interval
        self._task: asyncio.Task | None = None

    async def start(self, get_watched_tickers: GetWatchedTickers) -> None:
        self._task = asyncio.create_task(self._poll_loop(get_watched_tickers))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self, get_watched_tickers: GetWatchedTickers) -> None:
        while True:
            tickers = sorted(get_watched_tickers())
            if tickers:
                try:
                    await self._poll_once(tickers)
                except Exception:
                    # One failed cycle (network blip, 429, transient 5xx) must
                    # never kill the background task -- log and try again next cycle.
                    logger.exception("Massive poll cycle failed")
            await asyncio.sleep(self._poll_interval)

    async def _poll_once(self, tickers: list[str]) -> None:
        # SDK call is sync/blocking -- keep it off the event loop so it
        # doesn't stall SSE delivery or the trade endpoint mid-request.
        snapshot = await asyncio.to_thread(self._client.get_snapshot_all, "stocks", tickers)
        for item in snapshot:
            tick = self._parse(item)
            if tick is not None:
                await self._cache.update(tick)

    def _parse(self, item) -> PriceTick | None:
        """item is one entry from get_snapshot_all's result list (an SDK
        TickerSnapshot object). A bad/delisted ticker is simply absent from
        the response (MASSIVE_API.md §10), never passed here."""
        if item.ticker is None:
            return None

        current = None
        if item.day is not None and item.day.close is not None:
            current = item.day.close
        elif item.last_trade is not None and item.last_trade.price is not None:
            current = item.last_trade.price
        if current is None:
            return None

        # previous_price is the LAST CACHE VALUE, not prevDay.close: prevDay.close
        # is yesterday's close, which would make every poll register as a
        # "change" relative to a stale reference. Cache continuity gives
        # tick-over-tick direction for the frontend's green/red flash; only
        # the very first poll for a ticker falls back to prevDay.close.
        existing = self._cache.get(item.ticker)
        if existing is not None:
            previous = existing.price
        elif item.prev_day is not None and item.prev_day.close is not None:
            previous = item.prev_day.close
        else:
            previous = current

        return PriceTick(
            ticker=item.ticker,
            price=float(current),
            previous_price=float(previous),
            timestamp=datetime.now(timezone.utc),
        )
