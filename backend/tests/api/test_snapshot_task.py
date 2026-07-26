import asyncio
import contextlib

import pytest

from app import main
from app.market_data.cache import PriceCache


async def _run_loop_briefly(monkeypatch, record):
    monkeypatch.setattr(main, "SNAPSHOT_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(main.portfolio, "record_snapshot", record)

    task = asyncio.create_task(main._snapshot_loop(db=None, cache=PriceCache()))
    await asyncio.sleep(0.1)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_loop_records_snapshots_on_the_interval(monkeypatch):
    calls = []

    async def _record(db, cache):
        calls.append(cache)

    await _run_loop_briefly(monkeypatch, _record)
    assert len(calls) >= 2


@pytest.mark.asyncio
async def test_a_failing_snapshot_does_not_kill_the_loop(monkeypatch):
    calls = []

    async def _record(db, cache):
        calls.append(cache)
        raise RuntimeError("database is locked")

    await _run_loop_briefly(monkeypatch, _record)
    # Kept going after the first failure rather than dying with it.
    assert len(calls) >= 2
