from __future__ import annotations

import json
import os
import re

import httpx

DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:8b"
DEFAULT_TIMEOUT_SECONDS = 60.0
HEALTH_CHECK_TIMEOUT_SECONDS = 2.0

FALLBACK_MESSAGE = "Sorry, I had trouble processing that. Could you rephrase?"

SYSTEM_PROMPT = """You are FinAlly, an AI trading assistant embedded in a simulated \
trading workstation. The user trades a virtual $10,000 portfolio; there is no real money \
at stake.

Your job:
- Analyze portfolio composition, risk concentration, and P&L.
- Suggest trades with concrete reasoning grounded in the data you are given.
- Execute trades when the user asks for them or agrees to a suggestion.
- Manage the watchlist proactively when it helps the conversation.
- Be concise and data-driven. No filler, no disclaimers about financial advice.

Only market orders are supported: every trade fills instantly at the current price.

Rules for actions -- these are executed for real the moment you emit them:
- Put a trade in `trades` ONLY when the user asked for it or agreed to it. Never trade \
merely because you mentioned an idea.
- `trades` and `watchlist_changes` are completely independent. Buying or selling a \
ticker must NEVER produce a watchlist change. Only put something in \
`watchlist_changes` when the user explicitly asked to add or remove a ticker from \
their watchlist.
- Never emit a "remove" watchlist change unless the user explicitly asked to stop \
watching that ticker.
- Leave both arrays empty when the turn is purely conversational."""

# Constrained decoding: passed as Ollama's `format`, so an 8B model emits
# schema-valid JSON by construction rather than by prompt obedience (PLAN.md §9).
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "trades": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "number"},
                },
                "required": ["ticker", "side", "quantity"],
            },
        },
        "watchlist_changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "action": {"type": "string", "enum": ["add", "remove"]},
                },
                "required": ["ticker", "action"],
            },
        },
    },
    "required": ["message", "trades", "watchlist_changes"],
}

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMError(Exception):
    """Any failure to obtain a usable structured response -- transport error,
    timeout, non-200, or unparseable body. Callers fall back, never retry."""


def is_mock_enabled() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() == "true"


def base_url() -> str:
    return os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL).rstrip("/")


def _model() -> str:
    return os.environ.get("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)


def _timeout() -> float:
    try:
        return float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


async def check_ollama() -> str:
    """Cheap reachability probe for /api/health. Short timeout so a hung or
    missing Ollama can never stall the health check itself (PLAN.md §13)."""
    try:
        async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT_SECONDS) as client:
            response = await client.get(f"{base_url()}/api/tags")
        return "reachable" if response.status_code == 200 else "unreachable"
    except Exception:
        return "unreachable"


def build_messages(
    portfolio_context: dict, history: list[dict], user_message: str
) -> list[dict]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "system",
            "content": "Current portfolio state:\n"
            + json.dumps(portfolio_context, indent=2, default=str),
        },
    ]
    for entry in history:
        if entry["role"] in ("user", "assistant"):
            messages.append({"role": entry["role"], "content": entry["content"]})
    messages.append({"role": "user", "content": user_message})
    return messages


def _parse(content: str) -> dict:
    cleaned = _THINK_BLOCK.sub("", content).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Response was not valid JSON: {cleaned[:500]!r}") from exc
    if not isinstance(parsed, dict) or not isinstance(parsed.get("message"), str):
        raise LLMError(f"Response did not match the expected schema: {cleaned[:500]!r}")
    return {
        "message": parsed["message"],
        "trades": parsed.get("trades") or [],
        "watchlist_changes": parsed.get("watchlist_changes") or [],
    }


async def complete(portfolio_context: dict, history: list[dict], user_message: str) -> dict:
    if is_mock_enabled():
        return mock_complete(user_message)

    payload = {
        "model": _model(),
        "messages": build_messages(portfolio_context, history, user_message),
        "stream": False,
        "format": RESPONSE_SCHEMA,
    }
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            response = await client.post(f"{base_url()}/api/chat", json=payload)
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        raise LLMError(f"Ollama request failed: {exc}") from exc

    content = (body.get("message") or {}).get("content")
    if not isinstance(content, str):
        raise LLMError(f"Ollama response had no message content: {body!r}")
    return _parse(content)


_MOCK_TRADE = re.compile(
    r"\b(buy|sell)\s+([\d.]+)\s+(?:shares?\s+(?:of\s+)?)?([A-Za-z]{1,5})\b", re.I
)
_MOCK_WATCHLIST = re.compile(r"\b(add|remove)\s+([A-Za-z]{1,5})\b", re.I)


def mock_complete(user_message: str) -> dict:
    """Deterministic stand-in for Ollama under LLM_MOCK=true. It recognizes two
    literal phrasings -- "buy 5 AAPL" and "add PYPL" -- so E2E tests can drive the
    auto-execution path end to end without a model; anything else is a plain reply."""
    trades = [
        {"ticker": ticker.upper(), "side": side.lower(), "quantity": float(quantity)}
        for side, quantity, ticker in _MOCK_TRADE.findall(user_message)
    ]
    watchlist_changes = []
    if not trades:
        watchlist_changes = [
            {"ticker": ticker.upper(), "action": action.lower()}
            for action, ticker in _MOCK_WATCHLIST.findall(user_message)
        ]

    if trades:
        message = f"[mock] Executing {len(trades)} trade(s) as requested."
    elif watchlist_changes:
        message = f"[mock] Applying {len(watchlist_changes)} watchlist change(s)."
    else:
        message = f"[mock] FinAlly received: {user_message}"

    return {"message": message, "trades": trades, "watchlist_changes": watchlist_changes}
