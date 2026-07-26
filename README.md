# TradeAlly — AI Trading Workstation 📈🤖

TradeAlly is a high-performance, full-stack AI-powered trading workstation inspired by modern Bloomberg-style terminals. It streams live market data, allows users to manage a virtual portfolio, and integrates an AI copilot capable of analyzing positions, suggesting strategies, and executing trades via natural language.

---

## ✨ Features

- ⚡ **Real-Time Data Streaming**: Live price updates and ticker stream using Server-Sent Events (SSE) with subtle visual uptick/downtick animations.
- 📊 **Interactive Terminal UI**: Data-dense dark theme featuring sparkline mini-charts, detailed main charting view, and custom watchlist management.
- 💼 **Simulated Portfolio Management**: Track a $10,000 virtual portfolio with interactive P&L heatmaps (treemaps), historical performance tracking, and instant execution.
- 🤖 **AI Assistant & Trading Copilot**: Natural language LLM agent powered by local models (Ollama) or external APIs (OpenAI) to query portfolio status, analyze market trends, and trigger trade execution.
- 🐳 **Single-Container Architecture**: Next.js frontend statically exported and served directly by FastAPI inside a single Docker container on port 8000.

---

## 🛠️ Tech Stack

### **Frontend**
- **Framework**: Next.js 15 (React 19, TypeScript)
- **Styling**: Tailwind CSS v4
- **Visualization**: Recharts & custom SVG sparklines
- **Testing**: Vitest & React Testing Library

### **Backend**
- **Framework**: FastAPI (Python 3.12, Uvicorn)
- **Database**: SQLite with `aiosqlite` for asynchronous persistence
- **Streaming**: Server-Sent Events (SSE)
- **AI / LLM Integration**: Asynchronous HTTP client interfacing with Ollama / OpenAI endpoints
- **Testing & Tooling**: Pytest & Ruff

### **Infrastructure**
- **Containerization**: Docker & Docker Compose
- **Package Management**: `uv` (Python) & `npm` (Node.js)

---

## 🚀 Quick Start

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/) installed and running.
- *(Optional for LLM features)* [Ollama](https://ollama.ai/) running locally or an OpenAI-compatible API key.

### Running with Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/ai-trading-workstation.git
   cd ai-trading-workstation
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Launch the application:**
   - **Mac/Linux:**
     ```bash
     ./scripts/start_mac.sh
     # Or using docker compose:
     docker compose up --build -d
     ```
   - **Windows (PowerShell):**
     ```powershell
     .\scripts\start_windows.ps1
     ```

4. **Access the Workstation:**
   Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## 💻 Local Development Setup

If you prefer running the backend and frontend separately for development:

### 1. Backend (FastAPI)
```bash
cd backend
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv sync
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```
The frontend dev server will be available at [http://localhost:3000](http://localhost:3000).

---

## 📁 Repository Structure

```
.
├── backend/            # FastAPI application (API endpoints, SSE, DB, LLM integration)
│   ├── app/            # Main application code (main.py, llm.py, market_data/, db/)
│   └── tests/          # Pytest backend test suite
├── frontend/           # Next.js frontend workstation interface
│   ├── app/            # Next.js App Router pages and layout
│   ├── components/     # Terminal components (watchlist, chart, portfolio, AI chat)
│   └── lib/            # Utility functions and API clients
├── db/                 # SQLite database storage directory
├── docker-compose.yml  # Container orchestration setup
├── Dockerfile          # Multi-stage container build definition
├── planning/           # Architecture specification & design documents
└── scripts/            # Shell & PowerShell deployment scripts
```

---

## 🧪 Running Tests

- **Backend Tests**:
  ```bash
  cd backend
  pytest
  ```

- **Frontend Tests**:
  ```bash
  cd frontend
  npm test
  ```

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
