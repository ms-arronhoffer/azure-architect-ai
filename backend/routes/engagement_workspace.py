"""Per-engagement workspace: saved tool outputs for cross-tool recall.

While an engagement is active, tools persist notable outputs here (a cost
worksheet, a naming standard, a landing-zone plan, …). Those artifacts are:

* surfaced as a compact "recent outputs" list in the chat/agent preamble so
  any later tool run recalls what earlier tools produced (see
  ``services.engagement_context.recent_artifacts``);
* listed in the Engagement drawer's Workspace section;
* wiped in one shot via ``DELETE /engagements/{id}/workspace`` — the backend
  half of the "Start over" action that signals the end of a workflow.

Authorization mirrors the rest of the engagement surface: every row is scoped
to the authenticated ``user_id`` and the current ``tenant_id`` (the latter
auto-applied by the SQLAlchemy listener in ``db.py``).
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import Engagement, EngagementArtifact, get_session, select

router = APIRouter(prefix="/engagements", tags=["engagement-workspace"])

# Keep the workspace bounded so the preamble recall and drawer stay useful and
# a runaway tool can't fill the table. Oldest artifacts are pruned on insert.
MAX_ARTIFACTS_PER_ENGAGEMENT = 50


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


def _to_dict(row: EngagementArtifact) -> dict[str, Any]:
    return {
        "id": row.id,
        "engagement_id": row.engagement_id,
        "tool": row.tool,
        "kind": row.kind,
        "title": row.title,
        "summary": row.summary,
        "data": row.data or {},
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def _load_engagement(
    session: AsyncSession, engagement_id: str, user_id: str
) -> Engagement:
    result = await session.execute(
        select(Engagement)
        .where(Engagement.id == engagement_id)
        .where(Engagement.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="engagement not found")
    return row


class ArtifactWrite(BaseModel):
    tool: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=256)
    kind: str = Field(default="note", max_length=32)
    summary: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


@router.get("/{engagement_id}/workspace")
async def list_artifacts(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> list[dict[str, Any]]:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    rows = (
        (
            await session.execute(
                select(EngagementArtifact)
                .where(EngagementArtifact.engagement_id == engagement_id)
                .where(EngagementArtifact.user_id == uid)
                .order_by(EngagementArtifact.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_to_dict(r) for r in rows]


@router.post("/{engagement_id}/workspace", status_code=201)
async def save_artifact(
    engagement_id: str,
    body: ArtifactWrite,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    now = int(time.time() * 1000)
    row = EngagementArtifact(
        id=uuid.uuid4().hex,
        engagement_id=engagement_id,
        tool=body.tool,
        kind=body.kind or "note",
        title=body.title,
        summary=body.summary,
        data=body.data,
        user_id=uid,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    await _prune(session, engagement_id, uid)
    await session.commit()
    return _to_dict(row)


@router.delete("/{engagement_id}/workspace/{artifact_id}", status_code=204)
async def delete_artifact(
    engagement_id: str,
    artifact_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> None:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    result = await session.execute(
        select(EngagementArtifact)
        .where(EngagementArtifact.id == artifact_id)
        .where(EngagementArtifact.engagement_id == engagement_id)
        .where(EngagementArtifact.user_id == uid)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="artifact not found")
    await session.delete(row)
    await session.commit()


@router.delete("/{engagement_id}/workspace", status_code=200)
async def clear_workspace(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete every artifact for the engagement — the "Start over" action."""
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    result = await session.execute(
        sa_delete(EngagementArtifact)
        .where(EngagementArtifact.engagement_id == engagement_id)
        .where(EngagementArtifact.user_id == uid)
    )
    await session.commit()
    return {"engagement_id": engagement_id, "deleted": result.rowcount or 0}


async def _prune(session: AsyncSession, engagement_id: str, user_id: str) -> None:
    """Trim the engagement's workspace to the newest ``MAX_ARTIFACTS_PER_ENGAGEMENT``."""
    rows = (
        (
            await session.execute(
                select(EngagementArtifact.id)
                .where(EngagementArtifact.engagement_id == engagement_id)
                .where(EngagementArtifact.user_id == user_id)
                .order_by(EngagementArtifact.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    stale = rows[MAX_ARTIFACTS_PER_ENGAGEMENT:]
    if stale:
        await session.execute(
            sa_delete(EngagementArtifact).where(EngagementArtifact.id.in_(stale))
        )
