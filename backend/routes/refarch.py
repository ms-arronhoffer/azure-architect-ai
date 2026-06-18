"""Reference architecture library — global catalog with full CRUD.

Mirrors the Demo Showcase shape (`routes/demos.py`) but adds:
- A merged seed corpus drawn from `data/ms_reference_archs.py` (MS-official)
  and the legacy `data/reference_archs.py` (community-curated). Legacy entries
  are normalised on the way in: their loose schema (`id`, string
  `estimated_monthly`) is mapped onto the canonical `slug` + dict shape.
- Source-aware mutation rules: `microsoft_official` entries are read-only
  except for the `featured` flag; `custom` entries are fully mutable;
  `community` entries are read-only (curated upstream).
- A `POST /api/refarch/match` endpoint that returns the top-3 matches
  for a workload spec — used by the architecture pipeline to seed prompts.

GET    /api/refarch          → list (with ?category= ?tag= ?source=)
POST   /api/refarch          → create custom entry
PATCH  /api/refarch/{id}     → update (rules above)
DELETE /api/refarch/{id}     → remove (custom only)
POST   /api/refarch/match    → rank corpus against a workload spec
"""
from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from data.ms_reference_archs import MS_REFERENCE_ARCHS
from data.reference_archs import REFERENCE_ARCHS
from db import RefArch, get_session, select
from middleware.logging import get_logger
from services.refarch_match import match_spec

router = APIRouter()
_log = get_logger("refarch")

_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _slugify(value: str) -> str:
    s = value.lower().strip().replace(" ", "-").replace("_", "-")
    s = _SLUG_RE.sub("", s)
    return s.strip("-") or f"arch-{uuid.uuid4().hex[:8]}"


def _normalise_legacy(entry: dict[str, Any]) -> dict[str, Any]:
    """Map a `REFERENCE_ARCHS` legacy entry onto the canonical RefArch shape."""
    monthly = entry.get("estimated_monthly")
    monthly_dict: dict[str, Any]
    if isinstance(monthly, dict):
        monthly_dict = monthly
    elif isinstance(monthly, str):
        monthly_dict = {"range_label": monthly}
    else:
        monthly_dict = {}
    return {
        "slug": entry.get("id") or _slugify(entry.get("title", "")),
        "title": entry["title"],
        "summary": entry.get("description") or entry.get("summary", ""),
        "category": entry.get("category", "general"),
        "tags": list(entry.get("tags") or []),
        "services": list(entry.get("services") or []),
        "patterns": list(entry.get("patterns") or []),
        "waf_score": dict(entry.get("waf_score") or {}),
        "estimated_monthly": monthly_dict,
        "complexity": entry.get("complexity", "Medium"),
        "learn_url": entry.get("learn_url", ""),
        "repo_url": entry.get("repo_url"),
        "bicep_avm_module": entry.get("bicep_avm_module"),
        "diagram_url": entry.get("diagram_url"),
        "source": entry.get("source", "community"),
        "featured": bool(entry.get("featured", False)),
    }


def _normalise_ms(entry: dict[str, Any]) -> dict[str, Any]:
    """MS entries already follow the canonical shape — copy through."""
    out = dict(entry)
    out.setdefault("source", "microsoft_official")
    out.setdefault("featured", False)
    return out


def _serialize(row: RefArch) -> dict[str, Any]:
    return {
        "id": row.id,
        "slug": row.slug,
        "title": row.title,
        "summary": row.summary,
        "category": row.category,
        "tags": row.tags or [],
        "services": row.services or [],
        "patterns": row.patterns or [],
        "waf_score": row.waf_score or {},
        "estimated_monthly": row.estimated_monthly or {},
        "complexity": row.complexity,
        "learn_url": row.learn_url,
        "repo_url": row.repo_url,
        "bicep_avm_module": row.bicep_avm_module,
        "diagram_url": row.diagram_url,
        "source": row.source,
        "featured": bool(row.featured),
        "created_at": row.created_at,
        "last_synced_at": row.last_synced_at,
    }


async def _seed_if_empty(session: AsyncSession) -> None:
    existing = (await session.execute(select(RefArch).limit(1))).scalars().first()
    if existing is not None:
        return
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    seen_slugs: set[str] = set()
    seeds: list[dict[str, Any]] = []
    for raw in MS_REFERENCE_ARCHS:
        norm = _normalise_ms(raw)
        if norm["slug"] in seen_slugs:
            continue
        seen_slugs.add(norm["slug"])
        seeds.append(norm)
    for raw in REFERENCE_ARCHS:
        norm = _normalise_legacy(raw)
        if norm["slug"] in seen_slugs:
            continue
        seen_slugs.add(norm["slug"])
        seeds.append(norm)
    for seed in seeds:
        session.add(RefArch(
            id=f"refarch-{uuid.uuid4().hex[:12]}",
            created_at=now,
            **seed,
        ))
    await session.commit()


class RefArchIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = ""
    category: str = "general"
    tags: list[str] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)
    waf_score: dict[str, int] = Field(default_factory=dict)
    estimated_monthly: dict[str, Any] = Field(default_factory=dict)
    complexity: str = "Medium"
    learn_url: str = ""
    repo_url: str | None = None
    bicep_avm_module: str | None = None
    diagram_url: str | None = None
    featured: bool = False


class RefArchPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    services: list[str] | None = None
    patterns: list[str] | None = None
    waf_score: dict[str, int] | None = None
    estimated_monthly: dict[str, Any] | None = None
    complexity: str | None = None
    learn_url: str | None = None
    repo_url: str | None = None
    bicep_avm_module: str | None = None
    diagram_url: str | None = None
    featured: bool | None = None


class MatchRequest(BaseModel):
    spec: dict[str, Any] = Field(default_factory=dict)
    top_n: int = 3


def _epoch(ts: str) -> float:
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


@router.get("/refarch")
async def list_refarch(
    category: str = Query("", description="Filter by category"),
    tag: str = Query("", description="Filter by tag"),
    source: str = Query("", description="Filter by source"),
    session: AsyncSession = Depends(get_session),
):
    await _seed_if_empty(session)
    rows = (await session.execute(select(RefArch))).scalars().all()
    items = [_serialize(r) for r in rows]
    if category:
        items = [a for a in items if a["category"].lower() == category.lower()]
    if tag:
        tl = tag.lower()
        items = [a for a in items if tl in {t.lower() for t in a["tags"]}]
    if source:
        items = [a for a in items if a["source"] == source]
    items.sort(key=lambda a: (not a["featured"], -_epoch(a["created_at"])))
    return {
        "title": "Reference Architecture Library",
        "subtitle": "Microsoft-official and custom reference architectures.",
        "architectures": items,
        "total": len(items),
    }


@router.post("/refarch", status_code=201)
async def create_refarch(body: RefArchIn, session: AsyncSession = Depends(get_session)):
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    slug = _slugify(body.title)
    existing = (await session.execute(select(RefArch).where(RefArch.slug == slug))).scalars().first()
    if existing is not None:
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"
    row = RefArch(
        id=f"refarch-{uuid.uuid4().hex[:12]}",
        slug=slug,
        title=body.title,
        summary=body.summary,
        category=body.category,
        tags=body.tags,
        services=body.services,
        patterns=body.patterns,
        waf_score=body.waf_score,
        estimated_monthly=body.estimated_monthly,
        complexity=body.complexity,
        learn_url=body.learn_url,
        repo_url=body.repo_url,
        bicep_avm_module=body.bicep_avm_module,
        diagram_url=body.diagram_url,
        source="custom",
        featured=body.featured,
        created_at=now,
    )
    session.add(row)
    await session.commit()
    return _serialize(row)


@router.patch("/refarch/{arch_id}")
async def update_refarch(
    arch_id: str,
    body: RefArchPatch,
    session: AsyncSession = Depends(get_session),
):
    row = await session.get(RefArch, arch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Reference architecture not found")
    data = body.model_dump(exclude_unset=True)
    if row.source != "custom":
        # Curated entries: only `featured` may be toggled.
        disallowed = [k for k in data.keys() if k != "featured"]
        if disallowed:
            raise HTTPException(
                status_code=403,
                detail=f"Cannot edit fields {disallowed} on a {row.source} entry; only `featured` is mutable.",
            )
    for key, value in data.items():
        setattr(row, key, value)
    await session.commit()
    return _serialize(row)


@router.delete("/refarch/{arch_id}")
async def delete_refarch(arch_id: str, session: AsyncSession = Depends(get_session)):
    row = await session.get(RefArch, arch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Reference architecture not found")
    if row.source != "custom":
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete a {row.source} entry; only custom entries can be removed.",
        )
    await session.delete(row)
    await session.commit()
    return {"ok": True}


@router.post("/refarch/match")
async def match_refarch(body: MatchRequest, session: AsyncSession = Depends(get_session)):
    await _seed_if_empty(session)
    rows = (await session.execute(select(RefArch))).scalars().all()
    corpus = [_serialize(r) for r in rows]
    ranked = match_spec(body.spec, corpus, top_n=max(1, min(body.top_n, 10)))
    return {"matches": ranked, "total_evaluated": len(corpus)}
