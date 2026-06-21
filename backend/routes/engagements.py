"""CRUD for Engagement scopes.

An Engagement is a lightweight container that tells cost + scan tools
which subscriptions to default to, and adds a 400-token preamble to the
chat system prompt so the model doesn't re-ask the customer's industry /
compliance frameworks every turn.

Authorization model: every row is scoped to the authenticated `user_id`
and the current `tenant_id` (auto-applied by the SQLAlchemy listener in
db.py). Two architects in the same tenant cannot see each other's
engagements — keep customer separation explicit.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import Engagement, RagDocument, engagement_id_var, get_session, select, session_scope
from middleware.logging import get_logger
from services import engagement_context
from services.rag_service import CORPUS_TENANT_INVENTORY
from services.tenant_inventory_ingest import ingest_engagement

router = APIRouter(prefix="/engagements", tags=["engagements"])

_log = get_logger("engagements")


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


class EngagementWrite(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    customer_name: str = ""
    industry: str | None = None
    compliance_frameworks: list[str] = Field(default_factory=list)
    subscription_ids: list[str] = Field(default_factory=list)
    region_preference: str | None = None
    notes: str = ""
    reservation_commitments: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"


@router.get("")
async def list_engagements(
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> list[dict[str, Any]]:
    uid = _uid(claims)
    query = (
        select(Engagement)
        .where(Engagement.user_id == uid)
        .order_by(Engagement.updated_at.desc())
    )
    rows = (await session.execute(query)).scalars().all()
    return [engagement_context.to_dict(r) for r in rows]


@router.post("", status_code=201)
async def create_engagement(
    body: EngagementWrite,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    now = int(time.time() * 1000)
    row = Engagement(
        id=uuid.uuid4().hex,
        name=body.name,
        customer_name=body.customer_name,
        industry=body.industry,
        compliance_frameworks=body.compliance_frameworks,
        subscription_ids=body.subscription_ids,
        region_preference=body.region_preference,
        notes=body.notes,
        reservation_commitments=body.reservation_commitments,
        status=body.status,
        user_id=uid,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    if row.subscription_ids:
        # Fire-and-forget initial inventory scan. We snapshot the ORM row's
        # primitive fields because the bound session closes before the task runs.
        snapshot = Engagement(
            id=row.id,
            name=row.name,
            customer_name=row.customer_name,
            industry=row.industry,
            compliance_frameworks=list(row.compliance_frameworks or []),
            subscription_ids=list(row.subscription_ids),
            region_preference=row.region_preference,
            notes=row.notes,
            reservation_commitments=dict(row.reservation_commitments or {}),
            status=row.status,
            user_id=row.user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        asyncio.create_task(_background_scan(snapshot))
    return engagement_context.to_dict(row)


@router.get("/{engagement_id}")
async def get_engagement(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    row = await _load(session, engagement_id, uid)
    return engagement_context.to_dict(row)


@router.put("/{engagement_id}")
async def update_engagement(
    engagement_id: str,
    body: EngagementWrite,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    row = await _load(session, engagement_id, uid)
    row.name = body.name
    row.customer_name = body.customer_name
    row.industry = body.industry
    row.compliance_frameworks = body.compliance_frameworks
    row.subscription_ids = body.subscription_ids
    row.region_preference = body.region_preference
    row.notes = body.notes
    row.reservation_commitments = body.reservation_commitments
    row.status = body.status
    row.updated_at = int(time.time() * 1000)
    await session.commit()
    return engagement_context.to_dict(row)


@router.delete("/{engagement_id}", status_code=204)
async def delete_engagement(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> None:
    uid = _uid(claims)
    row = await _load(session, engagement_id, uid)
    await session.delete(row)
    await session.commit()


@router.get("/{engagement_id}/context")
async def engagement_preamble(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    row = await _load(session, engagement_id, uid)
    return {
        "engagement_id": row.id,
        "preamble": engagement_context.format_preamble(row),
    }


async def _load(session: AsyncSession, engagement_id: str, user_id: str) -> Engagement:
    result = await session.execute(
        select(Engagement)
        .where(Engagement.id == engagement_id)
        .where(Engagement.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="engagement not found")
    return row


async def _background_scan(engagement: Engagement) -> None:
    """Run an inventory scan outside the request lifecycle.

    Sets `engagement_id_var` so any RAG indexing inside the ingest path is
    correctly scoped. Failures are swallowed and logged — this is fire-and-
    forget; the user can re-trigger via POST /scan if it didn't finish.
    """
    token = engagement_id_var.set(engagement.id)
    try:
        result = await ingest_engagement(engagement)
        _log.info("engagement.background_scan_done", engagement_id=engagement.id, result=result)
    except Exception as exc:  # pragma: no cover - defensive
        _log.exception(
            "engagement.background_scan_failed",
            engagement_id=engagement.id,
            error=str(exc),
        )
    finally:
        engagement_id_var.reset(token)


@router.post("/{engagement_id}/scan")
async def scan_engagement(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> StreamingResponse:
    """Stream SSE progress while re-snapshotting the engagement's Azure
    inventory into the ``tenant_inventory`` corpus.

    Idempotent — the underlying ``index_documents`` upserts by SHA1 of
    ``source_id``, so re-running is safe.
    """
    uid = _uid(claims)
    row = await _load(session, engagement_id, uid)
    # Detach from session so we can hand it to the background ingest.
    snapshot = Engagement(
        id=row.id,
        name=row.name,
        customer_name=row.customer_name,
        industry=row.industry,
        compliance_frameworks=list(row.compliance_frameworks or []),
        subscription_ids=list(row.subscription_ids or []),
        region_preference=row.region_preference,
        notes=row.notes,
        reservation_commitments=dict(row.reservation_commitments or {}),
        status=row.status,
        user_id=row.user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )

    async def _stream():
        token = engagement_id_var.set(snapshot.id)
        try:
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "scan_started",
                        "engagement_id": snapshot.id,
                        "subscriptions": len(snapshot.subscription_ids or []),
                    }
                )
                + "\n\n"
            )
            if not snapshot.subscription_ids:
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "scan_skipped",
                            "engagement_id": snapshot.id,
                            "reason": "no_subscription_ids",
                        }
                    )
                    + "\n\n"
                )
                yield 'data: {"type": "done"}\n\n'
                return
            try:
                result = await ingest_engagement(snapshot)
            except Exception as exc:
                _log.exception(
                    "engagement.scan_failed", engagement_id=snapshot.id, error=str(exc)
                )
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "scan_failed",
                            "engagement_id": snapshot.id,
                            "error": str(exc),
                        }
                    )
                    + "\n\n"
                )
                yield 'data: {"type": "done"}\n\n'
                return
            yield (
                "data: " + json.dumps({"type": "scan_complete", **result}) + "\n\n"
            )
            yield 'data: {"type": "done"}\n\n'
        finally:
            engagement_id_var.reset(token)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{engagement_id}/inventory")
async def engagement_inventory(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Return aggregate counts + freshness for the engagement's tenant_inventory chunks."""
    uid = _uid(claims)
    await _load(session, engagement_id, uid)
    async with session_scope() as rag_session:
        rows = (
            (
                await rag_session.execute(
                    select(RagDocument)
                    .where(RagDocument.corpus == CORPUS_TENANT_INVENTORY)
                    .where(RagDocument.engagement_id == engagement_id)
                )
            )
            .scalars()
            .all()
        )
    if not rows:
        return {
            "engagement_id": engagement_id,
            "total_documents": 0,
            "by_fact_kind": {},
            "by_resource_type": {},
            "last_synced_at": None,
        }
    by_kind: Counter[str] = Counter()
    by_type: Counter[str] = Counter()
    last_synced = None
    for row in rows:
        meta = row.doc_metadata or {}
        by_kind[meta.get("fact_kind") or "unknown"] += 1
        rtype = meta.get("resource_type")
        if rtype:
            short = rtype.rsplit("/", 1)[-1] if "/" in rtype else rtype
            by_type[short] += 1
        if row.updated_at and (last_synced is None or row.updated_at > last_synced):
            last_synced = row.updated_at
    return {
        "engagement_id": engagement_id,
        "total_documents": len(rows),
        "by_fact_kind": dict(by_kind),
        "by_resource_type": dict(by_type.most_common(20)),
        "last_synced_at": last_synced.isoformat() if last_synced else None,
    }
