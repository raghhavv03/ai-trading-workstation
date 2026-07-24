#!/usr/bin/env python3
"""
Live terminal demo for the market data backend.

Connects to GET /api/stream/prices (SSE) and renders, per ticker:
a live price, a colored up/down arrow, and a sparkline built from the
stream itself -- plus a scrolling raw event log below. Manual sanity
check that the provider (simulator or Massive) is actually ticking.

Usage:
    uv run market_data_demo.py [--url http://localhost:8000]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque

import httpx

SPARK_CHARS = "▁▂▃▄▅▆▇█"
HISTORY_LEN = 30
LOG_LEN = 12
REDRAW_INTERVAL_SECONDS = 0.2

GREEN = "\033[32m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"
CLEAR = "\033[2J\033[H"


def sparkline(values: deque[float]) -> str:
    if len(values) < 2:
        return ""
    lo, hi = min(values), max(values)
    span = hi - lo or 1.0
    return "".join(
        SPARK_CHARS[min(int((v - lo) / span * (len(SPARK_CHARS) - 1)), len(SPARK_CHARS) - 1)]
        for v in values
    )


def render(url: str, prices: dict[str, dict], log: deque[str]) -> str:
    lines = [CLEAR, f"FinAlly market data demo -- {url}  (Ctrl+C to quit)", ""]
    lines.append(f"{'TICKER':<8}{'PRICE':>10}  {'':<1} SPARKLINE")
    lines.append("-" * 60)
    for ticker in sorted(prices):
        row = prices[ticker]
        direction = row["direction"]
        color = GREEN if direction == "up" else RED if direction == "down" else DIM
        arrow = "▲" if direction == "up" else "▼" if direction == "down" else "•"
        spark = sparkline(row["history"])
        lines.append(f"{ticker:<8}{row['price']:>10.2f}  {color}{arrow}{RESET} {color}{spark}{RESET}")
    lines.append("")
    lines.append(f"Event log (last {LOG_LEN}):")
    lines.append("-" * 60)
    lines.extend(log)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000", help="Backend base URL")
    args = parser.parse_args()

    stream_url = f"{args.url}/api/stream/prices"
    prices: dict[str, dict] = {}
    log: deque[str] = deque(maxlen=LOG_LEN)

    print(f"Connecting to {stream_url} ...")
    try:
        with httpx.stream("GET", stream_url, timeout=None) as response:
            response.raise_for_status()
            event_type = None
            last_draw = 0.0
            for line in response.iter_lines():
                if line.startswith("event:"):
                    event_type = line.split(":", 1)[1].strip()
                    continue
                if not line.startswith("data:") or event_type != "price":
                    continue

                tick = json.loads(line.split(":", 1)[1].strip())
                ticker = tick["ticker"]
                row = prices.setdefault(ticker, {"history": deque(maxlen=HISTORY_LEN)})
                row["price"] = tick["price"]
                row["direction"] = tick["direction"]
                row["history"].append(tick["price"])

                ts = tick["timestamp"].split("T")[1][:8]
                arrow = "^" if tick["direction"] == "up" else "v" if tick["direction"] == "down" else "-"
                log.append(f"{ts}  {ticker:<6} {arrow} {tick['previous_price']:.2f} -> {tick['price']:.2f}")

                now = time.monotonic()
                if now - last_draw >= REDRAW_INTERVAL_SECONDS:
                    sys.stdout.write(render(args.url, prices, log))
                    sys.stdout.flush()
                    last_draw = now
    except httpx.ConnectError:
        print(f"Could not connect to {stream_url}. Is the backend running?")
        return 1
    except KeyboardInterrupt:
        print("\nDisconnected.")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
