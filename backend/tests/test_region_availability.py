"""Tests for region_availability_service and the Pricing Desk tool dispatch.

The Azure Retail API is monkeypatched with a deterministic fake so the tests
run hermetically.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def fake_retail(monkeypatch):
    """Install a fake pricing_service.get_price keyed by region."""
    from services import pricing_service

    # region -> list of price records
    by_region: dict[str, list[dict]] = {}

    async def fake_get_price(
        service,
        sku_name="",
        region="eastus",
        currency="USD",
        *,
        meter_name="",
        product_name="",
        unit_of_measure="",
    ):
        return by_region.get(region, [])

    monkeypatch.setattr(pricing_service, "get_price", fake_get_price)
    return by_region


@pytest.mark.asyncio
async def test_availability_sorts_cheapest_first_and_flags_cheapest(fake_retail):
    from services import region_availability_service as ras

    fake_retail["eastus"] = [
        {"skuName": "D8s v5", "retailPrice": 0.40, "unitOfMeasure": "1 Hour", "currencyCode": "USD"}
    ]
    fake_retail["westeurope"] = [
        {"skuName": "D8s v5", "retailPrice": 0.30, "unitOfMeasure": "1 Hour", "currencyCode": "USD"}
    ]
    # uksouth returns nothing -> unavailable

    result = await ras.availability(
        "Virtual Machines", "D8s v5", regions=["eastus", "westeurope", "uksouth"]
    )

    assert result["cheapest_region"] == "westeurope"
    assert result["available_count"] == 2
    assert result["total_regions"] == 3
    regions = result["regions"]
    # Cheapest available first, unavailable last.
    assert regions[0]["region"] == "westeurope"
    assert regions[0]["cheapest"] is True
    assert regions[1]["region"] == "eastus"
    assert regions[1]["cheapest"] is False
    assert regions[-1]["region"] == "uksouth"
    assert regions[-1]["available"] is False


@pytest.mark.asyncio
async def test_availability_all_unavailable(fake_retail):
    from services import region_availability_service as ras

    result = await ras.availability("Nonexistent", "X", regions=["eastus", "westus2"])
    assert result["available_count"] == 0
    assert result["cheapest_region"] is None
    assert all(not r["available"] for r in result["regions"])


@pytest.mark.asyncio
async def test_availability_never_raises_on_lookup_error(monkeypatch):
    from services import pricing_service
    from services import region_availability_service as ras

    async def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(pricing_service, "get_price", boom)
    result = await ras.availability("Virtual Machines", "D8s v5", regions=["eastus"])
    assert result["available_count"] == 0
    assert result["regions"][0]["available"] is False


@pytest.mark.asyncio
async def test_dispatch_price_services_emits_worksheet(fake_retail, monkeypatch):
    from routes.chat import _dispatch_tool

    fake_retail["eastus"] = [
        {"skuName": "D8s v5", "retailPrice": 0.40, "unitOfMeasure": "1 Hour", "currencyCode": "USD"}
    ]
    # No active engagement -> reservation branch is a no-op.
    from services import engagement_context

    async def no_engagement():
        return None

    monkeypatch.setattr(engagement_context, "load_active", no_engagement)

    result, event = await _dispatch_tool(
        "price_services",
        {"line_items": [{"service": "Virtual Machines", "sku": "D8s v5", "region": "eastus"}]},
    )
    assert event is not None
    assert event["type"] == "priced_worksheet"
    assert "line_items" in event["worksheet"]
    assert result["status"] == "worksheet_priced"


@pytest.mark.asyncio
async def test_dispatch_check_region_availability_event(fake_retail):
    from routes.chat import _dispatch_tool

    fake_retail["westeurope"] = [
        {"skuName": "D8s v5", "retailPrice": 0.30, "unitOfMeasure": "1 Hour", "currencyCode": "USD"}
    ]
    result, event = await _dispatch_tool(
        "check_region_availability",
        {"service": "Virtual Machines", "sku": "D8s v5", "regions": ["westeurope", "eastus"]},
    )
    assert event is not None
    assert event["type"] == "region_availability"
    assert result["cheapest_region"] == "westeurope"
