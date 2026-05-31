"""RAG search test with mocked embeddings + in-memory SQLite."""
from __future__ import annotations

import asyncio
import datetime as dt

import pytest


@pytest.mark.asyncio
async def test_search_returns_highest_scoring(monkeypatch, tmp_sqlite_db):
    # Monkeypatch embeddings_service.embed_text BEFORE rag_service uses it.
    import services.embeddings_service as emb
    from services import rag_service

    # Two synthetic docs: one identical to the query vector, one orthogonal.
    fixed_query_vec = [1.0, 0.0, 0.0]
    monkeypatch.setattr(emb, "embed_text", lambda text: fixed_query_vec)
    monkeypatch.setattr(rag_service, "embed_text", lambda text: fixed_query_vec)

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    _url, engine = tmp_sqlite_db
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    import db as db_module

    async with SessionLocal() as session:
        session.add(
            db_module.RagDocument(
                id="doc_match",
                corpus="reference_archs",
                source_id="match",
                title="Matching Doc",
                url=None,
                content="match content",
                embedding=[1.0, 0.0, 0.0],
                doc_metadata={},
                updated_at=dt.datetime.now(dt.UTC),
            )
        )
        session.add(
            db_module.RagDocument(
                id="doc_other",
                corpus="reference_archs",
                source_id="other",
                title="Other Doc",
                url=None,
                content="other content",
                embedding=[0.0, 1.0, 0.0],
                doc_metadata={},
                updated_at=dt.datetime.now(dt.UTC),
            )
        )
        await session.commit()

        results = await rag_service.search(session, "query", top_k=1)
        assert len(results) == 1
        assert results[0]["source_id"] == "match"
