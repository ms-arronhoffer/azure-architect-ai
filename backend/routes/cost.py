"""Cost governance endpoints — actuals, budget emit, anomaly KQL,
plus live retail / reservation / right-sizing / carbon endpoints."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from auth import require_user
from services import (
    carbon_service,
    cost_catalog,
    cost_service,
    cost_template_service,
    reservations_service,
    retail_pricing_service,
    rightsizing_service,
)
from services.cost_pipeline import CostOptimizeRequest, stream_cost_pipeline

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


@router.get("/catalog")
async def catalog(_=Depends(require_user)) -> dict:
    """Service billing catalog: services + their billing dimensions, for the UI
    to render dimension fields dynamically and validate input."""
    return cost_catalog.public_catalog()


@router.get("/template/sample")
async def template_sample(
    format: str = Query("yaml", pattern="^(yaml|json|csv)$"),
    _=Depends(require_user),
) -> Response:
    """Download a documented sample cost-model template (yaml | json | csv)."""
    try:
        content, media, filename = cost_template_service.sample_template(format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/template/parse")
async def template_parse(request: Request, _=Depends(require_user)) -> dict:
    """Parse + validate an uploaded cost-model template (yaml/json/csv body, or
    pre-extracted text from an .xlsx via /api/parse). Returns a normalized
    request shape plus per-entry validation warnings (never 500 on bad input)."""
    fmt = (request.headers.get("X-Template-Format") or "").strip()
    if not fmt:
        filename = request.headers.get("X-Filename", "")
        if "." in filename:
            fmt = filename.rsplit(".", 1)[-1]
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded template is empty.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=422, detail="Template must be UTF-8 encoded text."
        ) from None
    return cost_template_service.parse_template(text, fmt)

