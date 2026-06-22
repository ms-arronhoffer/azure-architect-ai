"""Tests for the deterministic recommendations engine.

The carbon-based region heuristic uses the real (pure-Python) carbon_service;
everything else is grounded in the supplied breakdown, so no Azure calls run.
"""
from __future__ import annotations

import pytest

from services import cost_recommendations_service as rec


def _breakdown(lines):
    return {"line_items": lines}


def _compute_line(service, monthly, *, ri=True, category="compute", sku=""):
    return {
        "service": service,
        "display_name": service,
        "sku": sku,
        "category": category,
        "ri_eligible": ri,
        "meters": [
            {"dimension": "compute", "unit": "hour", "monthly_cost": monthly},
        ],
    }


@pytest.mark.asyncio
async def test_reserved_instance_recommendation_math():
    bd = _breakdown([_compute_line("Virtual Machines", 1000.0, ri=True)])
    items = [{"service": "Virtual Machines", "sku": "Standard_D4s_v5", "hours_per_month": 730}]
    out = await rec.recommend(bd, items)
    ri = next(r for r in out["recommendations"] if r["type"] == "reserved_instance")
    # VM catalog 3-year band is 0.62 → proposed 380, savings 620
    assert ri["current_monthly"] == 1000.0
    assert ri["proposed_monthly"] == pytest.approx(380.0)
    assert ri["monthly_savings"] == pytest.approx(620.0)
    assert out["total_annual_savings"] >= ri["monthly_savings"] * 12 * 0.99


@pytest.mark.asyncio
async def test_non_ri_eligible_service_gets_no_ri_rec():
    bd = _breakdown([_compute_line("Azure Functions", 500.0, ri=False)])
    items = [{"service": "Azure Functions", "hours_per_month": 730}]
    out = await rec.recommend(bd, items)
    assert not any(r["type"] == "reserved_instance" for r in out["recommendations"])


@pytest.mark.asyncio
async def test_idle_resource_recommendation_for_part_time():
    bd = _breakdown([_compute_line("Virtual Machines", 200.0, ri=False)])
    items = [{"service": "Virtual Machines", "sku": "Standard_D4s_v5", "hours_per_month": 400}]
    out = await rec.recommend(bd, items)
    idle = next(r for r in out["recommendations"] if r["type"] == "idle_resource")
    # 400h -> 160h => proposed = 200 * 160/400 = 80, savings 120
    assert idle["proposed_monthly"] == pytest.approx(80.0)
    assert idle["monthly_savings"] == pytest.approx(120.0)


@pytest.mark.asyncio
async def test_full_time_resource_gets_no_idle_rec():
    bd = _breakdown([_compute_line("Virtual Machines", 200.0, ri=False)])
    items = [{"service": "Virtual Machines", "hours_per_month": 730}]
    out = await rec.recommend(bd, items)
    assert not any(r["type"] == "idle_resource" for r in out["recommendations"])


@pytest.mark.asyncio
async def test_storage_redundancy_recommendation():
    line = {
        "service": "Storage",
        "display_name": "blobs",
        "sku": "Standard_GRS",
        "category": "storage",
        "ri_eligible": False,
        "meters": [{"dimension": "capacity", "unit": "GB-month", "monthly_cost": 100.0}],
    }
    out = await rec.recommend(_breakdown([line]), [{"service": "Storage"}])
    st = next(r for r in out["recommendations"] if r["type"] == "storage_tier")
    assert st["proposed_monthly"] == pytest.approx(50.0)
    assert st["monthly_savings"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_recommendations_sorted_by_savings_desc():
    bd = _breakdown(
        [
            _compute_line("Virtual Machines", 100.0, ri=True),
            _compute_line("App Service", 2000.0, ri=True),
        ]
    )
    items = [
        {"service": "Virtual Machines", "hours_per_month": 730},
        {"service": "App Service", "hours_per_month": 730},
    ]
    out = await rec.recommend(bd, items)
    savings = [r["monthly_savings"] or 0 for r in out["recommendations"]]
    assert savings == sorted(savings, reverse=True)


@pytest.mark.asyncio
async def test_empty_breakdown_yields_no_recommendations():
    out = await rec.recommend(_breakdown([]), [])
    assert out["count"] == 0
    assert out["recommendations"] == []
