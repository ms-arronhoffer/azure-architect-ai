"""Unit tests for the MS Architecture Center ingest pipeline.

Covers `normalize` against representative API payloads and
`upsert_architectures` against an in-memory SQLite to verify that
insert/update/skip semantics work and that user-toggled `featured` flags
survive a refresh.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import db as db_module
from db import RefArch
from services import refarch_ingest

SAMPLE_API_ENTRY = {
    "title": "Multi-region web app",
    "summary": "Highly available web app across paired regions.",
    "url": "/azure/architecture/reference-architectures/app-service-web-app/multi-region",
    "azure_categories": ["web", "networking"],
    "display_products": ["azure-app-service", "azure-front-door"],
    "thumbnail_url": "/azure/architecture/_images/multi-region-thumb.png",
    "content_type": "architecture",
}


def test_normalize_maps_canonical_fields():
    out = refarch_ingest.normalize(SAMPLE_API_ENTRY)
    assert out is not None
    assert out["slug"] == "multi-region"
    assert out["title"] == "Multi-region web app"
    assert out["category"] == "web"
    assert "web" in out["tags"] and "azure-app-service" in out["tags"]
    assert out["services"] == ["azure-app-service", "azure-front-door"]
    assert out["learn_url"].startswith("https://learn.microsoft.com/")
    assert out["diagram_url"].startswith("https://learn.microsoft.com/")
    assert out["source"] == "microsoft_official"


def test_normalize_returns_none_when_missing_required_fields():
    assert refarch_ingest.normalize({"title": "no url"}) is None
    assert refarch_ingest.normalize({"url": "/x/y", "title": ""}) is None
    assert refarch_ingest.normalize({"url": "", "title": "x"}) is None


def test_normalize_handles_absolute_thumbnail_and_no_categories():
    out = refarch_ingest.normalize(
        {
            "title": "Standalone",
            "url": "/azure/architecture/example/standalone",
            "thumbnail_url": "https://cdn.example.com/thumb.png",
        }
    )
    assert out is not None
    assert out["diagram_url"] == "https://cdn.example.com/thumb.png"
    assert out["category"] == "general"
    assert out["tags"] == []


@pytest_asyncio.fixture
async def in_memory_engine(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(db_module.Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    def fake_scope():
        return session_maker()

    monkeypatch.setattr(refarch_ingest, "session_scope", fake_scope)
    yield engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_inserts_new_entries(in_memory_engine):
    entries = [refarch_ingest.normalize(SAMPLE_API_ENTRY)]
    counts = await refarch_ingest.upsert_architectures(entries)
    assert counts == {"inserted": 1, "updated": 0, "unchanged": 0, "skipped": 0}


@pytest.mark.asyncio
async def test_upsert_preserves_featured_flag(in_memory_engine):
    session_maker = async_sessionmaker(in_memory_engine, expire_on_commit=False)
    now = dt.datetime.now(dt.UTC).isoformat()
    async with session_maker() as session:
        session.add(RefArch(
            id=str(uuid.uuid4()), slug="multi-region", title="Old title",
            summary="", category="web", tags=[], services=[], patterns=[],
            waf_score={}, estimated_monthly={}, complexity="Medium",
            learn_url="https://learn.microsoft.com/old", repo_url=None,
            bicep_avm_module=None, diagram_url=None, source="microsoft_official",
            featured=True, created_at=now,
        ))
        await session.commit()

    entries = [refarch_ingest.normalize(SAMPLE_API_ENTRY)]
    counts = await refarch_ingest.upsert_architectures(entries)
    assert counts["updated"] == 1

    async with session_maker() as session:
        row = (await session.execute(
            db_module.select(RefArch).where(RefArch.slug == "multi-region")
        )).scalars().one()
        assert row.featured is True  # user toggle survived
        assert row.title == "Multi-region web app"
        assert row.last_synced_at is not None


@pytest.mark.asyncio
async def test_upsert_skips_custom_and_community(in_memory_engine):
    session_maker = async_sessionmaker(in_memory_engine, expire_on_commit=False)
    now = dt.datetime.now(dt.UTC).isoformat()
    async with session_maker() as session:
        for src in ("custom", "community"):
            session.add(RefArch(
                id=str(uuid.uuid4()), slug=f"keep-{src}", title=f"keep {src}",
                summary="", category="web", tags=[], services=[], patterns=[],
                waf_score={}, estimated_monthly={}, complexity="Medium",
                learn_url="", repo_url=None, bicep_avm_module=None,
                diagram_url=None, source=src, featured=False, created_at=now,
            ))
        await session.commit()

    entries = [
        {**(refarch_ingest.normalize(SAMPLE_API_ENTRY) or {}), "slug": "keep-custom",
         "title": "would-overwrite"},
        {**(refarch_ingest.normalize(SAMPLE_API_ENTRY) or {}), "slug": "keep-community",
         "title": "would-overwrite"},
    ]
    counts = await refarch_ingest.upsert_architectures(entries)
    assert counts["skipped"] == 2

    async with session_maker() as session:
        rows = (await session.execute(db_module.select(RefArch))).scalars().all()
        for r in rows:
            assert r.title.startswith("keep ")  # untouched


@pytest.mark.asyncio
async def test_upsert_marks_unchanged_when_no_diff(in_memory_engine):
    entries = [refarch_ingest.normalize(SAMPLE_API_ENTRY)]
    await refarch_ingest.upsert_architectures(entries)
    counts = await refarch_ingest.upsert_architectures(entries)
    assert counts == {"inserted": 0, "updated": 0, "unchanged": 1, "skipped": 0}
