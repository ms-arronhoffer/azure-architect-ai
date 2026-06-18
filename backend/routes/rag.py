"""RAG admin/search endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user
from db import get_session
from services import rag_service

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/reindex/reference-archs")
async def reindex_reference_archs(_=Depends(require_user)) -> dict:
    count = await rag_service.reindex_reference_archs()
    return {"corpus": rag_service.CORPUS_REFERENCE_ARCHS, "indexed": count}


@router.get("/search")
async def search(
    q: str = Query(..., min_length=1),
    corpus: str | None = None,
    top_k: int = Query(5, ge=1, le=25),
    hybrid: bool = Query(False, description="Use RRF-merged cosine + lexical retrieval"),
    confidence_floor: float = Query(0.0, ge=0.0, le=1.0),
    rerank: bool = Query(False, description="LLM-rerank hybrid hits (requires hybrid=true)"),
    session: AsyncSession = Depends(get_session),
    _=Depends(require_user),
) -> dict:
    corpora = [corpus] if corpus else None
    try:
        if hybrid:
            bundle = await rag_service.hybrid_search(
                session,
                q,
                corpora=corpora,
                top_k=max(top_k, 30 if rerank else top_k),
                confidence_floor=confidence_floor or None,
            )
            hits = bundle["hits"]
            if rerank and hits:
                from services.rag_reranker import rerank as rerank_hits

                hits = await rerank_hits(q, hits, top_k=top_k)
            else:
                hits = hits[:top_k]
            return {
                "query": q,
                "hits": hits,
                "unknown": bundle["unknown"],
                "top_score": bundle["top_score"],
                "mode": "hybrid",
            }
        hits = await rag_service.search(session, q, corpora=corpora, top_k=top_k)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"query": q, "hits": hits, "mode": "cosine"}
