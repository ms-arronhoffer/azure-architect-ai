"""Unit tests for the three-tier read path in services.whats_new_service.

Covers:
- Hot in-memory cache returns without touching DB or network.
- DB hit returns DB items without calling _fetch_live.
- DB miss falls through to _fetch_live and persists the result.
- force_refresh=True bypasses both caches and re-fetches + persists.
"""
from __future__ import annotations

import time

import pytest

from services import whats_new_service as svc


@pytest.fixture(autouse=True)
def _reset_in_memory_cache():
    """Each test starts with a clean in-memory cache."""
    svc._cache = {}
    svc._cache_time = 0.0
    yield
    svc._cache = {}
    svc._cache_time = 0.0


def _mk_item(item_id: str, title: str = "t") -> dict:
    return {
        "id": item_id,
        "title": title,
        "description": "",
        "url": f"https://example.com/{item_id}",
        "pub_date": "",
        "source": "test",
        "source_label": "Test",
    }


@pytest.mark.asyncio
async def test_hot_cache_short_circuits(monkeypatch):
    """When in-memory cache is fresh, neither DB nor network is consulted."""
    svc._cache = {"a": _mk_item("a")}
    svc._cache_time = time.monotonic()

    async def fail_db():
        raise AssertionError("DB should not be touched on hot cache hit")

    async def fail_live():
        raise AssertionError("Live fetch should not run on hot cache hit")

    monkeypatch.setattr(svc, "_load_from_db", fail_db)
    monkeypatch.setattr(svc, "_fetch_live", fail_live)

    items = await svc.fetch_announcements()
    assert items == [_mk_item("a")]


@pytest.mark.asyncio
async def test_db_hit_returns_db_items(monkeypatch):
    """Cold in-memory + warm DB = DB items returned, no live fetch."""
    persisted: list[list[dict]] = []

    async def fake_load_from_db():
        import datetime as dt
        return [_mk_item("from-db")], dt.datetime(2026, 6, 19)

    async def fail_live():
        raise AssertionError("Live fetch should not run when DB has data")

    async def fake_persist(items):
        persisted.append(items)

    monkeypatch.setattr(svc, "_load_from_db", fake_load_from_db)
    monkeypatch.setattr(svc, "_fetch_live", fail_live)
    monkeypatch.setattr(svc, "_persist_to_db", fake_persist)

    items = await svc.fetch_announcements()

    assert items == [_mk_item("from-db")]
    assert persisted == [], "DB read path must not write back"
    # Hot cache should now be populated.
    assert svc._cache == {"from-db": _mk_item("from-db")}


@pytest.mark.asyncio
async def test_db_miss_falls_through_to_live_and_persists(monkeypatch):
    """Cold in-memory + empty DB = call _fetch_live, persist, populate hot cache."""
    persisted: list[list[dict]] = []

    async def empty_db():
        return [], None

    async def fake_live():
        return [_mk_item("live-1"), _mk_item("live-2")]

    async def fake_persist(items):
        persisted.append(items)

    monkeypatch.setattr(svc, "_load_from_db", empty_db)
    monkeypatch.setattr(svc, "_fetch_live", fake_live)
    monkeypatch.setattr(svc, "_persist_to_db", fake_persist)

    items = await svc.fetch_announcements()

    assert {it["id"] for it in items} == {"live-1", "live-2"}
    assert len(persisted) == 1
    assert {it["id"] for it in persisted[0]} == {"live-1", "live-2"}


@pytest.mark.asyncio
async def test_force_refresh_bypasses_everything(monkeypatch):
    """force_refresh=True: skip hot AND DB caches, call live, then persist."""
    svc._cache = {"old": _mk_item("old")}
    svc._cache_time = time.monotonic()

    db_calls: list[int] = []
    persisted: list[list[dict]] = []

    async def fake_load_from_db():
        db_calls.append(1)
        return [_mk_item("from-db")], None

    async def fake_live():
        return [_mk_item("fresh")]

    async def fake_persist(items):
        persisted.append(items)

    monkeypatch.setattr(svc, "_load_from_db", fake_load_from_db)
    monkeypatch.setattr(svc, "_fetch_live", fake_live)
    monkeypatch.setattr(svc, "_persist_to_db", fake_persist)

    items = await svc.fetch_announcements(force_refresh=True)

    assert items == [_mk_item("fresh")]
    assert db_calls == [], "force_refresh must skip the DB read"
    assert len(persisted) == 1
    assert persisted[0] == [_mk_item("fresh")]
    assert svc._cache == {"fresh": _mk_item("fresh")}


@pytest.mark.asyncio
async def test_db_read_failure_falls_through_to_live(monkeypatch):
    """If _load_from_db raises, we log and fall through to a live fetch."""
    async def boom_db():
        raise RuntimeError("db down")

    async def fake_live():
        return [_mk_item("recovered")]

    async def fake_persist(items):
        pass

    monkeypatch.setattr(svc, "_load_from_db", boom_db)
    monkeypatch.setattr(svc, "_fetch_live", fake_live)
    monkeypatch.setattr(svc, "_persist_to_db", fake_persist)

    items = await svc.fetch_announcements()
    assert items == [_mk_item("recovered")]
