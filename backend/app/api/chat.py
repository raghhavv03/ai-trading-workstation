from __future__ import annotations

import json
import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from .. import llm
from ..db import queries
from ..deps import get_cache, get_db, get_registry
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry
from . import portfolio, watchlist

router = APIRouter()

DEFAULT_USER_ID = "default"
HISTORY_LIMIT = 20

logger = logging.getLogger(__name__)


def _decode_actions(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


@router.get("/chat")
async def get_chat_history(db: aiosqlite.Connection = Depends(get_db)):
    rows = await queries.get_recent_chat_messages(db, DEFAULT_USER_ID, HISTORY_LIMIT)
    return [
        {
            "role": row["role"],
            "content": row["content"],
            "actions": _decode_actions(row["actions"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


async def _build_portfolio_context(db: aiosqlite.Connection, cache: PriceCache) -> dict:
    cash_balance, positions, total_value = await portfolio.load_portfolio(db, cache)
    watchlist_rows = await watchlist.get_watchlist(db, cache)
    return {
        "cash_balance": round(cash_balance, 2),
        "total_value": round(total_value, 2),
        "positions": [portfolio.serialize_position(p) for p in positions],
        "watchlist": watchlist_rows,
    }


async def _execute_actions(
    parsed: dict,
    db: aiosqlite.Connection,
    cache: PriceCache,
    registry: TrackedTickerRegistry,
) -> dict:
    """Routes LLM-requested actions through the exact same handlers the manual
    REST endpoints use, so validation (cash, share count, ticker format, 30-cap)
    has one implementation. A rejected sub-action is reported, not raised --
    one bad trade must not sink the whole chat turn (PLAN.md §9)."""
    trades = []
    for trade in parsed.get("trades") or []:
        requested = {
            "ticker": str(trade.get("ticker", "")).strip().upper(),
            "side": str(trade.get("side", "")).strip().lower(),
            "quantity": trade.get("quantity"),
        }
        try:
            result = await portfolio.execute_trade(requested, db, cache, registry)
            trades.append({**result, "status": "executed"})
        except HTTPException as exc:
            trades.append({**requested, "status": "rejected", "error": exc.detail})

    watchlist_changes = []
    for change in parsed.get("watchlist_changes") or []:
        ticker = str(change.get("ticker", "")).strip().upper()
        action = str(change.get("action", "")).strip().lower()
        try:
            if action == "add":
                await watchlist.add_ticker({"ticker": ticker}, db, registry)
            elif action == "remove":
                await watchlist.remove_ticker(ticker, db, registry)
            else:
                raise HTTPException(400, f"Unknown watchlist action: {action!r}")
            watchlist_changes.append({"ticker": ticker, "action": action, "status": "applied"})
        except HTTPException as exc:
            watchlist_changes.append(
                {"ticker": ticker, "action": action, "status": "rejected", "error": exc.detail}
            )

    return {"trades": trades, "watchlist_changes": watchlist_changes}


@router.post("/chat")
async def send_message(
    body: dict,
    db: aiosqlite.Connection = Depends(get_db),
    cache: PriceCache = Depends(get_cache),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    user_message = str(body.get("message", "")).strip()
    if not user_message:
        raise HTTPException(400, "message must be a non-empty string")

    # Fetched before persisting this turn's user message -- it is passed to the
    # model separately, and would otherwise appear twice in the prompt.
    history = await queries.get_recent_chat_messages(db, DEFAULT_USER_ID, HISTORY_LIMIT)
    context = await _build_portfolio_context(db, cache)
    await queries.insert_chat_message(db, DEFAULT_USER_ID, "user", user_message)

    try:
        parsed = await llm.complete(context, history, user_message)
    except llm.LLMError:
        logger.exception("LLM turn failed; returning fallback response")
        parsed = None

    if parsed is None:
        content = llm.FALLBACK_MESSAGE
        actions = {"trades": [], "watchlist_changes": []}
    else:
        content = parsed["message"]
        actions = await _execute_actions(parsed, db, cache, registry)

    await queries.insert_chat_message(
        db, DEFAULT_USER_ID, "assistant", content, json.dumps(actions)
    )
    return {"message": content, "actions": actions}
