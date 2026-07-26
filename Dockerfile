# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build the Next.js static export
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — FastAPI runtime, serving the API and the exported frontend
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv

WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
RUN uv sync --frozen --no-dev

COPY --from=frontend /build/out ./static

# Volume mount target; DB_PATH points the backend at it so data survives restarts.
ENV PATH="/app/backend/.venv/bin:$PATH" \
    DB_PATH=/app/db/tradeally.db \
    STATIC_DIR=/app/backend/static

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
