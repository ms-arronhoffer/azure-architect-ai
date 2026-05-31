"""RAG service: embed + search corpora stored in `rag_documents`.

Stores embeddings as JSON arrays (cross-DB portable); cosine similarity is
computed in Python. The corpus is small (15 reference archs + on-demand Learn
snippets), so a vector index is unnecessary today. Swap to pgvector when the
corpus outgrows a few thousand rows.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import math
from typing import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from data.reference_archs import REFERENCE_ARCHS
from db import RagDocument, session_scope
from middleware.logging import get_logger
from services.docs_service import search_azure_docs
from services.embeddings_service import embed_text, embed_texts

log = get_logger("rag_service")

CORPUS_REFERENCE_ARCHS = "reference_archs"
CORPUS_LEARN = "learn"


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _doc_id(corpus: str, source_id: str) -> str:
    return hashlib.sha1(f"{corpus}:{source_id}".encode("utf-8")).hexdigest()[:32]


def _arch_to_text(arch: dict) -> str:
    parts = [
        arch.get("title", ""),
        arch.get("description", ""),
        "Services: " + ", ".join(arch.get("services", [])),
        "Tags: " + ", ".join(arch.get("tags", [])),
    ]
    return "\n".join(p for p in parts if p)


async def index_documents(
    session: AsyncSession,
    corpus: str,
    docs: Iterable[dict],
    replace: bool = False,
) -> int:
    """Embed and upsert documents. Each doc must have source_id, title, content.
    Optional: url, metadata. Returns count indexed.
    """
    items = list(docs)
    if not items:
        return 0
    if replace:
        await session.execute(delete(RagDocument).where(RagDocument.corpus == corpus))
    vectors = embed_texts([d["content"] for d in items])
    now = dt.datetime.now(dt.UTC)
    for doc, vec in zip(items, vectors):
        doc_id = _doc_id(corpus, doc["source_id"])
        existing = await session.get(RagDocument, doc_id)
        if existing is None:
            session.add(
                RagDocument(
                    id=doc_id,
                    corpus=corpus,
                    source_id=doc["source_id"],
                    title=doc["title"],
                    url=doc.get("url"),
                    content=doc["content"],
                    embedding=vec,
                    doc_metadata=doc.get("metadata", {}),
                    updated_at=now,
                )
            )
        else:
            existing.title = doc["title"]
            existing.url = doc.get("url")
            existing.content = doc["content"]
            existing.embedding = vec
            existing.doc_metadata = doc.get("metadata", {})
            existing.updated_at = now
    await session.commit()
    log.info("rag.indexed", corpus=corpus, count=len(items))
    return len(items)


async def reindex_reference_archs() -> int:
    """Embed all reference architectures. Idempotent."""
    docs = [
        {
            "source_id": arch["id"],
            "title": arch["title"],
            "url": arch.get("learn_url"),
            "content": _arch_to_text(arch),
            "metadata": {
                "category": arch.get("category"),
                "tags": arch.get("tags", []),
                "complexity": arch.get("complexity"),
            },
        }
        for arch in REFERENCE_ARCHS
    ]
    async with session_scope() as session:
        return await index_documents(session, CORPUS_REFERENCE_ARCHS, docs, replace=True)


async def search(
    session: AsyncSession,
    query: str,
    corpora: list[str] | None = None,
    top_k: int | None = None,
) -> list[dict]:
    """Cosine-similarity search across one or more corpora."""
    if not query.strip():
        return []
    k = top_k or settings.rag_top_k
    q_vec = embed_text(query)
    stmt = select(RagDocument)
    if corpora:
        stmt = stmt.where(RagDocument.corpus.in_(corpora))
    rows = (await session.execute(stmt)).scalars().all()
    scored = [
        (_cosine(q_vec, row.embedding), row)
        for row in rows
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "score": score,
            "corpus": row.corpus,
            "source_id": row.source_id,
            "title": row.title,
            "url": row.url,
            "content": row.content,
            "metadata": row.doc_metadata,
        }
        for score, row in scored[:k]
        if score > 0
    ]


async def cached_learn_search(query: str, top: int = 5) -> list[dict]:
    """Search the Learn corpus. On miss, fall through to the live API and
    cache the results so subsequent identical queries are local.
    """
    async with session_scope() as session:
        hits = await search(session, query, corpora=[CORPUS_LEARN], top_k=top)
        if hits:
            return [{"title": h["title"], "url": h["url"], "description": h["content"][:300]} for h in hits]

        live = await search_azure_docs(query, top=top)
        if not live:
            return []
        docs = [
            {
                "source_id": item["url"],
                "title": item["title"],
                "url": item["url"],
                "content": item.get("description", "") or item["title"],
                "metadata": {"query": query},
            }
            for item in live
            if item.get("url")
        ]
        if docs:
            await index_documents(session, CORPUS_LEARN, docs)
        return live


__all__ = [
    "CORPUS_LEARN",
    "CORPUS_REFERENCE_ARCHS",
    "cached_learn_search",
    "index_documents",
    "reindex_reference_archs",
    "search",
]
