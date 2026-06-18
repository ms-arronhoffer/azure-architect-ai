"""Demo showcase route — global catalog of demos with full CRUD.

GET    /api/demos          → list all demos (featured first)
POST   /api/demos          → create a new demo
PATCH  /api/demos/{id}     → update an existing demo (partial)
DELETE /api/demos/{id}     → remove a demo
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db import Demo, get_session, select
from middleware.logging import get_logger

router = APIRouter()
_log = get_logger("demos")

_SEED_DEMOS: list[dict[str, Any]] = [
    {
        "id": "demo-001",
        "title": "AI Search with RAG summary",
        "description": (
            "Hybrid search pipeline combining BM25 keyword and vector search on Azure AI Search, "
            "with semantic reranking and GPT-4o streaming answer synthesis."
        ),
        "tags": ["Azure OpenAI", "Azure AI Search", "GPT-4o", "Streaming"],
        "video_url": None,
        "repo_url": "https://github.com/ms-arronhoffer/azure-ai-search-demo",
        "live_url": None,
        "thumbnail_url": None,
        "featured": True,
        "created_at": "2026-05-01T00:00:00Z",
        "source": "custom",
    },
    {
        "id": "demo-002",
        "title": "Document Intelligence Extractor",
        "description": (
            "Flask web app secured with Microsoft Entra ID that extracts key-value pairs and text "
            "from uploaded documents using Azure AI Document Intelligence."
        ),
        "tags": ["Azure AI", "Document Intelligence", "Vision", "Python"],
        "video_url": None,
        "repo_url": "https://github.com/ms-arronhoffer/azure-doc-intelligence-demo",
        "live_url": None,
        "thumbnail_url": None,
        "featured": False,
        "created_at": "2026-04-15T00:00:00Z",
        "source": "custom",
    },
]


class DemoIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    video_url: str | None = None
    repo_url: str | None = None
    live_url: str | None = None
    thumbnail_url: str | None = None
    featured: bool = False


class DemoPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    video_url: str | None = None
    repo_url: str | None = None
    live_url: str | None = None
    thumbnail_url: str | None = None
    featured: bool | None = None


def _serialize(row: Demo) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "description": row.description,
        "tags": row.tags or [],
        "video_url": row.video_url,
        "repo_url": row.repo_url,
        "live_url": row.live_url,
        "thumbnail_url": row.thumbnail_url,
        "featured": bool(row.featured),
        "created_at": row.created_at,
        "source": row.source,
        "last_synced_at": row.last_synced_at,
    }


async def _seed_if_empty(session: AsyncSession) -> None:
    existing = (await session.execute(select(Demo).limit(1))).scalars().first()
    if existing is not None:
        return
    for seed in _SEED_DEMOS:
        session.add(Demo(**seed))
    await session.commit()


@router.get("/demos")
async def list_demos(session: AsyncSession = Depends(get_session)):
    await _seed_if_empty(session)
    rows = (await session.execute(select(Demo))).scalars().all()
    demos = [_serialize(r) for r in rows]
    demos.sort(key=lambda d: (not d["featured"], d["created_at"]), reverse=False)
    # featured first, then most recent
    demos.sort(key=lambda d: (not d["featured"], -_epoch(d["created_at"])))
    return {
        "title": "Demo Showcase",
        "subtitle": "Explore the collection of demos. Click Watch to see them in action or Repo to view the source.",
        "demos": demos,
    }


def _epoch(ts: str) -> float:
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


@router.post("/demos", status_code=201)
async def create_demo(body: DemoIn, session: AsyncSession = Depends(get_session)):
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    row = Demo(
        id=f"demo-{uuid.uuid4().hex[:12]}",
        title=body.title,
        description=body.description,
        tags=body.tags,
        video_url=body.video_url or None,
        repo_url=body.repo_url or None,
        live_url=body.live_url or None,
        thumbnail_url=body.thumbnail_url or None,
        featured=body.featured,
        created_at=now,
    )
    session.add(row)
    await session.commit()
    return _serialize(row)


@router.patch("/demos/{demo_id}")
async def update_demo(
    demo_id: str,
    body: DemoPatch,
    session: AsyncSession = Depends(get_session),
):
    row = await session.get(Demo, demo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Demo not found")
    data = body.model_dump(exclude_unset=True)
    if row.source and row.source != "custom":
        disallowed = [k for k in data if k != "featured"]
        if disallowed:
            raise HTTPException(
                status_code=403,
                detail=f"Cannot edit fields {disallowed} on a {row.source} entry; only `featured` is mutable.",
            )
    for key, value in data.items():
        setattr(row, key, value)
    await session.commit()
    return _serialize(row)


@router.delete("/demos/{demo_id}")
async def delete_demo(demo_id: str, session: AsyncSession = Depends(get_session)):
    row = await session.get(Demo, demo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Demo not found")
    if row.source and row.source != "custom":
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete a {row.source} entry; only custom entries can be removed.",
        )
    await session.delete(row)
    await session.commit()
    return {"ok": True}
