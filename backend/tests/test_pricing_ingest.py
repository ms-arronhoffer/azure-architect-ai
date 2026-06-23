"""Tests for the Azure Retail pricing bulk ingest (`services.pricing_ingest`).

All hermetic: HTTP is monkeypatched (no live prices.azure.com calls) and the
DB is an in-memory SQLite bound via a StaticPool so `session_scope()` sees the
ingested rows.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from services import pricing_ingest


@pytest_asyncio.fixture
async def memory_db(monkeypatch):
    """Point `db._Session` at a shared in-memory SQLite and create tables."""
    import db as db_module

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    async with engine.begin() as conn:
        await conn.run_sync(db_module.Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db_module, "_Session", session_factory)
    yield engine
    await engine.dispose()


def _item(meter_id: str, sku: str, price: float, region: str = "eastus") -> dict:
    return {
        "meterId": meter_id,
        "serviceName": "Azure App Service",
        "serviceFamily": "Compute",
        "productName": "Azure App Service Premium v4 Plan",
        "skuName": sku,
        "meterName": sku,
        "armSkuName": "",
        "armRegionName": region,
        "unitOfMeasure": "1 Hour",
        "retailPrice": price,
        "currencyCode": "USD",
        "priceType": "Consumption",
        "effectiveStartDate": "2025-01-01T00:00:00Z",
    }


def test_build_filter_with_regions():
    f = pricing_ingest._build_filter(["eastus", "westus2"], "USD")
    assert "priceType eq 'Consumption'" in f
    assert "armRegionName eq 'eastus'" in f
    assert "armRegionName eq 'westus2'" in f
    assert " or " in f


def test_build_filter_all_regions():
    f = pricing_ingest._build_filter(["*"], "USD")
    assert f == "priceType eq 'Consumption'"
    assert "armRegionName" not in f


def test_normalize_computes_search_key_and_id():
    norm = pricing_ingest.normalize(_item("m1", "P1 v4", 0.201))
    assert norm is not None
    assert norm["id"] == "m1|eastus|USD"
    assert norm["retail_price"] == 0.201
    # search_key collapses the version variants
    assert "p1" in norm["search_key"] and "v4" in norm["search_key"]


def test_normalize_skips_rows_without_service_or_region():
    assert pricing_ingest.normalize({"armRegionName": "eastus"}) is None
    assert pricing_ingest.normalize({"serviceName": "X"}) is None


@pytest.mark.asyncio
async def test_fetch_prices_follows_nextpagelink(monkeypatch):
    pages = {
        pricing_ingest.PRICING_API: {
            "Items": [_item("m1", "P1 v4", 0.201)],
            "NextPageLink": "https://prices.azure.com/next?page=2",
        },
        "https://prices.azure.com/next?page=2": {
            "Items": [_item("m2", "P2 v4", 0.402)],
            "NextPageLink": None,
        },
    }
    calls: list[str] = []

    async def fake_get_json(client, url, params):
        calls.append(url)
        return pages[url]

    monkeypatch.setattr(pricing_ingest, "_http_get_json", fake_get_json)
    items = await pricing_ingest.fetch_prices(regions=["eastus"], currency="USD")
    assert len(items) == 2
    assert calls == [pricing_ingest.PRICING_API, "https://prices.azure.com/next?page=2"]


@pytest.mark.asyncio
async def test_upsert_idempotency(memory_db):
    entries = [pricing_ingest.normalize(_item("m1", "P1 v4", 0.201))]

    first = await pricing_ingest.upsert_meters(entries)
    assert first == {"inserted": 1, "updated": 0, "unchanged": 0}

    # Re-running the same data is a no-op (unchanged), not a duplicate insert.
    second = await pricing_ingest.upsert_meters(entries)
    assert second == {"inserted": 0, "updated": 0, "unchanged": 1}

    # A price change is detected as an update.
    changed = [pricing_ingest.normalize(_item("m1", "P1 v4", 0.250))]
    third = await pricing_ingest.upsert_meters(changed)
    assert third == {"inserted": 0, "updated": 1, "unchanged": 0}


@pytest.mark.asyncio
async def test_run_ingest_end_to_end(monkeypatch, memory_db):
    async def fake_fetch(*args, **kwargs):
        return [_item("m1", "P1 v4", 0.201), _item("m2", "P2 v4", 0.402)]

    monkeypatch.setattr(pricing_ingest, "fetch_prices", fake_fetch)
    summary = await pricing_ingest.run_ingest()
    assert summary["ok"] is True
    assert summary["fetched"] == 2
    assert summary["inserted"] == 2

    # The ingested rows are queryable via the resolver/catalog.
    from db import PricingMeter, select, session_scope

    async with session_scope() as s:
        rows = (await s.execute(select(PricingMeter))).scalars().all()
    assert {r.sku_name for r in rows} == {"P1 v4", "P2 v4"}
