"""Cost governance endpoints — actuals, budget emit, anomaly KQL."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_user
from services import cost_service

router = APIRouter(prefix="/cost", tags=["cost"])


@router.get("/mtd")
async def mtd(
    subscription_id: str | None = Query(default=None),
    _=Depends(require_user),
) -> dict:
    try:
        rows = await asyncio.to_thread(cost_service.query_mtd_by_service, subscription_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cost query failed: {exc}") from exc
    return {"total": round(sum(r["cost"] for r in rows), 2), "by_service": rows}


class BudgetRequest(BaseModel):
    budget_name: str = Field(min_length=1, max_length=63)
    amount: float = Field(gt=0)
    contact_emails: list[str]
    thresholds: list[int] = Field(default_factory=lambda: [50, 80, 100, 110])


@router.post("/budget/bicep")
async def budget_bicep(req: BudgetRequest, _=Depends(require_user)) -> dict:
    if not req.contact_emails:
        raise HTTPException(status_code=400, detail="at least one contact email required")
    bicep = cost_service.emit_budget_bicep(
        budget_name=req.budget_name,
        amount=req.amount,
        contact_emails=req.contact_emails,
        thresholds=tuple(req.thresholds),
    )
    return {"filename": "budget.bicep", "content": bicep}


@router.get("/anomaly-kql")
async def anomaly_kql(
    lookback_days: int = Query(30, ge=7, le=365),
    sigma: float = Query(2.5, ge=1.0, le=6.0),
    _=Depends(require_user),
) -> dict:
    return {"kql": cost_service.anomaly_detection_kql(lookback_days, sigma)}
