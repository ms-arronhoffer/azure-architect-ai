"""Security posture endpoints — live Policy + Defender vs baseline."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_user
from services import security_posture_service

router = APIRouter(prefix="/security", tags=["security"])


@router.get("/policy/noncompliant")
async def policy_noncompliant(
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        rows = await asyncio.to_thread(
            security_posture_service.list_policy_states, subscription_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"policy query failed: {exc}") from exc
    return {"count": len(rows), "noncompliant": rows}


@router.get("/defender/recommendations")
async def defender_recommendations(
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        rows = await asyncio.to_thread(
            security_posture_service.list_defender_recommendations, subscription_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"defender query failed: {exc}") from exc
    return {"count": len(rows), "recommendations": rows}


@router.get("/posture")
async def posture(
    reference_arch_id: str = Query(...),
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        return await asyncio.to_thread(
            security_posture_service.scan_security_posture,
            reference_arch_id,
            subscription_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"posture scan failed: {exc}") from exc
