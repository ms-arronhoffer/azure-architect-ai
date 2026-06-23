"""Cost governance endpoints — actuals, budget emit, anomaly KQL,
plus live retail / reservation / right-sizing / carbon endpoints."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import require_user
from services import (
    carbon_service,
    cost_catalog,
    cost_service,
    reservations_service,
    retail_pricing_service,
    rightsizing_service,
)
from services.cost_pipeline import CostOptimizeRequest, stream_cost_pipeline

router = APIRouter(prefix="/cost", tags=["cost"])


# ── Pricing calculator (cached catalog) ──────────────────────────────────────


@router.get("/catalog")
async def catalog(_=Depends(require_user)) -> dict:
    """Service / region / currency / buying-option metadata for the calculator
    dropdowns, sourced from the committed pricing snapshot."""
    return {
        "services": cost_catalog.list_services(),
        "regions": cost_catalog.list_regions(),
        "currencies": cost_catalog.list_currencies(),
        "buying_options": cost_catalog.list_buying_options(),
        "meta": cost_catalog.catalog_meta(),
    }


@router.get("/skus")
async def skus(
    service: str = Query(..., min_length=1),
    region: str = Query("eastus"),
    _=Depends(require_user),
) -> dict:
    """Region-priced SKU options for a service, to populate the SKU dropdown."""
    svc = cost_catalog.get_service(service)
    if not svc:
        raise HTTPException(status_code=404, detail=f"unknown service '{service}'")
    return {
        "service": service,
        "region": region,
        "unit": svc["unit"],
        "quantity_label": svc.get("quantity_label"),
        "usage_label": svc.get("usage_label"),
        "default_hours": svc.get("default_hours", 730),
        "default_quantity": svc.get("default_quantity", 1),
        "eligible_options": svc.get("eligible_options", ["payg"]),
        "hybrid_benefit": svc.get("hybrid_benefit"),
        "skus": cost_catalog.list_skus(service, region),
    }


class EstimateLineItem(BaseModel):
    service_key: str = Field(min_length=1)
    sku: str = ""
    region: str = "eastus"
    quantity: float = Field(default=1.0, ge=0)
    hours_per_month: float = Field(default=730.0, ge=0)
    buying_option: str = "payg"
    hybrid_benefit: bool = False


class EstimateRequest(BaseModel):
    items: list[EstimateLineItem] = Field(default_factory=list)
    currency: str = "USD"


@router.post("/estimate")
async def estimate(req: EstimateRequest, _=Depends(require_user)) -> dict:
    """Instant, deterministic cost estimate from the cached catalog — no network
    round-trip, so the calculator can recompute live as the user edits."""
    return cost_catalog.estimate(
        [li.model_dump() for li in req.items],
        currency=req.currency,
    )


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


@router.get("/retail")
async def retail_price(
    service: str = Query(..., min_length=1),
    sku: str = Query(""),
    region: str = Query("eastus"),
    quantity: float = Query(1.0, gt=0),
    hours_per_month: float = Query(730.0, gt=0),
    _=Depends(require_user),
) -> dict:
    try:
        return await retail_pricing_service.lookup(
            service=service,
            sku=sku,
            region=region,
            quantity=quantity,
            hours_per_month=hours_per_month,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/reservations")
async def reservations(
    subscription_id: str | None = Query(default=None),
    scope: str = Query("Single", pattern="^(Single|Shared)$"),
    lookback_days: int = Query(30),
    _=Depends(require_user),
) -> dict:
    if lookback_days not in (7, 30, 60):
        raise HTTPException(status_code=400, detail="lookback_days must be one of 7, 30, 60")
    try:
        return await asyncio.to_thread(
            reservations_service.recommend_reservations,
            subscription_id,
            scope,
            lookback_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class BreakEvenRequest(BaseModel):
    payg_monthly: float = Field(ge=0)
    reserved_monthly: float = Field(ge=0)
    upfront_cost: float = Field(default=0.0, ge=0)
    term_years: int = Field(default=1)


@router.post("/break-even")
async def break_even(req: BreakEvenRequest, _=Depends(require_user)) -> dict:
    if req.term_years not in (1, 3):
        raise HTTPException(status_code=400, detail="term_years must be 1 or 3")
    return reservations_service.break_even(
        payg_monthly=req.payg_monthly,
        reserved_monthly=req.reserved_monthly,
        upfront_cost=req.upfront_cost,
        term_years=req.term_years,
    )


@router.get("/rightsizing")
async def rightsizing(
    subscription_id: str | None = Query(default=None),
    window_days: int = Query(14, ge=3, le=60),
    threshold_pct: float = Query(40.0, ge=5.0, le=100.0),
    _=Depends(require_user),
) -> dict:
    try:
        return await asyncio.to_thread(
            rightsizing_service.assess_vms,
            subscription_id,
            window_days,
            threshold_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class CarbonLineItem(BaseModel):
    service: str
    sku: str = ""
    region: str = "eastus"
    quantity: float = 1.0
    hours_per_month: float = 730.0


class CarbonRequest(BaseModel):
    line_items: list[CarbonLineItem]
    compare_regions: list[str] = Field(default_factory=list)


@router.post("/carbon")
async def carbon(req: CarbonRequest, _=Depends(require_user)) -> dict:
    items = [li.model_dump() for li in req.line_items]
    out: dict = {"estimate": carbon_service.estimate_for_line_items(items)}
    if req.compare_regions:
        out["region_comparison"] = carbon_service.compare_regions(req.compare_regions, items)
    return out


@router.post("/optimize")
async def cost_optimize(req: CostOptimizeRequest, _=Depends(require_user)) -> StreamingResponse:
    async def gen():
        async for ev in stream_cost_pipeline(req):
            yield f"data: {json.dumps(ev, default=str)}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

