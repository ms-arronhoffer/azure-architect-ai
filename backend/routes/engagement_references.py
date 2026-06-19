"""Per-engagement reference library.

Bookmarks (URL) and small inline file uploads (PDF/HTML/etc.) attached to an
Engagement so the architect can park CSA workbooks, quota process guides,
UAT flow charts, and similar customer-supplied artifacts next to the rest of
the engagement context. File bytes stored inline as `LargeBinary` with a hard
5 MB per-file cap enforced here at the route layer.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import Engagement, EngagementReference, get_session, select

router = APIRouter(prefix="/engagements", tags=["engagement-references"])

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


def _to_dict(row: EngagementReference) -> dict[str, Any]:
    return {
        "id": row.id,
        "engagement_id": row.engagement_id,
        "title": row.title,
        "url": row.url,
        "notes": row.notes,
        "file_name": row.file_name,
        "file_mime_type": row.file_mime_type,
        "file_size_bytes": row.file_size_bytes,
        "has_file": row.file_data is not None,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def _load_engagement(session: AsyncSession, engagement_id: str, user_id: str) -> Engagement:
    result = await session.execute(
        select(Engagement)
        .where(Engagement.id == engagement_id)
        .where(Engagement.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="engagement not found")
    return row


async def _load_ref(
    session: AsyncSession, engagement_id: str, ref_id: str, user_id: str
) -> EngagementReference:
    await _load_engagement(session, engagement_id, user_id)
    result = await session.execute(
        select(EngagementReference)
        .where(EngagementReference.id == ref_id)
        .where(EngagementReference.engagement_id == engagement_id)
        .where(EngagementReference.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="reference not found")
    return row


class ReferencePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    url: str | None = None
    notes: str | None = None


@router.get("/{engagement_id}/references")
async def list_references(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> list[dict[str, Any]]:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    query = (
        select(EngagementReference)
        .where(EngagementReference.engagement_id == engagement_id)
        .where(EngagementReference.user_id == uid)
        .order_by(EngagementReference.updated_at.desc())
    )
    rows = (await session.execute(query)).scalars().all()
    return [_to_dict(r) for r in rows]


@router.post("/{engagement_id}/references", status_code=201)
async def create_reference(
    engagement_id: str,
    title: str = Form(..., min_length=1, max_length=256),
    url: str | None = Form(default=None),
    notes: str = Form(default=""),
    file: UploadFile | None = File(default=None),
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)

    if not url and file is None:
        raise HTTPException(status_code=422, detail="either url or file is required")

    file_name: str | None = None
    file_mime_type: str | None = None
    file_size_bytes: int | None = None
    file_data: bytes | None = None

    if file is not None:
        file_data = await file.read()
        if len(file_data) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"file exceeds {MAX_FILE_BYTES // (1024 * 1024)} MB limit",
            )
        if len(file_data) == 0:
            file_data = None
        else:
            file_name = file.filename
            file_mime_type = file.content_type or "application/octet-stream"
            file_size_bytes = len(file_data)

    now = int(time.time() * 1000)
    row = EngagementReference(
        id=uuid.uuid4().hex,
        engagement_id=engagement_id,
        title=title,
        url=url or None,
        notes=notes,
        file_name=file_name,
        file_mime_type=file_mime_type,
        file_size_bytes=file_size_bytes,
        file_data=file_data,
        user_id=uid,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    return _to_dict(row)


@router.get("/{engagement_id}/references/{ref_id}/download")
async def download_reference(
    engagement_id: str,
    ref_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> Response:
    uid = _uid(claims)
    row = await _load_ref(session, engagement_id, ref_id, uid)
    if row.file_data is None:
        raise HTTPException(status_code=404, detail="reference has no file attached")
    return Response(
        content=row.file_data,
        media_type=row.file_mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{row.file_name or "reference"}"'
        },
    )


@router.patch("/{engagement_id}/references/{ref_id}")
async def update_reference(
    engagement_id: str,
    ref_id: str,
    body: ReferencePatch,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    row = await _load_ref(session, engagement_id, ref_id, uid)
    if body.title is not None:
        row.title = body.title
    if body.url is not None:
        row.url = body.url or None
    if body.notes is not None:
        row.notes = body.notes
    row.updated_at = int(time.time() * 1000)
    await session.commit()
    return _to_dict(row)


@router.delete("/{engagement_id}/references/{ref_id}", status_code=204)
async def delete_reference(
    engagement_id: str,
    ref_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> None:
    uid = _uid(claims)
    row = await _load_ref(session, engagement_id, ref_id, uid)
    await session.delete(row)
    await session.commit()
