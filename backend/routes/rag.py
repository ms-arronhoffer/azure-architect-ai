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
    session: AsyncSession = Depends(get_session),
    _=Depends(require_user),
) -> dict:
    corpora = [corpus] if corpus else None
    try:
        hits = await rag_service.search(session, q, corpora=corpora, top_k=top_k)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"query": q, "hits": hits}
