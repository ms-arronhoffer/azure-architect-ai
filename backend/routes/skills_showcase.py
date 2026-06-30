"""Skill Showcase — global catalog of shareable skill packages.

Mirrors the Demo Showcase (``routes/demos.py``): a global, browseable catalog
that any user can install from. Publishing pushes one of a user's own skills
into the catalog; installing materializes a fresh user-owned copy.

Gated behind the ``CUSTOM_SKILLS`` feature flag.

    GET    /api/skills/showcase                 → list catalog (featured first)
    POST   /api/skills/showcase/{id}/install    → install into caller's skills
    POST   /api/skills/{id}/publish             → publish a user skill (handled here)
    PATCH  /api/skills/showcase/{id}            → admin: feature/edit metadata
    DELETE /api/skills/showcase/{id}            → admin: remove a catalog entry
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, require_metrics_role, user_id_from_claims
from db import ShowcaseSkill, UserSkill, get_session, select
from middleware.logging import get_logger
from services import skill_service
from services.feature_flags import custom_skills_enabled
from services.skill_package import ParsedSkill

router = APIRouter(tags=["skills-showcase"])
_log = get_logger("skills_showcase")

_SEED_SKILLS: list[dict[str, Any]] = [
    {
        "slug": "finops-tagging-reviewer",
        "title": "FinOps Tagging Reviewer",
        "description": (
            "Reviews Azure resource tagging against a FinOps cost-allocation "
            "standard and flags missing CostCenter / Environment / Owner tags."
        ),
        "category": "cost",
        "tags": ["FinOps", "Tagging", "Governance", "Cost"],
        "author": "Azure Architect AI",
        "version": "1.0.0",
        "featured": True,
        "payload": {
            "slug": "finops-tagging-reviewer",
            "name": "FinOps Tagging Reviewer",
            "description": (
                "Reviews Azure resource tagging against a FinOps cost-allocation "
                "standard and flags missing CostCenter / Environment / Owner tags."
            ),
            "category": "cost",
            "tags": ["FinOps", "Tagging", "Governance", "Cost"],
            "version": "1.0.0",
            "author": "Azure Architect AI",
            "instructions": (
                "You are a FinOps tagging reviewer. When given a list of Azure "
                "resources or an ARM/Bicep export, check each resource for the "
                "mandatory tags CostCenter, Environment, and Owner. Produce a "
                "table of non-compliant resources, the missing tags, and a "
                "remediation snippet. Always cite the FinOps Foundation tagging "
                "guidance when explaining why a tag matters."
            ),
            "inputs_schema": {"fields": []},
            "examples": [
                {"title": "Review a resource group", "prompt": "Review the tags on my prod-rg resource group."},
            ],
            "icon": None,
            "knowledge_files": [],
        },
    },
]


def _require_flag() -> None:
    if not custom_skills_enabled():
        raise HTTPException(status_code=404, detail="custom skills are not enabled")


def _serialize(row: ShowcaseSkill) -> dict[str, Any]:
    return {
        "id": row.id,
        "slug": row.slug,
        "title": row.title,
        "description": row.description,
        "category": row.category,
        "tags": row.tags or [],
        "author": row.author,
        "version": row.version,
        "icon": row.icon,
        "downloads": row.downloads,
        "featured": bool(row.featured),
        "source": row.source,
        "created_at": row.created_at,
    }


async def _seed_if_empty(session: AsyncSession) -> None:
    existing = (await session.execute(select(ShowcaseSkill).limit(1))).scalars().first()
    if existing is not None:
        return
    now = dt.datetime.now(dt.UTC).isoformat()
    for seed in _SEED_SKILLS:
        session.add(ShowcaseSkill(
            id=uuid.uuid4().hex,
            slug=seed["slug"],
            title=seed["title"],
            description=seed["description"],
            category=seed["category"],
            tags=seed["tags"],
            author=seed.get("author"),
            version=seed.get("version", "1.0.0"),
            icon=seed.get("payload", {}).get("icon"),
            payload=seed["payload"],
            downloads=0,
            featured=seed.get("featured", False),
            source="curated",
            created_at=now,
        ))
    await session.commit()


def _payload_to_parsed(payload: dict[str, Any]) -> ParsedSkill:
    return ParsedSkill(
        slug=payload.get("slug", "skill"),
        name=payload.get("name", payload.get("slug", "skill")),
        description=payload.get("description", ""),
        category=payload.get("category", "general"),
        tags=payload.get("tags", []) or [],
        version=payload.get("version", "1.0.0"),
        author=payload.get("author"),
        instructions=payload.get("instructions", ""),
        inputs_schema=payload.get("inputs_schema", {}) or {},
        examples=payload.get("examples", []) or [],
        icon=payload.get("icon"),
        knowledge_files=payload.get("knowledge_files", []) or [],
    )


class ShowcasePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    featured: bool | None = None


@router.get("/skills/showcase")
async def list_showcase(
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _require_flag()
    await _seed_if_empty(session)
    rows = (await session.execute(select(ShowcaseSkill))).scalars().all()
    skills = [_serialize(r) for r in rows]
    skills.sort(key=lambda s: (not s["featured"], -s["downloads"], s["created_at"]))
    return {
        "title": "Skill Showcase",
        "subtitle": "Browse community skills and install them into your workspace, or publish your own.",
        "skills": skills,
    }


@router.post("/skills/showcase/{showcase_id}/install", status_code=201)
async def install_skill(
    showcase_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    uid = user_id_from_claims(claims)
    row = (
        await session.execute(select(ShowcaseSkill).where(ShowcaseSkill.id == showcase_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="showcase skill not found")
    parsed = _payload_to_parsed(row.payload or {})
    user_skill = await skill_service.create_user_skill(
        session, uid, parsed, source="showcase", origin_skill_id=row.id,
        package_data=row.package_data,
    )
    row.downloads = (row.downloads or 0) + 1
    await session.commit()
    _log.info("skill.installed", user_id=uid, showcase_id=showcase_id, skill_id=user_skill.id)
    return skill_service.serialize(user_skill)


@router.post("/skills/{skill_id}/publish", status_code=201)
async def publish_skill(
    skill_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    uid = user_id_from_claims(claims)
    skill = (
        await session.execute(
            select(UserSkill)
            .where(UserSkill.id == skill_id)
            .where(UserSkill.user_id == uid)
        )
    ).scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")

    payload = {
        "slug": skill.slug,
        "name": skill.name,
        "description": skill.description,
        "category": skill.category,
        "tags": skill.tags or [],
        "version": skill.version,
        "author": skill.author,
        "instructions": skill.instructions,
        "inputs_schema": skill.inputs_schema or {},
        "examples": skill.examples or [],
        "icon": skill.icon,
        "knowledge_files": skill.knowledge_files or [],
    }
    # One catalog entry per (slug, author) — re-publishing updates in place.
    existing = (
        await session.execute(select(ShowcaseSkill).where(ShowcaseSkill.slug == skill.slug))
    ).scalar_one_or_none()
    now = dt.datetime.now(dt.UTC).isoformat()
    if existing is not None:
        existing.title = skill.name
        existing.description = skill.description
        existing.category = skill.category
        existing.tags = skill.tags or []
        existing.version = skill.version
        existing.icon = skill.icon
        existing.payload = payload
        existing.package_data = skill.package_data
        existing.last_synced_at = now
        row = existing
    else:
        row = ShowcaseSkill(
            id=uuid.uuid4().hex,
            slug=skill.slug,
            title=skill.name,
            description=skill.description,
            category=skill.category,
            tags=skill.tags or [],
            author=skill.author,
            version=skill.version,
            icon=skill.icon,
            payload=payload,
            package_data=skill.package_data,
            downloads=0,
            featured=False,
            source="custom",
            created_at=now,
        )
        session.add(row)
    await session.commit()
    _log.info("skill.published", user_id=uid, skill_id=skill_id, slug=skill.slug)
    return _serialize(row)


@router.patch("/skills/showcase/{showcase_id}")
async def update_showcase(
    showcase_id: str,
    patch: ShowcasePatch,
    session: AsyncSession = Depends(get_session),
    _claims: dict[str, Any] = Depends(require_metrics_role),
) -> dict[str, Any]:
    _require_flag()
    row = (
        await session.execute(select(ShowcaseSkill).where(ShowcaseSkill.id == showcase_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="showcase skill not found")
    if patch.title is not None:
        row.title = patch.title
    if patch.description is not None:
        row.description = patch.description
    if patch.category is not None:
        row.category = patch.category
    if patch.tags is not None:
        row.tags = patch.tags
    if patch.featured is not None:
        row.featured = patch.featured
    await session.commit()
    return _serialize(row)


@router.delete("/skills/showcase/{showcase_id}")
async def delete_showcase(
    showcase_id: str,
    session: AsyncSession = Depends(get_session),
    _claims: dict[str, Any] = Depends(require_metrics_role),
) -> dict[str, str]:
    _require_flag()
    row = (
        await session.execute(select(ShowcaseSkill).where(ShowcaseSkill.id == showcase_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="showcase skill not found")
    await session.delete(row)
    await session.commit()
    return {"status": "deleted", "id": showcase_id}
