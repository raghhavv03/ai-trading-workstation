#!/usr/bin/env bash
# Start FinAlly (macOS / Linux). Safe to run repeatedly.
#
#   ./scripts/start_mac.sh            # build if needed, start, open browser
#   ./scripts/start_mac.sh --build    # force a rebuild first
#   ./scripts/start_mac.sh --no-open  # don't open the browser

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FORCE_BUILD=false
OPEN_BROWSER=true

for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=true ;;
    --no-open) OPEN_BROWSER=false ;;
    -h|--help)
      sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker does not appear to be running. Start Docker Desktop and try again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env found — creating one from .env.example"
  cp .env.example .env
fi

if [ "$FORCE_BUILD" = true ] || [ -z "$(docker compose images -q finally 2>/dev/null)" ]; then
  echo "Building the FinAlly image..."
  docker compose build
fi

docker compose up -d

URL="http://localhost:8000"
echo ""
echo "FinAlly is starting at ${URL}"
echo "  logs:  docker compose logs -f"
echo "  stop:  ./scripts/stop_mac.sh"

if [ "$OPEN_BROWSER" = true ] && command -v open >/dev/null 2>&1; then
  open "$URL"
fi
