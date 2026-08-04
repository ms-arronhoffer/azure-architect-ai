"""Tests for the daily-refreshed Foundry model retirement schedule.

Covers the Markdown parser (section → provider/soldBy mapping, dedupe,
placeholder cells) and the freshness contract of `fetch_lifecycle()`:
DB rows younger than 24h are served as-is, older rows trigger a live refresh,
and a failed fetch degrades to the last known data instead of an empty table.
"""
from __future__ import annotations

import datetime as dt

import pytest

from services import model_lifecycle_service as svc

SAMPLE = """
This article lists the retirement schedule for Foundry Models.

## Foundry Models sold by Azure

### Azure OpenAI

| Model | Version | Lifecycle | Retirement date | Replacement |
|-------|---------|-----------|-----------------|-------------|
| gpt-4o | 2024-05-13 | Deprecated | 2026-10-01 | gpt-5.1 |
| gpt-4o | 2024-05-13 | Deprecated | 2026-10-01 | gpt-5.1 |
| gpt-5 | 2025-08-07 | ga | 2027-02-09 | — |
| grok-code | — | GA | — | — |

#### Fine-tuned models

| Model | Version | Training retirement date | Deployment retirement date |
|-------|---------|--------------------------|----------------------------|
| gpt-4.1 | 2025-04-14 | No earlier than 2027-04-14<sup>1</sup> | 2027-10-14 |

### xAI

| Model | Version | Lifecycle | Retirement date | Replacement |
|-------|---------|-----------|-----------------|-------------|
| grok-4-fast | 1 | Retired | 2026-05-01 | grok-4-1-fast |

## Foundry Models from partners and community

### Anthropic

| Model | Version | Lifecycle | Retirement date | Replacement |
|-------|---------|-----------|-----------------|-------------|
| claude-opus-4-1 | — | Preview | No earlier than 2026-08-05 | [claude-opus-4-8](../foo.md) |

## Related content

- [Retired Foundry Models](../concepts/retired-models.md)
"""


def test_parse_maps_sections_to_provider_and_sold_by():
    entries = svc.parse_schedule_markdown(SAMPLE)
    by_model = {e["model"]: e for e in entries}

    assert by_model["gpt-4o"]["provider"] == "Azure OpenAI"
    assert by_model["gpt-4o"]["soldBy"] == "Azure"
    assert by_model["grok-4-fast"]["provider"] == "xAI"
    assert by_model["claude-opus-4-1"]["provider"] == "Anthropic"
    assert by_model["claude-opus-4-1"]["soldBy"] == "Partner"


def test_parse_normalizes_cells():
    entries = svc.parse_schedule_markdown(SAMPLE)
    by_model = {e["model"]: e for e in entries}

    # lifecycle casing normalized, em-dash placeholders → None
    assert by_model["gpt-5"]["lifecycle"] == "GA"
    assert by_model["gpt-5"]["replacement"] is None
    assert by_model["grok-code"]["retirement"] is None
    assert by_model["grok-code"]["version"] == "—"
    # footnote markup stripped, first ISO date wins, markdown link unwrapped
    assert by_model["claude-opus-4-1"]["retirement"] == "2026-08-05"
    assert by_model["claude-opus-4-1"]["replacement"] == "claude-opus-4-8"


def test_parse_dedupes_repeated_rows_and_skips_other_tables():
    entries = svc.parse_schedule_markdown(SAMPLE)
    assert [e["model"] for e in entries].count("gpt-4o") == 1
    # the fine-tuned table has a different column layout — never emitted
    assert all(e["model"] != "gpt-4.1" for e in entries)


def test_parse_ignores_rows_outside_a_provider_section():
    entries = svc.parse_schedule_markdown(
        "| stray | 1 | GA | 2026-01-01 | — |\n"
    )
    assert entries == []


@pytest.fixture(autouse=True)
def _clear_memory_cache():
    svc.reset_cache()
    yield
    svc.reset_cache()


def _entry(model: str) -> dict:
    return {
        "provider": "Azure OpenAI",
        "model": model,
        "version": "1",
        "lifecycle": "GA",
        "retirement": "2027-01-01",
        "replacement": None,
        "soldBy": "Azure",
    }


@pytest.mark.asyncio
async def test_fetch_serves_fresh_db_rows_without_network(monkeypatch):
    fetched_at = svc._now() - dt.timedelta(hours=2)

    async def _db():
        return [_entry("cached")], fetched_at

    async def _live():
        raise AssertionError("should not hit the network for fresh rows")

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)

    result = await svc.fetch_lifecycle()
    assert result["count"] == 1
    assert result["stale"] is False
    assert result["models"][0]["model"] == "cached"


@pytest.mark.asyncio
async def test_fetch_refreshes_when_db_rows_are_a_day_old(monkeypatch):
    stale_at = svc._now() - dt.timedelta(hours=25)
    persisted: list[list[dict]] = []

    async def _db():
        return [_entry("cached")], stale_at

    async def _live():
        return [_entry("fresh")]

    async def _persist(models):
        persisted.append(models)

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)
    monkeypatch.setattr(svc, "_persist_to_db", _persist)

    result = await svc.fetch_lifecycle()
    assert result["models"][0]["model"] == "fresh"
    assert result["stale"] is False
    assert persisted == [[_entry("fresh")]]


@pytest.mark.asyncio
async def test_fetch_falls_back_to_last_known_rows_when_live_fails(monkeypatch):
    stale_at = svc._now() - dt.timedelta(days=3)

    async def _db():
        return [_entry("cached")], stale_at

    async def _live():
        return []

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)

    result = await svc.fetch_lifecycle()
    assert result["models"][0]["model"] == "cached"
    assert result["stale"] is True


@pytest.mark.asyncio
async def test_fetch_falls_back_to_seed_when_db_and_network_unavailable(monkeypatch):
    async def _db():
        raise RuntimeError("no database")

    async def _live():
        return []

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)

    result = await svc.fetch_lifecycle()
    assert result["count"] > 0
    assert result["stale"] is True
    assert result["source_url"] == svc.LEARN_URL


@pytest.mark.asyncio
async def test_memory_cache_avoids_repeat_work(monkeypatch):
    calls = {"n": 0}
    fetched_at = svc._now()

    async def _db():
        calls["n"] += 1
        return [_entry("cached")], fetched_at

    monkeypatch.setattr(svc, "_load_from_db", _db)

    await svc.fetch_lifecycle()
    await svc.fetch_lifecycle()
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_force_refresh_bypasses_fresh_db_rows(monkeypatch):
    """The Refresh button must pull from Learn, not replay the day-old cache."""
    fetched_at = svc._now() - dt.timedelta(hours=2)

    async def _db():
        return [_entry("cached")], fetched_at

    async def _live():
        return [_entry("fresh")]

    async def _persist(models):
        return None

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)
    monkeypatch.setattr(svc, "_persist_to_db", _persist)

    result = await svc.fetch_lifecycle(force_refresh=True)
    assert result["models"][0]["model"] == "fresh"
    assert result["stale"] is False


@pytest.mark.asyncio
async def test_back_to_back_force_refresh_is_throttled(monkeypatch):
    """Repeated Refresh clicks must not hammer the docs source."""
    calls = {"n": 0}

    async def _db():
        return [], None

    async def _live():
        calls["n"] += 1
        return [_entry("fresh")]

    async def _persist(models):
        return None

    monkeypatch.setattr(svc, "_load_from_db", _db)
    monkeypatch.setattr(svc, "_fetch_live", _live)
    monkeypatch.setattr(svc, "_persist_to_db", _persist)

    await svc.fetch_lifecycle(force_refresh=True)
    await svc.fetch_lifecycle(force_refresh=True)
    assert calls["n"] == 1
