"""Tests for the meter-aware pricing engine (services/meter_pricing_service.py).

The Azure Retail API is monkeypatched with a deterministic fake so the tests
run hermetically. Each fake returns records keyed by the meter filter so we can
assert multi-meter aggregation, graduated tiers, included-free, and the legacy
fallback for services not in the catalog.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def fake_retail(monkeypatch):
    """Install a fake pricing_service.get_price keyed by meter_name."""
    from services import pricing_service

    records: dict[str, list[dict]] = {}

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
        # Match on meter_name first, then a wildcard "" entry (compute by sku).
        if meter_name and meter_name in records:
            return records[meter_name]
        return records.get("", [])

    monkeypatch.setattr(pricing_service, "get_price", fake_get_price)
    return records


@pytest.mark.asyncio
async def test_multi_meter_sql_aggregation(fake_retail):
    from services import meter_pricing_service as mp

    fake_retail[""] = [
        {"skuName": "GP_Gen5_4", "meterName": "vCore", "productName": "SQL DB General Purpose",
         "retailPrice": 0.25, "unitOfMeasure": "1 Hour", "meterId": "c", "currencyCode": "USD"}
    ]
    fake_retail["Data Stored"] = [
        {"skuName": "GP", "meterName": "Data Stored", "productName": "SQL DB",
         "retailPrice": 0.10, "unitOfMeasure": "1 GB/Month", "meterId": "s", "currencyCode": "USD"}
    ]
    fake_retail["Backup"] = [
        {"skuName": "GP", "meterName": "PITR Backup LRS", "productName": "SQL DB",
         "retailPrice": 0.05, "unitOfMeasure": "1 GB/Month", "meterId": "b", "currencyCode": "USD"}
    ]

    item = {
        "service": "SQL Database",
        "sku": "GP_Gen5_4",
        "region": "eastus",
        "quantity": 1,
        "hours_per_month": 730,
        "dimensions": {"storage_gb": 200, "backup_gb": 100},
    }
    line = await mp.price_line_item(item)

    assert line["catalog_matched"] is True
    by_dim = {m["dimension"]: m for m in line["meters"]}
    assert by_dim["compute"]["monthly_cost"] == pytest.approx(0.25 * 730)
    assert by_dim["storage_gb"]["monthly_cost"] == pytest.approx(0.10 * 200)
    assert by_dim["backup_gb"]["monthly_cost"] == pytest.approx(0.05 * 100)
    assert line["monthly_subtotal"] == pytest.approx(0.25 * 730 + 20.0 + 5.0)


@pytest.mark.asyncio
async def test_optional_meter_with_zero_quantity_is_skipped(fake_retail):
    from services import meter_pricing_service as mp

    fake_retail[""] = [
        {"skuName": "GP_Gen5_2", "meterName": "vCore", "productName": "SQL DB General Purpose",
         "retailPrice": 0.12, "unitOfMeasure": "1 Hour", "meterId": "c"}
    ]
    item = {"service": "SQL Database", "sku": "GP_Gen5_2", "quantity": 1, "hours_per_month": 730}
    line = await mp.price_line_item(item)

    dims = {m["dimension"] for m in line["meters"]}
    # storage_gb / backup_gb default to 0 and are optional → not priced
    assert dims == {"compute"}


@pytest.mark.asyncio
async def test_included_free_is_subtracted(fake_retail):
    from services import meter_pricing_service as mp

    fake_retail["Total Executions"] = [
        {"meterName": "Total Executions", "productName": "Functions",
         "retailPrice": 0.20, "unitOfMeasure": "1M", "meterId": "x"}
    ]
    # 3M executions, first 1M free → bill 2M * $0.20 = $0.40
    item = {"service": "Azure Functions", "sku": "", "dimensions": {"executions_millions": 3}}
    line = await mp.price_line_item(item)
    execs = next(m for m in line["meters"] if m["dimension"] == "executions_millions")
    assert execs["billable_quantity"] == pytest.approx(2.0)
    assert execs["monthly_cost"] == pytest.approx(0.40)


@pytest.mark.asyncio
async def test_graduated_tier_pricing(fake_retail):
    from services import meter_pricing_service as mp

    # Storage capacity tiers: first 51200 GB @ 0.0184, next @ 0.0177
    fake_retail["Data Stored"] = [
        {"skuName": "Hot LRS", "meterName": "Hot LRS Data Stored", "productName": "Storage",
         "retailPrice": 0.0184, "unitOfMeasure": "1 GB/Month", "tierMinimumUnits": 0, "meterId": "t0"},
        {"skuName": "Hot LRS", "meterName": "Hot LRS Data Stored", "productName": "Storage",
         "retailPrice": 0.0177, "unitOfMeasure": "1 GB/Month", "tierMinimumUnits": 51200, "meterId": "t1"},
    ]
    item = {"service": "Storage", "sku": "Hot LRS", "dimensions": {"capacity_gb": 102400}}
    line = await mp.price_line_item(item)
    cap = next(m for m in line["meters"] if m["dimension"] == "capacity")
    expected = 51200 * 0.0184 + (102400 - 51200) * 0.0177
    assert cap["monthly_cost"] == pytest.approx(round(expected, 2))


@pytest.mark.asyncio
async def test_multiply_hours_for_cosmos_ru(fake_retail):
    from services import meter_pricing_service as mp

    fake_retail["100 RU/s"] = [
        {"meterName": "100 RU/s", "productName": "Cosmos DB",
         "retailPrice": 0.008, "unitOfMeasure": "1 Hour", "meterId": "ru"}
    ]
    # 10 units of 100 RU/s, billed hourly over 730h
    item = {"service": "Azure Cosmos DB", "sku": "", "hours_per_month": 730,
            "dimensions": {"provisioned_ru_100s": 10}}
    line = await mp.price_line_item(item)
    ru = next(m for m in line["meters"] if m["dimension"] == "provisioned_ru")
    assert ru["monthly_cost"] == pytest.approx(round(0.008 * 10 * 730, 2))


@pytest.mark.asyncio
async def test_redis_prices_via_meter_from_item(fake_retail):
    """Redis publishes the cache size in meterName (e.g. "C1 Cache") while
    skuName is only the tier — `meter_from_item` must route the SKU to the
    meterName filter so the cache instance gets priced."""
    from services import meter_pricing_service as mp

    # The fake keys on meter_name: item sku "C1" must drive the lookup.
    fake_retail["C1"] = [
        {"skuName": "Standard", "meterName": "C1 Cache", "productName": "Azure Cache for Redis Standard",
         "retailPrice": 0.082, "unitOfMeasure": "1 Hour", "meterId": "redis-c1", "currencyCode": "USD"}
    ]
    item = {"service": "Azure Cache for Redis", "sku": "C1", "quantity": 1, "hours_per_month": 730}
    line = await mp.price_line_item(item)
    compute = next(m for m in line["meters"] if m["dimension"] == "compute")
    assert compute["priced"] is True
    assert compute["monthly_cost"] == pytest.approx(round(0.082 * 730, 2))
    assert line["monthly_subtotal"] == pytest.approx(round(0.082 * 730, 2))


@pytest.mark.asyncio
async def test_unknown_meter_degrades_not_raises(fake_retail):
    from services import meter_pricing_service as mp

    # No records at all → compute meter is required but unpriced
    item = {"service": "Virtual Machines", "sku": "Standard_D4s_v5", "hours_per_month": 730}
    line = await mp.price_line_item(item)
    compute = next(m for m in line["meters"] if m["dimension"] == "compute")
    assert compute["priced"] is False
    assert line["monthly_subtotal"] == 0.0


@pytest.mark.asyncio
async def test_legacy_fallback_for_uncatalogued_service(monkeypatch):
    from services import meter_pricing_service as mp
    from services import pricing_service

    async def fake_estimate_line_item(service, sku="", quantity=1, hours_per_month=730, region="eastus"):
        return {"service": service, "monthly_estimate": 99.0, "unit_price": 1.0,
                "unit_of_measure": "1 Hour", "currency": "USD"}

    monkeypatch.setattr(pricing_service, "estimate_line_item", fake_estimate_line_item)
    item = {"service": "Some Obscure Service", "sku": "X", "quantity": 1}
    line = await mp.price_line_item(item)
    assert line["catalog_matched"] is False
    assert line["monthly_subtotal"] == 99.0


@pytest.mark.asyncio
async def test_price_model_aggregates_total(fake_retail):
    from services import meter_pricing_service as mp

    fake_retail[""] = [
        {"skuName": "Standard_D4s_v5", "meterName": "D4s v5", "productName": "Virtual Machines Dv5",
         "retailPrice": 0.20, "unitOfMeasure": "1 Hour", "meterId": "vm"}
    ]
    items = [
        {"service": "Virtual Machines", "sku": "Standard_D4s_v5", "quantity": 2, "hours_per_month": 730},
    ]
    model = await mp.price_model(items)
    assert model["summary"]["total_lines"] == 1
    assert model["total_monthly_estimate"] == pytest.approx(round(0.20 * 730 * 2, 2))


@pytest.mark.asyncio
async def test_apim_premium_prices_unit_not_self_hosted_gateway(fake_retail):
    """APIM Premium must price the managed deployment unit, not the cheaper
    Self-Hosted Gateway meter that shares the same skuName/tier."""
    from services import meter_pricing_service as mp

    # Both records carry skuName "Premium" and an hourly unit; the gateway is
    # cheaper and would win the naive cheapest-meter pick without exclusion.
    fake_retail["Unit"] = [
        {"skuName": "Premium", "meterName": "Premium Unit", "productName": "API Management",
         "retailPrice": 2.9485, "unitOfMeasure": "1 Hour", "meterId": "apim-unit", "currencyCode": "USD"},
        {"skuName": "Premium", "meterName": "Premium Unit", "productName": "Self Hosted Gateway",
         "retailPrice": 0.137, "unitOfMeasure": "1 Hour", "meterId": "apim-shgw", "currencyCode": "USD"},
    ]

    item = {
        "service": "API Management",
        "sku": "Premium",
        "region": "westus2",
        "quantity": 2,
        "hours_per_month": 730,
    }
    line = await mp.price_line_item(item)

    assert line["catalog_matched"] is True
    unit = next(m for m in line["meters"] if m["dimension"] == "unit")
    assert unit["unit_price"] == pytest.approx(2.9485)
    assert unit["monthly_cost"] == pytest.approx(2.9485 * 730 * 2)
    assert line["monthly_subtotal"] == pytest.approx(2.9485 * 730 * 2)
