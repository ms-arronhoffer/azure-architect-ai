"""Deterministic cost optimization pipeline with final LLM narration.

Mirrors the architecture pipeline template in `routes/analyze.py::_stream_pipeline`
but each phase runs a deterministic cost service instead of streaming LLM tokens.
Engagement-dependent phases (reservations, rightsizing, break_even) emit
`phase_skipped` when no engagement is active or required SDKs are missing —
they never raise.

Final event is `cost_optimization` carrying every phase's output plus the
narrated Markdown report.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
from collections.abc import AsyncGenerator
from typing import Any

from pydantic import BaseModel, Field

from middleware.logging import get_logger
from prompts.cost_narration import COST_NARRATION_PROMPT
from services import (
    carbon_service,
    cost_recommendations_service,
    meter_pricing_service,
    openai_service,
    reservations_service,
    retail_pricing_service,
    rightsizing_service,
)
from services.engagement_context import load_active

log = get_logger("cost_pipeline")


class CostLineItem(BaseModel):
    service: str
    sku: str = ""
    region: str = "eastus"
    quantity: float = 1.0
    hours_per_month: float = 730.0
    # Meter-aware extensions (all optional — bare {service, sku} still works).
    dimensions: dict[str, float] = Field(default_factory=dict)
    display_name: str = ""
    tags: list[str] = Field(default_factory=list)
    commitment: str = "none"  # none | 1yr_ri | 3yr_ri | savings_plan


class ReservationCommitment(BaseModel):
    sku: str
    term_years: int = 1
    monthly_payg_equivalent: float = 0.0
    reserved_monthly: float = 0.0
    upfront_cost: float = 0.0


class CostOptimizeRequest(BaseModel):
    items: list[CostLineItem] = Field(default_factory=list)
    region: str = "eastus"
    commitments: list[ReservationCommitment] = Field(default_factory=list)


def _phase_event(phase: str, status: str, **extra: Any) -> dict:
    return {"type": f"phase_{status}", "phase": phase, **extra}


async def _phase_estimate(
    req: CostOptimizeRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("estimate", "started")
    if not req.items:
        yield _phase_event("estimate", "skipped", reason="no_line_items")
        return
    try:
        items_payload = [li.model_dump() for li in req.items]
        # Meter-aware breakdown: prices every billing dimension a service emits.
        breakdown = await meter_pricing_service.price_model(
            items_payload, region_default=req.region
        )
        state["cost_breakdown"] = breakdown
        # Keep the legacy single-meter shape too, for any downstream consumer
        # that still expects `estimate.line_items[].monthly_estimate`.
        state["estimate"] = {
            "line_items": [
                {
                    "service": line.get("service"),
                    "sku": line.get("sku"),
                    "region": line.get("region"),
                    "monthly_estimate": line.get("monthly_subtotal"),
                    "meters": line.get("meters", []),
                }
                for line in breakdown.get("line_items", [])
            ],
            "total_monthly_estimate": breakdown.get("total_monthly_estimate"),
            "currency": breakdown.get("currency"),
            "summary": breakdown.get("summary"),
        }
        yield _phase_event(
            "estimate",
            "complete",
            total_monthly_estimate=breakdown.get("total_monthly_estimate"),
            line_count=len(breakdown.get("line_items", [])),
            unpriced_meters=breakdown.get("summary", {}).get("unpriced_meters", 0),
        )
    except Exception as exc:
        log.warning("cost_pipeline.estimate_failed", error=str(exc))
        yield _phase_event("estimate", "failed", error=str(exc))


async def _phase_live_price(
    req: CostOptimizeRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("live_price", "started")
    if not req.items:
        yield _phase_event("live_price", "skipped", reason="no_line_items")
        return
    try:
        lookups = await asyncio.gather(
            *[
                retail_pricing_service.lookup(
                    service=li.service,
                    sku=li.sku,
                    region=li.region,
                    quantity=li.quantity,
                    hours_per_month=li.hours_per_month,
                )
                for li in req.items
            ],
            return_exceptions=True,
        )
        results: list[dict] = []
        for li, raw in zip(req.items, lookups, strict=True):
            if isinstance(raw, Exception):
                results.append({"service": li.service, "sku": li.sku, "error": str(raw)})
            else:
                results.append(raw)
        state["live_price"] = {"lookups": results}
        priced = sum(1 for r in results if r.get("monthly_estimate") is not None)
        yield _phase_event(
            "live_price", "complete", lookup_count=len(results), priced_count=priced
        )
    except Exception as exc:
        log.warning("cost_pipeline.live_price_failed", error=str(exc))
        yield _phase_event("live_price", "failed", error=str(exc))


async def _phase_carbon(
    req: CostOptimizeRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("carbon", "started")
    if not req.items:
        yield _phase_event("carbon", "skipped", reason="no_line_items")
        return
    try:
        items_payload = [li.model_dump() for li in req.items]
        result = await asyncio.to_thread(carbon_service.estimate_for_line_items, items_payload)
        state["carbon"] = result
        yield _phase_event(
            "carbon",
            "complete",
            total_kgco2e_per_month=result.get("total_kgco2e_per_month"),
        )
    except Exception as exc:
        log.warning("cost_pipeline.carbon_failed", error=str(exc))
        yield _phase_event("carbon", "failed", error=str(exc))


async def _phase_reservations(
    sub_id: str | None, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("reservations", "started")
    if not sub_id:
        yield _phase_event("reservations", "skipped", reason="no_engagement")
        return
    try:
        result = await asyncio.to_thread(
            reservations_service.recommend_reservations, sub_id, "Single", 30
        )
        state["reservations"] = result
        yield _phase_event(
            "reservations",
            "complete",
            recommendation_count=len(result.get("recommendations", [])),
        )
    except Exception as exc:
        log.warning("cost_pipeline.reservations_failed", error=str(exc))
        yield _phase_event("reservations", "failed", error=str(exc))


async def _phase_rightsizing(
    sub_id: str | None, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("rightsizing", "started")
    if not sub_id:
        yield _phase_event("rightsizing", "skipped", reason="no_engagement")
        return
    try:
        result = await asyncio.to_thread(rightsizing_service.assess_vms, sub_id)
        state["rightsizing"] = result
        yield _phase_event(
            "rightsizing",
            "complete",
            vm_count=result.get("vm_count", 0),
            underutilised_count=result.get("underutilised_count", 0),
        )
    except RuntimeError as exc:
        # azure-monitor-query SDK missing — degrade, don't fail
        log.info("cost_pipeline.rightsizing_unavailable", error=str(exc))
        yield _phase_event("rightsizing", "skipped", reason="monitor_sdk_missing")
    except Exception as exc:
        log.warning("cost_pipeline.rightsizing_failed", error=str(exc))
        yield _phase_event("rightsizing", "failed", error=str(exc))


async def _phase_break_even(state: dict[str, Any]) -> AsyncGenerator[dict, None]:
    yield _phase_event("break_even", "started")
    reservations = state.get("reservations") or {}
    recs = reservations.get("recommendations") or []
    if not recs:
        yield _phase_event("break_even", "skipped", reason="depends_on_reservations")
        return
    try:
        analyses: list[dict] = []
        for rec in recs:
            payg = float(rec.get("payg_monthly", 0) or 0)
            reserved = float(rec.get("reserved_monthly", 0) or 0)
            upfront = float(rec.get("upfront_cost", 0) or 0)
            term = int(rec.get("term_years", 1) or 1)
            if payg <= 0 or reserved <= 0:
                continue
            be = reservations_service.break_even(
                payg_monthly=payg,
                reserved_monthly=reserved,
                upfront_cost=upfront,
                term_years=term,
            )
            analyses.append(
                {
                    "sku": rec.get("sku"),
                    "region": rec.get("region"),
                    "term_years": term,
                    **be,
                }
            )
        state["break_even"] = {"analyses": analyses}
        yield _phase_event("break_even", "complete", analysis_count=len(analyses))
    except Exception as exc:
        log.warning("cost_pipeline.break_even_failed", error=str(exc))
        yield _phase_event("break_even", "failed", error=str(exc))


async def _phase_recommendations(
    req: CostOptimizeRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    """Deterministic, engagement-free savings recommendations grounded in the
    meter-level breakdown. Never raises."""
    yield _phase_event("recommendations", "started")
    breakdown = state.get("cost_breakdown")
    if not breakdown or not breakdown.get("line_items"):
        yield _phase_event("recommendations", "skipped", reason="no_breakdown")
        return
    try:
        items_payload = [li.model_dump() for li in req.items]
        result = await cost_recommendations_service.recommend(breakdown, items_payload)
        state["recommendations"] = result
        yield _phase_event(
            "recommendations",
            "complete",
            recommendation_count=result.get("count", 0),
            total_monthly_savings=result.get("total_monthly_savings", 0),
        )
    except Exception as exc:
        log.warning("cost_pipeline.recommendations_failed", error=str(exc))
        yield _phase_event("recommendations", "failed", error=str(exc))


async def _phase_narration(
    req: CostOptimizeRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("narration", "started")
    try:
        cost_state_json = json.dumps(
            {
                "estimate": state.get("estimate"),
                "cost_breakdown": state.get("cost_breakdown"),
                "live_price": state.get("live_price"),
                "carbon": state.get("carbon"),
                "reservations": state.get("reservations"),
                "rightsizing": state.get("rightsizing"),
                "break_even": state.get("break_even"),
                "recommendations": state.get("recommendations"),
            },
            default=str,
            indent=2,
        )
        prompt = COST_NARRATION_PROMPT.format(cost_state_json=cost_state_json)
        client, deployment = openai_service.resolve_client_and_model(mode="chat", provider="azure")
        resp = await asyncio.to_thread(
            openai_service.call_with_retry,
            lambda: client.chat.completions.create(
                model=deployment,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_completion_tokens=900,
            ),
            max_attempts=2,
            model_name=deployment,
        )
        text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
        state["narration_text"] = text
        yield _phase_event("narration", "complete", report_length=len(text))
    except Exception as exc:
        log.warning("cost_pipeline.narration_failed", error=str(exc))
        state["narration_text"] = ""
        yield _phase_event("narration", "failed", error=str(exc))


async def stream_cost_pipeline(
    req: CostOptimizeRequest,
) -> AsyncGenerator[dict, None]:
    """8-phase deterministic cost optimization with final LLM narration.

    Pulls engagement from `current_engagement_id()` ContextVar. Phases that
    need a subscription ID emit `phase_skipped` when the active engagement
    lacks `subscription_ids` — never raises.
    """
    state: dict[str, Any] = {
        "estimate": None,
        "cost_breakdown": None,
        "live_price": None,
        "carbon": None,
        "reservations": None,
        "rightsizing": None,
        "break_even": None,
        "recommendations": None,
    }

    try:
        engagement = await load_active()
    except Exception as exc:
        log.warning("cost_pipeline.engagement_load_failed", error=str(exc))
        engagement = None
    sub_id = (engagement.subscription_ids or [None])[0] if engagement else None

    async for ev in _phase_estimate(req, state):
        yield ev
    async for ev in _phase_live_price(req, state):
        yield ev
    async for ev in _phase_carbon(req, state):
        yield ev
    async for ev in _phase_reservations(sub_id, state):
        yield ev
    async for ev in _phase_rightsizing(sub_id, state):
        yield ev
    async for ev in _phase_break_even(state):
        yield ev
    async for ev in _phase_recommendations(req, state):
        yield ev
    async for ev in _phase_narration(req, state):
        yield ev

    report = state.pop("narration_text", "")
    yield {
        "type": "cost_optimization",
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
        "engagement_id": getattr(engagement, "id", None) if engagement else None,
        "estimate": state.get("estimate"),
        "cost_breakdown": state.get("cost_breakdown"),
        "live_price": state.get("live_price"),
        "carbon": state.get("carbon"),
        "reservations": state.get("reservations"),
        "rightsizing": state.get("rightsizing"),
        "break_even": state.get("break_even"),
        "recommendations": state.get("recommendations"),
        "report": report,
    }
