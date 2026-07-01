"""Per-user custom skills.

Users author a declarative skill (prompt + optional knowledge + optional input
schema), package it as a zip, and upload it here. Installed skills are loaded
at login and, when active, augment the chat system prompt and ground answers
via a private RAG corpus. No code in a package is ever executed.

Gated behind the ``CUSTOM_SKILLS`` feature flag.

    POST   /api/skills/upload      → upload + install a skill package (zip)
    GET    /api/skills             → list the caller's skills
    GET    /api/skills/sample      → download the starter package
    GET    /api/skills/{id}        → get one skill (full detail)
    PATCH  /api/skills/{id}        → enable/disable or rename
    DELETE /api/skills/{id}        → remove skill + purge its RAG corpus
    GET    /api/skills/{id}/export → re-download the original package zip
"""
from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import UserSkill, get_session, select
from middleware.logging import get_logger
from services import skill_service
from services.feature_flags import custom_skills_enabled
from services.skill_package import (
    MAX_PACKAGE_BYTES,
    SkillPackageError,
    parse_package,
)

router = APIRouter(prefix="/skills", tags=["skills"])
_log = get_logger("skills")

_SAMPLE_DIR = Path(__file__).resolve().parent.parent / "knowledge" / "skills" / "sample_skill"


def _require_flag() -> None:
    if not custom_skills_enabled():
        raise HTTPException(status_code=404, detail="custom skills are not enabled")


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


async def _load_skill(session: AsyncSession, skill_id: str, user_id: str) -> UserSkill:
    result = await session.execute(
        select(UserSkill)
        .where(UserSkill.id == skill_id)
        .where(UserSkill.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return row


class SkillPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None


@router.get("/sample")
async def download_sample() -> Response:
    """Return the starter skill package as a zip for authors to copy and edit."""
    _require_flag()
    if not _SAMPLE_DIR.is_dir():
        raise HTTPException(status_code=404, detail="sample package not available")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(_SAMPLE_DIR.rglob("*")):
            if path.is_file():
                arc = "sample-skill/" + str(path.relative_to(_SAMPLE_DIR)).replace("\\", "/")
                zf.write(path, arc)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="sample-skill.zip"'},
    )


@router.post("/upload", status_code=201)
async def upload_skill(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    uid = _uid(claims)
    data = await file.read()
    if len(data) > MAX_PACKAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"package exceeds {MAX_PACKAGE_BYTES // (1024 * 1024)} MB limit",
        )
    try:
        parsed = parse_package(data)
    except SkillPackageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    row = await skill_service.create_user_skill(
        session, uid, parsed, source="custom", package_data=data
    )
    _log.info("skill.uploaded", user_id=uid, skill_id=row.id, slug=row.slug)
    return skill_service.serialize(row)


@router.get("")
async def list_skills(
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    uid = _uid(claims)
    rows = (
        await session.execute(
            select(UserSkill)
            .where(UserSkill.user_id == uid)
            .order_by(UserSkill.updated_at.desc())
        )
    ).scalars().all()
    return {"skills": [skill_service.serialize(r) for r in rows]}


@router.get("/{skill_id}")
async def get_skill(
    skill_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    row = await _load_skill(session, skill_id, _uid(claims))
    return skill_service.serialize(row)


@router.patch("/{skill_id}")
async def update_skill(
    skill_id: str,
    patch: SkillPatch,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_flag()
    row = await _load_skill(session, skill_id, _uid(claims))
    if patch.name is not None:
        row.name = patch.name.strip()[:200]
    if patch.enabled is not None:
        row.enabled = patch.enabled
    row.updated_at = int(time.time() * 1000)
    await session.commit()
    return skill_service.serialize(row)


@router.delete("/{skill_id}")
async def delete_skill(
    skill_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, str]:
    _require_flag()
    uid = _uid(claims)
    row = await _load_skill(session, skill_id, uid)
    await skill_service.purge_knowledge(session, row.id)
    await session.delete(row)
    await session.commit()
    _log.info("skill.deleted", user_id=uid, skill_id=skill_id)
    return {"status": "deleted", "id": skill_id}


@router.get("/{skill_id}/export")
async def export_skill(
    skill_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> Response:
    _require_flag()
    row = await _load_skill(session, skill_id, _uid(claims))
    if row.package_data is not None:
        data = row.package_data
    else:
        # Showcase-installed skills have no original upload; rebuild from payload.
        from services.skill_package import build_package
        data = build_package({
            "slug": row.slug,
            "name": row.name,
            "description": row.description,
            "category": row.category,
            "tags": row.tags or [],
            "version": row.version,
            "author": row.author,
            "instructions": row.instructions,
            "inputs_schema": row.inputs_schema or {},
            "examples": row.examples or [],
            "icon": row.icon,
            "knowledge_files": row.knowledge_files or [],
        })
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{row.slug}.zip"'},
    )
