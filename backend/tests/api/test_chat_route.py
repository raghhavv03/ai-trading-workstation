import json
from datetime import datetime, timezone

import aiosqlite
import pytest
from fastapi import HTTPException

from app import llm
from app.api import chat
from app.db import queries
from app.db.connection import init_db_if_needed
from app.market_data.base import PriceTick
from app.market_data.cache import PriceCache
from app.market_data.tracked_tickers import TrackedTickerRegistry


@pytest.fixture(autouse=True)
def _mock_llm(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")


async def _make_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await init_db_if_needed(db)
    return db


def _registry() -> TrackedTickerRegistry:
    registry = TrackedTickerRegistry()
    registry.load_initial(watchlist=set(), positions=set())
    return registry


async def _seed_price(cache: PriceCache, ticker: str, price: float) -> None:
    await cache.update(
        PriceTick(ticker, price=price, previous_price=price, timestamp=datetime.now(timezone.utc))
    )


@pytest.mark.asyncio
async def test_chat_happy_path_persists_both_turns():
    db = await _make_db()
    result = await chat.send_message({"message": "how am I doing?"}, db, PriceCache(), _registry())

    assert "how am I doing?" in result["message"]
    assert result["actions"] == {"trades": [], "watchlist_changes": []}

    history = await chat.get_chat_history(db)
    assert [row["role"] for row in history] == ["user", "assistant"]
    assert history[0]["content"] == "how am I doing?"
    assert history[1]["actions"] == {"trades": [], "watchlist_changes": []}
    await db.close()


@pytest.mark.asyncio
async def test_empty_message_is_rejected():
    db = await _make_db()
    with pytest.raises(HTTPException) as exc_info:
        await chat.send_message({"message": "   "}, db, PriceCache(), _registry())
    assert exc_info.value.status_code == 400
    await db.close()


@pytest.mark.asyncio
async def test_chat_auto_executes_a_trade():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)

    result = await chat.send_message({"message": "buy 10 AAPL"}, db, cache, registry)

    trade = result["actions"]["trades"][0]
    assert trade["status"] == "executed"
    assert trade["fill_price"] == 200.0
    assert trade["cash_balance"] == 8000.0
    assert registry.get() == {"AAPL"}
    await db.close()


@pytest.mark.asyncio
async def test_chat_trade_is_validated_exactly_like_a_manual_trade():
    db = await _make_db()
    cache = PriceCache()
    registry = _registry()
    await _seed_price(cache, "AAPL", 200.0)

    result = await chat.send_message({"message": "buy 1000 AAPL"}, db, cache, registry)

    trade = result["actions"]["trades"][0]
    assert trade["status"] == "rejected"
    assert trade["error"] == "Insufficient cash for this trade"
    # The rejected sub-action must not sink the turn: the reply still comes back.
    assert result["message"]

    rows = await db.execute_fetchall("SELECT * FROM positions")
    assert rows == []
    await db.close()


@pytest.mark.asyncio
async def test_chat_applies_watchlist_changes():
    db = await _make_db()
    registry = _registry()
    result = await chat.send_message({"message": "add PYPL"}, db, PriceCache(), registry)

    assert result["actions"]["watchlist_changes"] == [
        {"ticker": "PYPL", "action": "add", "status": "applied"}
    ]
    assert "PYPL" in registry.get()
    await db.close()


@pytest.mark.asyncio
async def test_chat_reports_rejected_watchlist_change_without_failing_the_turn(monkeypatch):
    db = await _make_db()
    registry = _registry()
    monkeypatch.setattr(
        llm,
        "mock_complete",
        lambda _msg: {
            "message": "adding",
            "trades": [],
            "watchlist_changes": [{"ticker": "TOOLONG", "action": "add"}],
        },
    )

    result = await chat.send_message({"message": "add TOOLONG"}, db, PriceCache(), registry)

    change = result["actions"]["watchlist_changes"][0]
    assert change["status"] == "rejected"
    assert "Invalid ticker format" in change["error"]
    await db.close()


@pytest.mark.asyncio
async def test_chat_falls_back_when_the_llm_fails(monkeypatch):
    db = await _make_db()

    async def _boom(*_args, **_kwargs):
        raise llm.LLMError("timed out")

    monkeypatch.setattr(llm, "complete", _boom)

    result = await chat.send_message({"message": "buy 10 AAPL"}, db, PriceCache(), _registry())

    assert result["message"] == llm.FALLBACK_MESSAGE
    assert result["actions"] == {"trades": [], "watchlist_changes": []}

    # The fallback turn is persisted like any other assistant response (PLAN.md §9).
    history = await chat.get_chat_history(db)
    assert history[-1]["role"] == "assistant"
    assert history[-1]["content"] == llm.FALLBACK_MESSAGE
    await db.close()


@pytest.mark.asyncio
async def test_prompt_history_excludes_the_current_user_message(monkeypatch):
    db = await _make_db()
    await queries.insert_chat_message(db, "default", "user", "earlier question")
    captured = {}

    def _capture(portfolio_context, history, user_message):
        captured["history"] = history
        captured["context"] = portfolio_context
        return {"message": "ok", "trades": [], "watchlist_changes": []}

    async def _complete(portfolio_context, history, user_message):
        return _capture(portfolio_context, history, user_message)

    monkeypatch.setattr(llm, "complete", _complete)
    await chat.send_message({"message": "new question"}, db, PriceCache(), _registry())

    assert [row["content"] for row in captured["history"]] == ["earlier question"]
    assert captured["context"]["cash_balance"] == 10000.0
    assert len(captured["context"]["watchlist"]) == 10
    await db.close()


@pytest.mark.asyncio
async def test_history_decodes_actions_json():
    db = await _make_db()
    await queries.insert_chat_message(
        db, "default", "assistant", "done", json.dumps({"trades": [], "watchlist_changes": []})
    )
    history = await chat.get_chat_history(db)
    assert history[0]["actions"] == {"trades": [], "watchlist_changes": []}
    await db.close()
