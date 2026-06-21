"""Architecture Review Board (ARB) workflow routes.

The ARB workflow bridges the gap between "we made a design" and "the design
is deployed in prod". A submission freezes a ``BundledDesign`` (architecture
+ sizing + security + WAF + cost) and its citation set at submit time, so
reviewers always see what was signed off on even when the upstream RAG corpora
or design panels are later edited.

Status transitions are gated by ``_ALLOWED_TRANSITIONS`` — the matrix is
intentionally narrow (e.g. you can withdraw a draft, but not an approval).
PDF packet generation is a background task: the route returns the submission
immediately with ``reviewer_packet_url=None`` and patches the row when the
PDF lands under ``backend/data/arb_packets/{submission_id}.pdf``.

Audit events (via structlog, not the ``AuditEvent`` HTTP middleware):
``arb.submitted``, ``arb.decided``, ``arb.condition_cleared``,
``arb.condition_waived``.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import (
    ArbCondition,
    ArbSubmission,
    Engagement,
    RagDocument,
    engagement_id_var,
    get_session,
    select,
    session_scope,
)
from middleware.logging import get_logger
from services.arb_packet_service import build_arb_packet
from services.rag_service import CORPUS_TENANT_INVENTORY

router = APIRouter(tags=["arb"])

_log = get_logger("arb")

# Where the reviewer PDF lands. Stored on disk (not the DB) because the
# packets can grow to several MB and PostgreSQL bytea isn't the right
# storage for static artifacts. Path is configurable via env via
# the data-dir convention if we ever need it.
_PACKET_DIR = Path(__file__).resolve().parent.parent / "data" / "arb_packets"


_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted", "withdrawn"},
    "submitted": {"in_review", "withdrawn", "rejected"},
    "in_review": {"approved", "approved_with_conditions", "rejected", "withdrawn"},
    # Terminal states accept no further transitions.
    "approved": set(),
    "approved_with_conditions": {"approved"},  # all conditions cleared promotes
    "rejected": set(),
    "withdrawn": set(),
}

_CONDITION_STATUSES = {"open", "in_progress", "cleared", "waived"}
_CONDITION_SEVERITIES = {"blocker", "major", "minor"}


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _submission_to_dict(row: ArbSubmission) -> dict[str, Any]:
    return {
        "id": row.id,
        "engagement_id": row.engagement_id,
        "title": row.title,
        "submitted_by": row.submitted_by,
        "submitted_at": row.submitted_at,
        "status": row.status,
        "bundled_design_snapshot": row.bundled_design_snapshot,
        "citation_snapshot": row.citation_snapshot,
        "inventory_snapshot_at": row.inventory_snapshot_at,
        "reviewer_packet_url": row.reviewer_packet_url,
        "decision_summary": row.decision_summary,
        "decided_at": row.decided_at,
        "decided_by": row.decided_by,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _condition_to_dict(row: ArbCondition) -> dict[str, Any]:
    return {
        "id": row.id,
        "submission_id": row.submission_id,
        "text": row.text,
        "severity": row.severity,
        "status": row.status,
        "owner": row.owner,
        "due_date": row.due_date,
        "evidence_url": row.evidence_url,
        "cleared_at": row.cleared_at,
        "cleared_by": row.cleared_by,
        "notes": row.notes,
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


async def _load_submission(
    session: AsyncSession, submission_id: str, user_id: str
) -> ArbSubmission:
    result = await session.execute(
        select(ArbSubmission)
        .where(ArbSubmission.id == submission_id)
        .where(ArbSubmission.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="submission not found")
    return row


async def _load_condition(
    session: AsyncSession, condition_id: str, user_id: str
) -> tuple[ArbCondition, ArbSubmission]:
    cond = (
        await session.execute(
            select(ArbCondition).where(ArbCondition.id == condition_id)
        )
    ).scalar_one_or_none()
    if cond is None:
        raise HTTPException(status_code=404, detail="condition not found")
    sub = await _load_submission(session, cond.submission_id, user_id)
    return cond, sub


async def _inventory_snapshot_for(engagement_id: str) -> dict[str, Any]:
    """Mirror engagements.py::engagement_inventory but return a plain dict.

    Captured at submit time so the ARB PDF shows what the tenant looked like
    when the design was frozen.
    """
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


def _engagement_to_dict(row: Engagement) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "customer_name": row.customer_name,
        "industry": row.industry,
        "compliance_frameworks": list(row.compliance_frameworks or []),
        "subscription_ids": list(row.subscription_ids or []),
        "region_preference": row.region_preference,
    }


async def _generate_packet_async(
    submission_id: str,
    user_id: str,
    engagement_snapshot: dict[str, Any],
    inventory: dict[str, Any],
) -> None:
    """Build the PDF and patch ``reviewer_packet_url`` when it lands.

    Runs outside the request lifecycle. We re-load the submission inside a
    fresh session because the original request session is already closed.
    Failures are logged and leave ``reviewer_packet_url`` null so the user
    can re-trigger generation later if needed.
    """
    try:
        _PACKET_DIR.mkdir(parents=True, exist_ok=True)
        async with session_scope() as session:
            sub = (
                await session.execute(
                    select(ArbSubmission)
                    .where(ArbSubmission.id == submission_id)
                    .where(ArbSubmission.user_id == user_id)
                )
            ).scalar_one_or_none()
            if sub is None:
                _log.warning("arb.packet_submission_missing", submission_id=submission_id)
                return
            conditions = (
                (
                    await session.execute(
                        select(ArbCondition).where(
                            ArbCondition.submission_id == submission_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            cond_dicts = [_condition_to_dict(c) for c in conditions]
            sub_dict = _submission_to_dict(sub)

        pdf_bytes = await asyncio.to_thread(
            build_arb_packet,
            submission=sub_dict,
            engagement=engagement_snapshot,
            conditions=cond_dicts,
            inventory=inventory,
        )

        path = _PACKET_DIR / f"{submission_id}.pdf"
        await asyncio.to_thread(path.write_bytes, pdf_bytes)

        async with session_scope() as session:
            sub = (
                await session.execute(
                    select(ArbSubmission)
                    .where(ArbSubmission.id == submission_id)
                    .where(ArbSubmission.user_id == user_id)
                )
            ).scalar_one_or_none()
            if sub is None:
                return
            sub.reviewer_packet_url = f"/api/arb/submissions/{submission_id}/packet.pdf"
            sub.updated_at = _now_ms()
            await session.commit()
        _log.info("arb.packet_generated", submission_id=submission_id, bytes=len(pdf_bytes))
    except Exception as exc:  # pragma: no cover - defensive
        _log.exception(
            "arb.packet_generation_failed",
            submission_id=submission_id,
            error=str(exc),
        )


class ConditionInput(BaseModel):
    text: str = Field(min_length=1)
    severity: str = "minor"
    owner: str | None = None
    due_date: int | None = None
    notes: str | None = None


class SubmissionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    bundled_design_snapshot: dict[str, Any] = Field(default_factory=dict)
    citation_snapshot: list[dict[str, Any]] = Field(default_factory=list)
    conditions: list[ConditionInput] = Field(default_factory=list)


class SubmissionPatch(BaseModel):
    status: str | None = None
    decision_summary: str | None = None
    decided_by: str | None = None


class ConditionPatch(BaseModel):
    status: str | None = None
    owner: str | None = None
    due_date: int | None = None
    evidence_url: str | None = None
    notes: str | None = None
    severity: str | None = None
    text: str | None = None


@router.post("/engagements/{engagement_id}/arb/submissions", status_code=201)
async def create_submission(
    engagement_id: str,
    body: SubmissionCreate,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Freeze a BundledDesign + citations as an ARB submission.

    The PDF reviewer packet is generated in the background — the response
    arrives with ``reviewer_packet_url=null`` and the field is patched in
    place once the file lands. Frontend polls (or refreshes the submission)
    to discover the URL.
    """
    uid = _uid(claims)
    engagement = await _load_engagement(session, engagement_id, uid)

    if not body.bundled_design_snapshot:
        raise HTTPException(
            status_code=422, detail="bundled_design_snapshot is required"
        )

    now = _now_ms()
    submission_id = uuid.uuid4().hex

    # Sample the inventory inside the request so the snapshot reflects what
    # the architect saw at submit time.
    token = engagement_id_var.set(engagement_id)
    try:
        inventory = await _inventory_snapshot_for(engagement_id)
    finally:
        engagement_id_var.reset(token)

    submission = ArbSubmission(
        id=submission_id,
        engagement_id=engagement_id,
        title=body.title,
        submitted_by=uid,
        submitted_at=now,
        status="submitted",
        bundled_design_snapshot=body.bundled_design_snapshot,
        citation_snapshot=body.citation_snapshot,
        inventory_snapshot_at=now,
        reviewer_packet_url=None,
        decision_summary=None,
        decided_at=None,
        decided_by=None,
        user_id=uid,
        created_at=now,
        updated_at=now,
    )
    session.add(submission)

    for ci in body.conditions:
        sev = ci.severity.lower()
        if sev not in _CONDITION_SEVERITIES:
            raise HTTPException(
                status_code=422,
                detail=f"invalid severity '{ci.severity}'; expected one of {sorted(_CONDITION_SEVERITIES)}",
            )
        session.add(
            ArbCondition(
                id=uuid.uuid4().hex,
                submission_id=submission_id,
                text=ci.text,
                severity=sev,
                status="open",
                owner=ci.owner,
                due_date=ci.due_date,
                evidence_url=None,
                cleared_at=None,
                cleared_by=None,
                notes=ci.notes,
                created_at=now,
                updated_at=now,
            )
        )

    await session.commit()

    _log.info(
        "arb.submitted",
        submission_id=submission_id,
        engagement_id=engagement_id,
        submitted_by=uid,
        title=body.title,
        condition_count=len(body.conditions),
    )

    engagement_snapshot = _engagement_to_dict(engagement)
    asyncio.create_task(
        _generate_packet_async(submission_id, uid, engagement_snapshot, inventory)
    )

    return _submission_to_dict(submission)


@router.get("/engagements/{engagement_id}/arb/submissions")
async def list_submissions(
    engagement_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> list[dict[str, Any]]:
    uid = _uid(claims)
    await _load_engagement(session, engagement_id, uid)
    rows = (
        (
            await session.execute(
                select(ArbSubmission)
                .where(ArbSubmission.engagement_id == engagement_id)
                .where(ArbSubmission.user_id == uid)
                .order_by(ArbSubmission.submitted_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_submission_to_dict(r) for r in rows]


@router.get("/arb/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    sub = await _load_submission(session, submission_id, uid)
    conditions = (
        (
            await session.execute(
                select(ArbCondition)
                .where(ArbCondition.submission_id == submission_id)
                .order_by(ArbCondition.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return {
        **_submission_to_dict(sub),
        "conditions": [_condition_to_dict(c) for c in conditions],
    }


@router.patch("/arb/submissions/{submission_id}")
async def update_submission(
    submission_id: str,
    body: SubmissionPatch,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    sub = await _load_submission(session, submission_id, uid)

    if body.status is not None and body.status != sub.status:
        allowed = _ALLOWED_TRANSITIONS.get(sub.status, set())
        if body.status not in allowed:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"invalid transition {sub.status!r} -> {body.status!r}; "
                    f"allowed: {sorted(allowed) or 'none (terminal state)'}"
                ),
            )
        sub.status = body.status
        if body.status in {
            "approved",
            "approved_with_conditions",
            "rejected",
        }:
            sub.decided_at = _now_ms()
            sub.decided_by = uid
            _log.info(
                "arb.decided",
                submission_id=submission_id,
                decision=body.status,
                decided_by=uid,
            )

    if body.decision_summary is not None:
        sub.decision_summary = body.decision_summary
    if body.decided_by is not None:
        sub.decided_by = body.decided_by

    sub.updated_at = _now_ms()
    await session.commit()
    return _submission_to_dict(sub)


@router.post("/arb/submissions/{submission_id}/conditions", status_code=201)
async def add_condition(
    submission_id: str,
    body: ConditionInput,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    await _load_submission(session, submission_id, uid)
    sev = body.severity.lower()
    if sev not in _CONDITION_SEVERITIES:
        raise HTTPException(
            status_code=422,
            detail=f"invalid severity '{body.severity}'",
        )
    now = _now_ms()
    cond = ArbCondition(
        id=uuid.uuid4().hex,
        submission_id=submission_id,
        text=body.text,
        severity=sev,
        status="open",
        owner=body.owner,
        due_date=body.due_date,
        evidence_url=None,
        cleared_at=None,
        cleared_by=None,
        notes=body.notes,
        created_at=now,
        updated_at=now,
    )
    session.add(cond)
    await session.commit()
    return _condition_to_dict(cond)


@router.patch("/arb/conditions/{condition_id}")
async def update_condition(
    condition_id: str,
    body: ConditionPatch,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    uid = _uid(claims)
    cond, _sub = await _load_condition(session, condition_id, uid)

    if body.status is not None:
        new_status = body.status.lower()
        if new_status not in _CONDITION_STATUSES:
            raise HTTPException(
                status_code=422,
                detail=f"invalid status '{body.status}'",
            )
        if new_status == "cleared" and cond.status != "cleared":
            cond.cleared_at = _now_ms()
            cond.cleared_by = uid
            _log.info(
                "arb.condition_cleared",
                condition_id=condition_id,
                submission_id=cond.submission_id,
                cleared_by=uid,
            )
        elif new_status == "waived" and cond.status != "waived":
            cond.cleared_at = _now_ms()
            cond.cleared_by = uid
            _log.info(
                "arb.condition_waived",
                condition_id=condition_id,
                submission_id=cond.submission_id,
                waived_by=uid,
            )
        cond.status = new_status

    if body.owner is not None:
        cond.owner = body.owner or None
    if body.due_date is not None:
        cond.due_date = body.due_date
    if body.evidence_url is not None:
        cond.evidence_url = body.evidence_url or None
    if body.notes is not None:
        cond.notes = body.notes
    if body.severity is not None:
        sev = body.severity.lower()
        if sev not in _CONDITION_SEVERITIES:
            raise HTTPException(status_code=422, detail="invalid severity")
        cond.severity = sev
    if body.text is not None:
        cond.text = body.text

    cond.updated_at = _now_ms()
    await session.commit()
    return _condition_to_dict(cond)


@router.get("/arb/submissions/{submission_id}/packet.pdf")
async def download_packet(
    submission_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> FileResponse:
    uid = _uid(claims)
    sub = await _load_submission(session, submission_id, uid)
    path = _PACKET_DIR / f"{submission_id}.pdf"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="packet not yet generated; retry in a few seconds",
        )
    filename = f"arb-{sub.id[:8]}.pdf"
    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=filename,
    )
