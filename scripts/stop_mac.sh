#!/usr/bin/env bash
# Stop TradeAlly (macOS / Linux). Safe to run repeatedly.
#
# The `tradeally-data` volume is deliberately left intact, so your portfolio,
# trades, and chat history survive a stop/start cycle.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker does not appear to be running — nothing to stop." >&2
  exit 0
fi

docker compose down

echo "TradeAlly stopped. Your data volume (tradeally-data) was preserved."
