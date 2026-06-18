"""Unit tests for the awesome-azd ingest pipeline.

Covers `normalize` against representative templates.json entries and
`upsert_demos` against an in-memory SQLite to verify that insert/update/
skip semantics work and that user-toggled `featured` flags survive a
refresh.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import db as db_module
from db import Demo
from services import demo_ingest

SAMPLE_MSFT_ENTRY = {
    "title": "WordPress with Azure Container Apps",
    "description": "A blueprint to easily and quickly create a WordPress site on ACA.",
    "preview": "./templates/images/apptemplate-wordpress-on-ACA.png",
    "author": "Konstantinos Pantos",
    "authorUrl": "https://github.com/kpantos",
    "source": "https://github.com/Azure-Samples/apptemplate-wordpress-on-ACA",
    "tags": ["msft"],
    "languages": ["php", "javascript"],
    "azureServices": ["aca", "keyvault"],
    "IaC": ["bicep"],
    "id": "729d2ab2-7326-4cdd-81be-540e4bc7c8c7",
}


def test_normalize_maps_canonical_fields():
    out = demo_ingest.normalize(SAMPLE_MSFT_ENTRY)
    assert out is not None
    assert out["id"] == "azd-729d2ab2-7326-4cdd-81be-540e4bc7c8c7"
    assert out["title"] == "WordPress with Azure Container Apps"
    assert out["repo_url"] == "https://github.com/Azure-Samples/apptemplate-wordpress-on-ACA"
    assert out["source"] == "microsoft_official"
    assert out["video_url"] is None
    assert out["live_url"] is None
    # Flattened tags: IaC + languages + azureServices, "msft" dropped, sorted
    assert "bicep" in out["tags"]
    assert "php" in out["tags"]
    assert "aca" in out["tags"]
    assert "msft" not in out["tags"]
    assert out["tags"] == sorted(out["tags"])
    # Relative preview resolved to absolute URL
    assert out["thumbnail_url"] == (
        "https://azure.github.io/awesome-azd/templates/images/apptemplate-wordpress-on-ACA.png"
    )


def test_normalize_returns_none_for_non_msft():
    entry = {**SAMPLE_MSFT_ENTRY, "tags": ["community"]}
    assert demo_ingest.normalize(entry) is None


def test_normalize_returns_none_for_missing_required():
    assert demo_ingest.normalize({"tags": ["msft"], "title": "", "source": "x", "id": "1"}) is None
    assert demo_ingest.normalize({"tags": ["msft"], "title": "x", "source": "", "id": "1"}) is None
    assert demo_ingest.normalize({"tags": ["msft"], "title": "x", "source": "x", "id": ""}) is None


def test_normalize_passes_through_absolute_preview():
    entry = {**SAMPLE_MSFT_ENTRY, "preview": "https://cdn.example.com/p.png"}
    out = demo_ingest.normalize(entry)
    assert out is not None
    assert out["thumbnail_url"] == "https://cdn.example.com/p.png"


def test_normalize_handles_missing_preview():
    entry = {**SAMPLE_MSFT_ENTRY}
    entry.pop("preview")
    out = demo_ingest.normalize(entry)
    assert out is not None
    assert out["thumbnail_url"] is None


@pytest_asyncio.fixture
async def in_memory_engine(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(db_module.Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    def fake_scope():
        return session_maker()

    monkeypatch.setattr(demo_ingest, "session_scope", fake_scope)
    yield engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_inserts_new_entries(in_memory_engine):
    entries = [demo_ingest.normalize(SAMPLE_MSFT_ENTRY)]
    counts = await demo_ingest.upsert_demos(entries)
    assert counts == {"inserted": 1, "updated": 0, "unchanged": 0, "skipped": 0}


@pytest.mark.asyncio
async def test_upsert_preserves_featured_flag(in_memory_engine):
    session_maker = async_sessionmaker(in_memory_engine, expire_on_commit=False)
    demo_id = f"azd-{SAMPLE_MSFT_ENTRY['id']}"
    async with session_maker() as session:
        session.add(Demo(
            id=demo_id, title="Old title", description="old", tags=[],
            video_url=None, repo_url="https://old.example", live_url=None,
            thumbnail_url=None, featured=True, created_at="2026-01-01T00:00:00Z",
            source="microsoft_official",
        ))
        await session.commit()

    entries = [demo_ingest.normalize(SAMPLE_MSFT_ENTRY)]
    counts = await demo_ingest.upsert_demos(entries)
    assert counts["updated"] == 1

    async with session_maker() as session:
        row = (await session.execute(
            db_module.select(Demo).where(Demo.id == demo_id)
        )).scalars().one()
        assert row.featured is True  # user toggle survived
        assert row.title == "WordPress with Azure Container Apps"
        assert row.last_synced_at is not None


@pytest.mark.asyncio
async def test_upsert_skips_custom_and_community(in_memory_engine):
    session_maker = async_sessionmaker(in_memory_engine, expire_on_commit=False)
    demo_id = f"azd-{SAMPLE_MSFT_ENTRY['id']}"
    async with session_maker() as session:
        session.add(Demo(
            id=demo_id, title="keep me", description="user-owned", tags=[],
            video_url=None, repo_url=None, live_url=None, thumbnail_url=None,
            featured=False, created_at="2026-01-01T00:00:00Z", source="custom",
        ))
        await session.commit()

    entries = [demo_ingest.normalize(SAMPLE_MSFT_ENTRY)]
    counts = await demo_ingest.upsert_demos(entries)
    assert counts["skipped"] == 1

    async with session_maker() as session:
        row = (await session.execute(
            db_module.select(Demo).where(Demo.id == demo_id)
        )).scalars().one()
        assert row.title == "keep me"  # untouched
        assert row.source == "custom"


@pytest.mark.asyncio
async def test_upsert_marks_unchanged_when_no_diff(in_memory_engine):
    entries = [demo_ingest.normalize(SAMPLE_MSFT_ENTRY)]
    await demo_ingest.upsert_demos(entries)
    counts = await demo_ingest.upsert_demos(entries)
    assert counts == {"inserted": 0, "updated": 0, "unchanged": 1, "skipped": 0}
