"""Unit tests for the catalog-first pricing resolver.

These assert the exact production bugs are fixed using the committed snapshot
catalog (no DB, no live network calls):

* ``P1v4`` App Service resolves to the ``P1 v4`` premium meter, **not** the
  $0.01/hr ``Shared App`` meter (the $9.49/mo screenshot bug).
* APIM ``Premium`` picks the managed ``Premium Unit`` meter, not the cheaper
  ``Self Hosted Gateway`` meter.
* Azure Cache for Redis ``C1`` resolves via the ``C1 Cache`` meter name even
  though its ``skuName`` is only the tier (``Standard``).
* Compact ARM/diagram SKU forms collide with the Retail display form.
* Unknown SKUs come back low-confidence instead of a fabricated cheap price.
"""
from __future__ import annotations

import pytest

from services import pricing_catalog, pricing_resolver, pricing_service


@pytest.fixture(autouse=True)
def _clear_caches():
    pricing_catalog.clear_cache()
    yield
    pricing_catalog.clear_cache()


def test_normalize_tokens_splits_glued_version():
    assert pricing_resolver.normalize_tokens("P1v4") == {"p1", "v4"}
    assert pricing_resolver.normalize_tokens("P1 v4") == {"p1", "v4"}
    assert pricing_resolver.normalize_tokens("Standard_D2s_v3") == {"standard", "d2s", "v3"}
    assert pricing_resolver.normalize_tokens("D2sv3") == {"d2s", "v3"}


def test_search_key_is_order_independent():
    assert pricing_resolver.search_key("P1 v4") == pricing_resolver.search_key("v4 p1")


@pytest.mark.asyncio
async def test_p1v4_resolves_premium_not_shared():
    res = await pricing_catalog.resolve_meter("App Service", "P1v4", "eastus")
    matched = res["matched"]
    assert matched is not None
    assert matched["skuName"] == "P1 v4"
    assert matched["meterName"] == "P1 v4"
    assert res["confidence"] >= 0.9
    assert not res["low_confidence"]
    # The cheap trap meter must not be the winner.
    assert matched["skuName"] != "Shared App"


@pytest.mark.asyncio
async def test_apim_premium_picks_unit_not_self_hosted_gateway():
    res = await pricing_catalog.resolve_meter("API Management", "Premium", "eastus")
    matched = res["matched"]
    assert matched is not None
    assert matched["meterName"] == "Premium Unit"
    assert "Self Hosted Gateway" not in matched["productName"]


@pytest.mark.asyncio
async def test_redis_c1_resolves_via_meter_name():
    res = await pricing_catalog.resolve_meter("Azure Cache for Redis", "C1", "eastus")
    matched = res["matched"]
    assert matched is not None
    assert matched["meterName"] == "C1 Cache"
    assert not res["low_confidence"]


@pytest.mark.asyncio
async def test_vm_compact_form_resolves_and_skips_spot():
    res = await pricing_catalog.resolve_meter("Virtual Machines", "D2sv3", "eastus")
    matched = res["matched"]
    assert matched is not None
    assert matched["skuName"] == "D2s v3"
    assert "Spot" not in matched["skuName"]


@pytest.mark.asyncio
async def test_explicit_shared_request_is_allowed():
    res = await pricing_catalog.resolve_meter("App Service", "Shared", "eastus")
    matched = res["matched"]
    assert matched is not None
    assert matched["skuName"] == "Shared App"


@pytest.mark.asyncio
async def test_unknown_sku_is_low_confidence():
    res = await pricing_catalog.resolve_meter("App Service", "ZZ99 nonexistent", "eastus")
    assert res["low_confidence"] is True
    assert res["confidence"] < 0.45


@pytest.mark.asyncio
async def test_service_fuzzy_resolution():
    # "app service plan" should still resolve to the App Service catalog rows.
    res = await pricing_catalog.resolve_meter("app service plan", "P1v4", "eastus")
    assert res["resolved_service"] == "Azure App Service"


@pytest.mark.asyncio
async def test_estimate_line_item_p1v4_not_shared_app_price():
    item = await pricing_service.estimate_line_item("App Service", "P1v4", quantity=1, region="eastus")
    # The bug produced ~$9.49/mo (Shared App $0.013/hr). The premium meter is
    # 0.201/hr * 730h ≈ $146.73/mo.
    assert item["monthly_estimate"] is not None
    assert item["monthly_estimate"] > 100
    assert item["matched_sku"] == "P1 v4"
    assert item["confidence"] >= 0.9


@pytest.mark.asyncio
async def test_estimate_line_item_surfaces_swap_metadata():
    item = await pricing_service.estimate_line_item("App Service", "P1v4", region="eastus")
    assert item["requested_sku"] == "P1v4"
    assert "candidates" in item
    assert "confidence" in item
