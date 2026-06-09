"""Azure subscription scan + drift detection endpoints."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_user
from services import azure_scan_service

router = APIRouter(prefix="/scan", tags=["scan"])


class DriftAgainstDesignRequest(BaseModel):
    design_name: str
    bicep: str
    subscription_id: str | None = None


@router.get("/resources")
async def resources(
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        items = await asyncio.to_thread(azure_scan_service.list_resources, subscription_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"resource graph failed: {exc}") from exc
    return {"count": len(items), "resources": items}


@router.get("/drift")
async def drift(
    reference_arch_id: str = Query(...),
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        return await asyncio.to_thread(
            azure_scan_service.scan_drift, reference_arch_id, subscription_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"scan failed: {exc}") from exc


@router.post("/drift/design")
async def drift_against_design(
    req: DriftAgainstDesignRequest,
    _=Depends(require_user),
) -> dict:
    try:
        return await asyncio.to_thread(
            azure_scan_service.scan_drift_against_design,
            req.design_name,
            req.bicep,
            req.subscription_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"scan failed: {exc}") from exc
