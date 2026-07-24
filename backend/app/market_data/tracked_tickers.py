from __future__ import annotations

import threading


class TrackedTickerRegistry:
    """In-memory mirror of `union(watchlist.ticker, positions.ticker WHERE quantity > 0)`.
    Loaded from SQLite at startup; updated write-through by the routes that
    mutate those tables, so the provider never queries the DB itself."""

    def __init__(self) -> None:
        self._watchlist: set[str] = set()
        self._positions: set[str] = set()
        self._lock = threading.Lock()

    def load_initial(self, watchlist: set[str], positions: set[str]) -> None:
        with self._lock:
            self._watchlist = set(watchlist)
            self._positions = set(positions)

    def add_watchlist_ticker(self, ticker: str) -> None:
        with self._lock:
            self._watchlist.add(ticker)

    def remove_watchlist_ticker(self, ticker: str) -> None:
        with self._lock:
            self._watchlist.discard(ticker)

    def set_position_ticker(self, ticker: str, quantity: float) -> None:
        """Call after every trade fill with the position's new quantity."""
        with self._lock:
            if quantity > 0:
                self._positions.add(ticker)
            else:
                self._positions.discard(ticker)

    def get(self) -> set[str]:
        with self._lock:
            return self._watchlist | self._positions
