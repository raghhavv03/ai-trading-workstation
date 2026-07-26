import json

import httpx
import pytest

from app import llm


def _ollama_body(content: str) -> dict:
    return {"message": {"role": "assistant", "content": content}}


class _StubClient:
    """Stands in for httpx.AsyncClient so llm.complete can be exercised without
    a running Ollama. `handler` receives the request kwargs and returns a
    Response or raises."""

    def __init__(self, handler):
        self._handler = handler

    def __call__(self, *_args, **_kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def post(self, url, json=None):
        return self._respond("POST", url, json)

    async def get(self, url):
        return self._respond("GET", url, None)

    def _respond(self, method, url, payload):
        response = self._handler(url, payload)
        response.request = httpx.Request(method, url)
        return response


@pytest.fixture(autouse=True)
def _no_mock(monkeypatch):
    monkeypatch.delenv("LLM_MOCK", raising=False)


@pytest.mark.asyncio
async def test_complete_parses_structured_output(monkeypatch):
    captured = {}

    def _handler(url, payload):
        captured["url"] = url
        captured["payload"] = payload
        return httpx.Response(
            200,
            json=_ollama_body(
                json.dumps(
                    {
                        "message": "Buying now.",
                        "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 3}],
                        "watchlist_changes": [],
                    }
                )
            ),
        )

    monkeypatch.setattr(llm.httpx, "AsyncClient", _StubClient(_handler))
    result = await llm.complete({"cash_balance": 10000.0}, [], "buy 3 AAPL")

    assert result["message"] == "Buying now."
    assert result["trades"] == [{"ticker": "AAPL", "side": "buy", "quantity": 3}]
    assert captured["url"].endswith("/api/chat")
    # Constrained decoding, not bare format:"json" (PLAN.md §9).
    assert captured["payload"]["format"] == llm.RESPONSE_SCHEMA
    assert captured["payload"]["stream"] is False


@pytest.mark.asyncio
async def test_complete_strips_thinking_block(monkeypatch):
    content = '<think>weighing options</think>{"message":"hi","trades":[],"watchlist_changes":[]}'
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        _StubClient(lambda _u, _p: httpx.Response(200, json=_ollama_body(content))),
    )
    result = await llm.complete({}, [], "hi")
    assert result["message"] == "hi"


@pytest.mark.asyncio
async def test_malformed_json_raises_llm_error(monkeypatch):
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        _StubClient(lambda _u, _p: httpx.Response(200, json=_ollama_body("not json at all"))),
    )
    with pytest.raises(llm.LLMError):
        await llm.complete({}, [], "hi")


@pytest.mark.asyncio
async def test_schema_violating_json_raises_llm_error(monkeypatch):
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        _StubClient(lambda _u, _p: httpx.Response(200, json=_ollama_body('{"trades":[]}'))),
    )
    with pytest.raises(llm.LLMError):
        await llm.complete({}, [], "hi")


@pytest.mark.asyncio
async def test_timeout_raises_llm_error(monkeypatch):
    def _timeout(_url, _payload):
        raise httpx.ReadTimeout("too slow")

    monkeypatch.setattr(llm.httpx, "AsyncClient", _StubClient(_timeout))
    with pytest.raises(llm.LLMError):
        await llm.complete({}, [], "hi")


@pytest.mark.asyncio
async def test_http_error_raises_llm_error(monkeypatch):
    monkeypatch.setattr(
        llm.httpx, "AsyncClient", _StubClient(lambda _u, _p: httpx.Response(500, text="boom"))
    )
    with pytest.raises(llm.LLMError):
        await llm.complete({}, [], "hi")


def test_build_messages_orders_system_context_history_then_user():
    history = [{"role": "user", "content": "older"}, {"role": "assistant", "content": "reply"}]
    messages = llm.build_messages({"cash_balance": 1.0}, history, "newest")

    assert [m["role"] for m in messages] == ["system", "system", "user", "assistant", "user"]
    assert messages[-1]["content"] == "newest"
    assert "cash_balance" in messages[1]["content"]


def test_mock_mode_short_circuits_the_http_call(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")

    def _fail(*_args, **_kwargs):
        raise AssertionError("mock mode must not touch the network")

    monkeypatch.setattr(llm.httpx, "AsyncClient", _fail)
    assert llm.is_mock_enabled()


def test_mock_recognizes_trade_and_watchlist_phrasings():
    assert llm.mock_complete("buy 5 aapl")["trades"] == [
        {"ticker": "AAPL", "side": "buy", "quantity": 5.0}
    ]
    assert llm.mock_complete("add PYPL")["watchlist_changes"] == [
        {"ticker": "PYPL", "action": "add"}
    ]
    plain = llm.mock_complete("how is my portfolio?")
    assert plain["trades"] == []
    assert plain["watchlist_changes"] == []


@pytest.mark.asyncio
async def test_check_ollama_reports_unreachable_without_hanging(monkeypatch):
    def _refused(_url, _payload):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(llm.httpx, "AsyncClient", _StubClient(_refused))
    assert await llm.check_ollama() == "unreachable"


@pytest.mark.asyncio
async def test_check_ollama_reports_reachable(monkeypatch):
    monkeypatch.setattr(
        llm.httpx,
        "AsyncClient",
        _StubClient(lambda _u, _p: httpx.Response(200, json={"models": []})),
    )
    assert await llm.check_ollama() == "reachable"
