"""Persistence + RAG glue for per-user custom skills.

Keeps the route modules thin: this owns the per-skill RAG corpus convention
(``skill:<user_skill_id>``), serialization, and materializing a stored package
payload into a user-owned :class:`db.UserSkill` (used by both upload and
showcase install).
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from db import RagDocument, UserSkill
from middleware.logging import get_logger
from services.skill_package import ParsedSkill

log = get_logger("skill_service")


def corpus_for(skill_id: str) -> str:
    """RAG corpus name for a skill's grounding knowledge."""
    return f"skill:{skill_id}"


def serialize(row: UserSkill) -> dict[str, Any]:
    """Public JSON shape for a user skill (omits raw package bytes)."""
    return {
        "id": row.id,
        "slug": row.slug,
        "name": row.name,
        "description": row.description,
        "category": row.category,
        "tags": row.tags or [],
        "icon": row.icon,
        "instructions": row.instructions,
        "inputs_schema": row.inputs_schema or {},
        "examples": row.examples or [],
        "knowledge_files": [k.get("path") for k in (row.knowledge_files or [])],
        "enabled": bool(row.enabled),
        "source": row.source,
        "origin_skill_id": row.origin_skill_id,
        "version": row.version,
        "author": row.author,
        "has_package": row.package_data is not None,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def ingest_knowledge(
    session: AsyncSession,
    skill_id: str,
    name: str,
    knowledge_files: list[dict[str, str]],
) -> int:
    """Index a skill's knowledge docs into its private RAG corpus.

    Best-effort: embedding failures are swallowed by ``rag_service`` so a skill
    still installs (just without grounding) when embeddings are unavailable.
    """
    if not knowledge_files:
        return 0
    from services import rag_service

    docs = [
        {
            "source_id": kf["path"],
            "title": f"{name} — {kf['path']}",
            "content": kf["content"],
            "metadata": {"skill_id": skill_id, "skill_name": name},
        }
        for kf in knowledge_files
        if kf.get("content")
    ]
    try:
        return await rag_service.index_documents(
            session, corpus_for(skill_id), docs, replace=True
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("skill.knowledge_ingest_failed", skill_id=skill_id, error=str(exc))
        return 0


async def purge_knowledge(session: AsyncSession, skill_id: str) -> None:
    """Delete all RAG rows belonging to a skill's corpus."""
    await session.execute(
        sa_delete(RagDocument)
        .where(RagDocument.corpus == corpus_for(skill_id))
        .execution_options(skip_tenant_filter=True)
    )


async def create_user_skill(
    session: AsyncSession,
    user_id: str,
    parsed: ParsedSkill,
    *,
    source: str = "custom",
    origin_skill_id: str | None = None,
    package_data: bytes | None = None,
) -> UserSkill:
    """Persist a parsed package as a new user-owned skill + ingest knowledge."""
    now = int(time.time() * 1000)
    row = UserSkill(
        id=uuid.uuid4().hex,
        user_id=user_id,
        slug=parsed.slug,
        name=parsed.name,
        description=parsed.description,
        category=parsed.category,
        tags=parsed.tags,
        icon=parsed.icon,
        instructions=parsed.instructions,
        inputs_schema=parsed.inputs_schema,
        examples=parsed.examples,
        knowledge_files=parsed.knowledge_files,
        enabled=True,
        source=source,
        origin_skill_id=origin_skill_id,
        version=parsed.version,
        author=parsed.author,
        package_data=package_data,
        package_size_bytes=(len(package_data) if package_data else None),
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await ingest_knowledge(session, row.id, row.name, parsed.knowledge_files)
    return row
