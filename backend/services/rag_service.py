"""RAG service: embed + search corpora stored in `rag_documents`.

Stores embeddings as JSON arrays (cross-DB portable); cosine similarity is
computed in Python. The corpus is small (15 reference archs + on-demand Learn
snippets), so a vector index is unnecessary today. Swap to pgvector when the
corpus outgrows a few thousand rows.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import math
import time
from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from data.reference_archs import REFERENCE_ARCHS
from db import RagDocument, session_scope
from middleware.logging import get_logger
from observability import rag_cache_hit_latency_histogram, tracer
from services.docs_service import search_azure_docs
from services.embeddings_service import embed_text, embed_texts

log = get_logger("rag_service")

CORPUS_REFERENCE_ARCHS = "reference_archs"
CORPUS_LEARN = "learn"
CORPUS_AZURE_UPDATES = "azure_updates"
CORPUS_AVM = "avm"
CORPUS_TENANT_INVENTORY = "tenant_inventory"

# Corpora that the chat citation flow searches in addition to the live Learn
# fallback. Ordered for documentation; the merger sorts by cosine score.
CITATION_CORPORA = (CORPUS_LEARN, CORPUS_AZURE_UPDATES, CORPUS_AVM, CORPUS_REFERENCE_ARCHS)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _doc_id(corpus: str, source_id: str) -> str:
    return hashlib.sha1(f"{corpus}:{source_id}".encode()).hexdigest()[:32]


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
    engagement_id: str | None = None,
) -> int:
    """Embed and upsert documents. Each doc must have source_id, title, content.
    Optional: url, metadata. Returns count indexed.

    When ``engagement_id`` is provided, each persisted row is stamped with it
    (used by the ``tenant_inventory`` corpus for per-engagement isolation).
    """
    items = list(docs)
    if not items:
        return 0
    if replace:
        stmt = delete(RagDocument).where(RagDocument.corpus == corpus)
        if engagement_id is not None:
            stmt = stmt.where(RagDocument.engagement_id == engagement_id)
        await session.execute(stmt)
    try:
        vectors = embed_texts([d["content"] for d in items])
    except Exception as e:
        log.warning("rag.index_embed_failed", corpus=corpus, error=str(e))
        return 0
    now = dt.datetime.now(dt.UTC).replace(tzinfo=None)
    for doc, vec in zip(items, vectors, strict=True):
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
                    engagement_id=engagement_id,
                    updated_at=now,
                )
            )
        else:
            existing.title = doc["title"]
            existing.url = doc.get("url")
            existing.content = doc["content"]
            existing.embedding = vec
            existing.doc_metadata = doc.get("metadata", {})
            if engagement_id is not None:
                existing.engagement_id = engagement_id
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
    k = top_k or settings.rag_top_k
    with tracer.start_as_current_span(
        "rag.search",
        attributes={"rag.top_k": k, "rag.query_len": len(query)},
    ):
        start = time.perf_counter()
        if not query.strip():
            return []
        try:
            q_vec = embed_text(query)
        except Exception as e:
            log.warning("rag.embed_failed", error=str(e))
            return []
        stmt = select(RagDocument)
        if corpora:
            stmt = stmt.where(RagDocument.corpus.in_(corpora))
        rows = (await session.execute(stmt)).scalars().all()
        scored = [
            (_cosine(q_vec, row.embedding), row)
            for row in rows
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        result = [
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
        with contextlib.suppress(Exception):
            rag_cache_hit_latency_histogram.record((time.perf_counter() - start) * 1000.0)
        return result


# Reciprocal Rank Fusion constant: keeps top-of-list dominance modest so a
# strong-but-not-#1 lexical hit can still beat a marginal cosine winner.
_RRF_K = 60
# When the merged top hit's RRF score sits below this, treat as "no good
# match" -- caller decides whether to swap in honesty mode.
_DEFAULT_CONFIDENCE_FLOOR = 0.02


async def hybrid_search(
    session: AsyncSession,
    query: str,
    corpora: list[str] | None = None,
    top_k: int = 30,
    confidence_floor: float | None = None,
    engagement_id: str | None = None,
) -> dict:
    """RRF-merge cosine + rapidfuzz token-set lexical scoring.

    Returns ``{"hits": list[dict], "unknown": bool, "top_score": float}``.
    Each hit carries the merged ``score`` (RRF) plus the constituent
    ``cosine``/``lexical`` scores for debugging. ``unknown`` is True when
    the strongest hit's RRF score is below ``confidence_floor``.

    ``engagement_id`` filters the ``tenant_inventory`` corpus: only chunks
    stamped with the active engagement come back, while public corpora
    (learn / avm / refarchs / azure_updates) remain visible. When omitted,
    falls back to ``engagement_id_var`` so chat/architecture routes don't
    have to thread it manually.
    """
    from rapidfuzz import fuzz
    from sqlalchemy import or_

    from db import RagDocument as _RagDocument
    from db import current_engagement_id

    floor = _DEFAULT_CONFIDENCE_FLOOR if confidence_floor is None else confidence_floor
    if not query.strip():
        return {"hits": [], "unknown": True, "top_score": 0.0}

    try:
        q_vec = embed_text(query)
    except Exception as e:
        log.warning("rag.hybrid_embed_failed", error=str(e))
        q_vec = []

    effective_engagement = engagement_id if engagement_id is not None else current_engagement_id()

    stmt = select(RagDocument)
    if corpora:
        stmt = stmt.where(RagDocument.corpus.in_(corpora))
    # Tenant inventory isolation: hide tenant_inventory chunks unless they
    # belong to the active engagement. Other corpora are unaffected.
    if effective_engagement is None:
        stmt = stmt.where(_RagDocument.corpus != CORPUS_TENANT_INVENTORY)
    else:
        stmt = stmt.where(
            or_(
                _RagDocument.corpus != CORPUS_TENANT_INVENTORY,
                _RagDocument.engagement_id == effective_engagement,
            )
        )
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return {"hits": [], "unknown": True, "top_score": 0.0}

    cosine_scored = [
        (_cosine(q_vec, row.embedding) if q_vec else 0.0, row)
        for row in rows
    ]
    cosine_scored.sort(key=lambda x: x[0], reverse=True)
    cosine_rank = {id(row): rank for rank, (_, row) in enumerate(cosine_scored, start=1)}

    q_lower = query.lower()
    lexical_scored = [
        (
            fuzz.token_set_ratio(
                q_lower,
                ((row.title or "") + " " + (row.content or "")[:2000]).lower(),
            )
            / 100.0,
            row,
        )
        for row in rows
    ]
    lexical_scored.sort(key=lambda x: x[0], reverse=True)
    lexical_rank = {id(row): rank for rank, (_, row) in enumerate(lexical_scored, start=1)}

    cosine_by_id = {id(row): score for score, row in cosine_scored}
    lexical_by_id = {id(row): score for score, row in lexical_scored}

    rrf: list[tuple[float, RagDocument]] = []
    for row in rows:
        rid = id(row)
        rrf_score = 1.0 / (_RRF_K + cosine_rank[rid]) + 1.0 / (_RRF_K + lexical_rank[rid])
        rrf.append((rrf_score, row))
    rrf.sort(key=lambda x: x[0], reverse=True)

    hits = [
        {
            "score": round(score, 6),
            "cosine": round(cosine_by_id[id(row)], 4),
            "lexical": round(lexical_by_id[id(row)], 4),
            "corpus": row.corpus,
            "source_id": row.source_id,
            "title": row.title,
            "url": row.url,
            "content": row.content,
            "metadata": row.doc_metadata,
        }
        for score, row in rrf[:top_k]
    ]
    top_score = hits[0]["score"] if hits else 0.0
    return {
        "hits": hits,
        "unknown": top_score < floor,
        "top_score": top_score,
    }


async def cached_learn_search(query: str, top: int = 5) -> list[dict]:
    """Hybrid retrieval + LLM rerank with live Learn fallback.

    Backward-compatible: still returns ``list[dict]`` shaped for the chat
    SSE ``citations`` event. For the richer ``{citations, unknown,
    top_confidence}`` envelope (needed by the honesty-mode path in the chat
    route), call :func:`cached_learn_search_full` instead.
    """
    bundle = await cached_learn_search_full(query, top=top)
    return bundle["citations"]


async def cached_learn_search_full(
    query: str,
    top: int = 5,
    confidence_floor: float | None = None,
) -> dict:
    """Hybrid retrieval (cosine + lexical RRF) → LLM rerank → citation
    envelope. Falls back to live Learn search when local corpora are dry.

    Returns ``{"citations": list[dict], "unknown": bool,
    "top_confidence": float, "source": str}``. ``source`` is ``"rag"`` when
    local corpora answered, ``"learn_live"`` for the fallback path, or
    ``"empty"`` when neither produced anything.
    """
    from services.rag_reranker import best_confidence, rerank

    if not query.strip():
        return {"citations": [], "unknown": True, "top_confidence": 0.0, "source": "empty"}

    async with session_scope() as session:
        bundle = await hybrid_search(
            session,
            query,
            corpora=list(CITATION_CORPORA),
            top_k=30,
            confidence_floor=confidence_floor,
        )
        hits = bundle["hits"]
        if hits:
            reranked = await rerank(query, hits, top_k=top)
            top_confidence = best_confidence(reranked) or float(bundle.get("top_score") or 0.0)
            citations = [_hit_to_citation(h) for h in reranked]
            # Honesty floor: when the reranker's top pick is weak, surface
            # the "unknown" flag so callers can swap in low-confidence prose.
            unknown = top_confidence < 0.35
            return {
                "citations": citations,
                "unknown": unknown,
                "top_confidence": round(top_confidence, 3),
                "source": "rag",
            }

        live = await search_azure_docs(query, top=top)
        if not live:
            return {"citations": [], "unknown": True, "top_confidence": 0.0, "source": "empty"}
        docs = [
            {
                "source_id": item["url"],
                "title": item["title"],
                "url": item["url"],
                "content": item.get("description", "") or item["title"],
                "metadata": {"query": query, "corpus_type": "learn_live"},
            }
            for item in live
            if item.get("url")
        ]
        if docs:
            await index_documents(session, CORPUS_LEARN, docs)
        live_citations = [
            {
                "title": item["title"],
                "url": item["url"],
                "description": item.get("description", ""),
                "corpus": "learn_live",
                "corpus_type": "learn_live",
            }
            for item in live
        ]
        # Live Learn fallback has no freshness/confidence signal; mark as
        # known (we did find something) but flag low confidence implicitly
        # via the missing confidence field.
        return {
            "citations": live_citations,
            "unknown": False,
            "top_confidence": 0.0,
            "source": "learn_live",
        }


def _hit_to_citation(hit: dict) -> dict:
    """Project a rag_service.search() hit onto the chat citation shape."""
    meta = hit.get("metadata") or {}
    content = hit.get("content") or ""
    published_at = meta.get("published_at") or meta.get("synced_at")
    # Prefer the reranker's score when present -- it's a focused judgement
    # rather than the raw RRF/cosine signal. Fall back to the retrieval
    # score otherwise.
    raw_score = hit.get("rerank_score")
    if raw_score is None:
        raw_score = hit.get("score") or 0.0
    citation: dict = {
        "title": hit.get("title"),
        "url": hit.get("url"),
        "description": content[:300],
        "corpus": hit.get("corpus"),
        "corpus_type": meta.get("corpus_type") or hit.get("corpus"),
        "published_at": published_at,
        "freshness_days": _freshness_days(published_at),
        "confidence": round(float(raw_score or 0.0), 3),
    }
    if hit.get("rerank_reason"):
        citation["reason"] = hit["rerank_reason"]
    if meta.get("latest_version"):
        citation["version"] = meta["latest_version"]
    if meta.get("module_path"):
        citation["module_path"] = meta["module_path"]
    return {k: v for k, v in citation.items() if v is not None}


def _freshness_days(published_iso: str | None) -> int | None:
    if not published_iso:
        return None
    try:
        parsed = dt.datetime.fromisoformat(published_iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.UTC)
    delta = dt.datetime.now(dt.UTC) - parsed
    return max(delta.days, 0)


__all__ = [
    "CITATION_CORPORA",
    "CORPUS_AVM",
    "CORPUS_AZURE_UPDATES",
    "CORPUS_LEARN",
    "CORPUS_REFERENCE_ARCHS",
    "cached_learn_search",
    "cached_learn_search_full",
    "hybrid_search",
    "index_documents",
    "reindex_reference_archs",
    "search",
]
