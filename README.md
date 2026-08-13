# TradeAlly

TradeAlly is a single-user simulated trading workstation with live price streaming, virtual portfolio management, and an LLM chat assistant that can analyze positions and execute trades through natural language.

It is designed as a self-contained demo: one Docker command serves a dark, data-dense terminal UI on port `8000`. There is no authentication and no real-money brokerage integration — fills are instant market orders against a simulated (or optionally live-quoted) price feed.

## Features

- **Live price streaming** — Server-Sent Events (`GET /api/stream/prices`) push ticker updates; the UI flashes upticks/downticks and builds session sparklines client-side
- **Watchlist management** — seeded with 10 default tickers; add/remove manually or via chat (max 30; ticker format `^[A-Z0-9]{1,5}$`)
- **Simulated portfolio** — $10,000 starting cash; buy/sell market orders at the current cached price; fractional shares; no fees; no shorting
- **Portfolio views** — positions table, P&L heatmap (treemap), and portfolio-value history chart fed by periodic snapshots
- **AI chat copilot** — Ollama-backed assistant (`qwen3:8b` by default) with structured outputs that can auto-execute trades and watchlist changes
- **Single-container deploy** — Next.js static export served by FastAPI on one port; SQLite persisted via a Docker volume

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker container :8000                         │
│                                                 │
│  FastAPI                                        │
│  ├── /api/*           REST                      │
│  ├── /api/stream/*    SSE price feed            │
│  └── /*               Next.js static export     │
│                                                 │
│  Market data provider (background)              │
│  ├── SimulatorProvider  (default, GBM)          │
│  └── MassiveProvider    (if MASSIVE_API_KEY set)│
│         ↓                                       │
│  In-memory PriceCache ← SSE + trade fills       │
│                                                 │
│  SQLite (volume-mounted at /app/db)             │
└─────────────────────────────────────────────────┘
```

**Key design choices**

| Decision | Why |
|---|---|
| SSE instead of WebSockets | One-way server→client push is enough; simpler and widely supported |
| Static Next.js export | Same origin as the API; no CORS; one container |
| SQLite | Zero-config persistence for a single-user demo |
| Shared `PriceCache` | Trades fill at the same price the SSE stream just published |
| Market orders only | Avoids order books, partial fills, and limit-order complexity |

Detailed product and API contracts live in [`planning/PLAN.md`](planning/PLAN.md). Market-data internals are summarized in [`planning/MARKET_DATA_SUMMARY.md`](planning/MARKET_DATA_SUMMARY.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS v4, Recharts |
| Backend | FastAPI, Python 3.12, Uvicorn, `uv` |
| Database | SQLite via `aiosqlite` |
| Streaming | Server-Sent Events |
| LLM | Ollama HTTP API (structured JSON schema); `LLM_MOCK=true` for tests |
| Market data | Built-in GBM simulator, or Massive (Polygon.io) REST snapshots |
| Packaging | Multi-stage Dockerfile + Docker Compose |
| Tests | Pytest (backend), Vitest (frontend), Playwright (E2E) |

## Project structure

```
.
├── backend/                 # FastAPI app (API, SSE, DB, market data, LLM)
│   ├── app/
│   │   ├── api/             # portfolio, watchlist, chat, stream, system
│   │   ├── db/              # schema + connection / seed logic
│   │   ├── market_data/     # provider protocol, simulator, Massive client
│   │   ├── llm.py           # Ollama client + mock mode
│   │   └── main.py          # lifespan, routers, static serving
│   └── tests/
├── frontend/                # Next.js UI (static export in production)
│   ├── app/
│   ├── components/          # terminal panels (watchlist, charts, chat, …)
│   └── lib/                 # API client, SSE hook, types, formatters
├── db/                      # Runtime SQLite mount point (gitignored file)
├── test/                    # Playwright E2E + docker-compose.test.yml
├── scripts/                 # start/stop wrappers for macOS/Linux and Windows
├── planning/                # Specs and design notes
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## How it works

1. On startup the backend initializes SQLite (schema + seed data if needed), loads the watchlist/positions into an in-memory tracker, and starts a market-data provider.
2. The provider writes ticks into a shared `PriceCache`. SSE clients read that cache every ~500ms. Trade fills also read the cache, so UI and execution stay aligned.
3. Portfolio snapshots are recorded every 60 seconds (and after trades) for the P&L chart.
4. Chat loads portfolio context and recent history, calls Ollama with a constrained JSON schema, then auto-executes any returned trades / watchlist changes through the same validation paths as the REST trade APIs.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (recommended path)
- Optional: [Ollama](https://ollama.ai/) with `qwen3:8b` pulled, for live chat
- Optional: a [Massive](https://massive.com/) / Polygon API key for real market quotes

For local (non-Docker) development: Python 3.12+, [`uv`](https://docs.astral.sh/uv/), Node.js 20+.

## Quick start (Docker)

```bash
git clone https://github.com/raghhavv03/ai-trading-workstation.git
cd ai-trading-workstation

cp .env.example .env   # start scripts also do this if .env is missing

# macOS / Linux
./scripts/start_mac.sh

# Windows (PowerShell)
.\scripts\start_windows.ps1

# or
docker compose up --build -d
```

Open [http://localhost:8000](http://localhost:8000).

Stop with `./scripts/stop_mac.sh` / `.\scripts\stop_windows.ps1` (or `docker compose down`). The named volume `tradeally-data` is kept so portfolio state survives restarts.

### Optional: enable the AI chat

1. Install and start Ollama on the host.
2. Pull the model: `ollama pull qwen3:8b`
3. Keep `OLLAMA_BASE_URL=http://host.docker.internal:11434` in `.env` when running in Docker (use `http://localhost:11434` if the backend runs on the host).
4. Confirm with `GET /api/health` — expect `"ollama": "reachable"`.

Without Ollama, the rest of the workstation still works; chat falls back to an error message unless `LLM_MOCK=true`.

## Local development

Run backend and frontend as separate processes.

**Backend**

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

**Frontend** (proxies `/api/*` to the backend in dev)

```bash
cd frontend
npm install
npm run dev
```

UI: [http://localhost:3000](http://localhost:3000). Override the backend origin with `BACKEND_ORIGIN` if needed (default `http://localhost:8000`).

## Environment variables

Copy `.env.example` to `.env`. All variables are optional.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` (in `.env.example`) | Ollama base URL |
| `OLLAMA_MODEL` | `qwen3:8b` | Model name |
| `OLLAMA_TIMEOUT_SECONDS` | `60` | Chat request timeout |
| `MASSIVE_API_KEY` | _(empty)_ | If set, use Massive REST snapshots instead of the simulator |
| `LLM_MOCK` | `false` | Deterministic mock LLM responses (E2E / CI) |

Docker-only runtime paths (`DB_PATH`, `STATIC_DIR`) are set in the Dockerfile and normally do not need editing.

## API overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stream/prices` | SSE live prices for watchlist ∪ open positions |
| `GET` | `/api/portfolio` | Cash, positions, totals, unrealized P&L |
| `POST` | `/api/portfolio/trade` | `{ticker, quantity, side}` market order |
| `GET` | `/api/portfolio/history` | Portfolio value snapshots |
| `GET`/`POST`/`DELETE` | `/api/watchlist` … | List / add / remove tickers |
| `GET`/`POST` | `/api/chat` | History / send message (may execute actions) |
| `GET` | `/api/health` | Liveness + Ollama reachability |
| `POST` | `/api/system/reset` | Restore seeded $10k / default watchlist / clear history |

## Testing

**Backend**

```bash
cd backend
uv sync --group dev
uv run pytest
uv run ruff check .
```

**Frontend**

```bash
cd frontend
npm test
npm run lint
npm run typecheck
```

**End-to-end (Playwright)**

```bash
cd test
npm run docker
# equivalent:
# docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright
```

E2E runs against the production image with `LLM_MOCK=true` and no Massive key (simulator only).

## Limitations

- Single hardcoded user (`default`); no auth or multi-tenancy
- Simulated cash and instant market fills only — not a brokerage
- Chat requires a reachable Ollama instance (or mock mode)
- Massive free-tier data may be delayed / EOD depending on plan; the default simulator is intended for demos
- Desktop-first UI; tablet works, mobile is not a primary target
- No cloud deploy configs are included (`deploy/` was a stretch goal in the plan)

## License

No license file is present in this repository. Treat the code as proprietary / all rights reserved unless the owner adds an explicit license.
