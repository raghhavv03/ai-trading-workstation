from __future__ import annotations

import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from ..db import queries
from ..deps import get_cache, get_db, get_registry
from ..market_data.cache import PriceCache
from ..market_data.tracked_tickers import TrackedTickerRegistry

router = APIRouter()
DEFAULT_USER_ID = "default"
VALID_SIDES = {"buy", "sell"}


async def _get_cash_balance(db: aiosqlite.Connection) -> float:
    rows = await db.execute_fetchall(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    )
    return rows[0][0]


async def _get_position(db: aiosqlite.Connection, ticker: str) -> aiosqlite.Row | None:
    rows = await db.execute_fetchall(
        "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
        (DEFAULT_USER_ID, ticker),
    )
    return rows[0] if rows else None


async def load_portfolio(
    db: aiosqlite.Connection, cache: PriceCache
) -> tuple[float, list[dict], float]:
    """Single source of truth for portfolio valuation, shared by the REST route,
    the periodic snapshot task, and the LLM chat context. Values are unrounded
    here -- rounding is applied at serialization time only (PLAN.md §7)."""
    cash_balance = await _get_cash_balance(db)
    rows = await db.execute_fetchall(
        "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?", (DEFAULT_USER_ID,)
    )

    positions = []
    total_value = cash_balance
    for ticker, quantity, avg_cost in rows:
        tick = cache.get(ticker)
        current_price = tick.price if tick is not None else avg_cost
        market_value = quantity * current_price
        total_value += market_value
        positions.append(
            {
                "ticker": ticker,
                "quantity": quantity,
                "avg_cost": avg_cost,
                "current_price": current_price,
                "market_value": market_value,
                "unrealized_pnl": market_value - quantity * avg_cost,
            }
        )

    return cash_balance, positions, total_value


def serialize_position(position: dict) -> dict:
    return {
        "ticker": position["ticker"],
        "quantity": round(position["quantity"], 4),
        "avg_cost": round(position["avg_cost"], 2),
        "current_price": round(position["current_price"], 2),
        "market_value": round(position["market_value"], 2),
        "unrealized_pnl": round(position["unrealized_pnl"], 2),
    }


async def record_snapshot(db: aiosqlite.Connection, cache: PriceCache) -> None:
    _, _, total_value = await load_portfolio(db, cache)
    await queries.insert_portfolio_snapshot(
        db, DEFAULT_USER_ID, total_value, datetime.now(timezone.utc).isoformat()
    )


@router.get("/portfolio")
async def get_portfolio(
    db: aiosqlite.Connection = Depends(get_db),
    cache: PriceCache = Depends(get_cache),
):
    cash_balance, positions, total_value = await load_portfolio(db, cache)
    return {
        "cash_balance": round(cash_balance, 2),
        "positions": [serialize_position(p) for p in positions],
        "total_value": round(total_value, 2),
    }


@router.get("/portfolio/history")
async def get_portfolio_history(db: aiosqlite.Connection = Depends(get_db)):
    rows = await queries.get_portfolio_history(db, DEFAULT_USER_ID)
    return [
        {"total_value": round(row["total_value"], 2), "recorded_at": row["recorded_at"]}
        for row in rows
    ]


@router.post("/portfolio/trade")
async def execute_trade(
    body: dict,
    db: aiosqlite.Connection = Depends(get_db),
    cache: PriceCache = Depends(get_cache),
    registry: TrackedTickerRegistry = Depends(get_registry),
):
    ticker = str(body.get("ticker", "")).strip().upper()
    side = body.get("side")
    if side not in VALID_SIDES:
        raise HTTPException(400, f"Invalid side: {side!r} (must be 'buy' or 'sell')")

    try:
        quantity = float(body.get("quantity"))
    except (TypeError, ValueError):
        raise HTTPException(400, "quantity must be a number") from None
    if quantity <= 0:
        raise HTTPException(400, "quantity must be positive")

    tick = cache.get(ticker)
    if tick is None:
        raise HTTPException(400, f"No price available for {ticker!r} yet")
    fill_price = tick.price

    cash_balance = await _get_cash_balance(db)
    position = await _get_position(db, ticker)
    existing_quantity = position["quantity"] if position is not None else 0.0
    existing_avg_cost = position["avg_cost"] if position is not None else 0.0

    if side == "buy":
        cost = quantity * fill_price
        if cost > cash_balance:
            raise HTTPException(400, "Insufficient cash for this trade")
        new_cash_balance = cash_balance - cost
        new_quantity = existing_quantity + quantity
        new_avg_cost = (existing_quantity * existing_avg_cost + cost) / new_quantity
    else:
        if quantity > existing_quantity:
            raise HTTPException(400, "Cannot sell more shares than you own")
        proceeds = quantity * fill_price
        new_cash_balance = cash_balance + proceeds
        new_quantity = existing_quantity - quantity
        new_avg_cost = existing_avg_cost

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
        (new_cash_balance, DEFAULT_USER_ID),
    )
    if new_quantity == 0:
        await db.execute(
            "DELETE FROM positions WHERE user_id = ? AND ticker = ?", (DEFAULT_USER_ID, ticker)
        )
    elif position is not None:
        await db.execute(
            "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ? "
            "WHERE user_id = ? AND ticker = ?",
            (new_quantity, new_avg_cost, now, DEFAULT_USER_ID, ticker),
        )
    else:
        await db.execute(
            "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, new_quantity, new_avg_cost, now),
        )
    await db.execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, side, quantity, fill_price, now),
    )
    await db.commit()

    # Write-through: a fresh buy (0 -> >0) must start streaming even if never
    # watchlisted; a full sell-out (>0 -> 0) of an unwatched ticker stops it.
    registry.set_position_ticker(ticker, new_quantity)

    # Snapshot immediately so the P&L chart shows the step change at the fill,
    # rather than waiting up to 60s for the periodic task (PLAN.md §7).
    await record_snapshot(db, cache)

    return {
        "ticker": ticker,
        "side": side,
        "quantity": round(quantity, 4),
        "fill_price": round(fill_price, 2),
        "cash_balance": round(new_cash_balance, 2),
    }
