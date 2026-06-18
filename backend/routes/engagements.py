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

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import Engagement, get_session, select
from services import engagement_context

router = APIRouter(prefix="/engagements", tags=["engagements"])


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
