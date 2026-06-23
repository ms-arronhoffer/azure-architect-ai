"""Tests for the cached pricing catalog calculator (`services.cost_catalog`)
and its `/api/cost/catalog`, `/api/cost/skus`, `/api/cost/estimate` routes.

The calculator is fully deterministic (committed snapshot, no network), so
these assert exact pricing math: region multiplier → buying-option discount →
hybrid benefit → currency conversion.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import Request

from services import cost_catalog


# ── Service-level math ───────────────────────────────────────────────────────


def test_catalog_loads_and_has_core_shape():
    cat = cost_catalog.load_catalog()
    assert cat["services"] and cat["regions"] and cat["buying_options"]
    # Every buying option referenced by the discount table is a real option.
    option_keys = {o["key"] for o in cat["buying_options"]}
    assert "payg" in option_keys
    for fam, table in cat["discounts"].items():
        for opt in table:
            assert opt in option_keys, f"discount references unknown option {opt}"


def test_payg_vm_price_uses_hours_and_quantity():
    line = cost_catalog.price_line_item(
        service_key="virtual_machines",
        sku_name="Standard_D4s_v5",
        region="eastus",
        quantity=2,
        hours_per_month=730,
        buying_option="payg",
    )
    # 0.192 * 730 * 2 = 280.32
    assert line["monthly_cost"] == pytest.approx(280.32, abs=0.01)
    assert line["monthly_savings_vs_payg"] == 0.0
    assert line["status"] == "ok"


def test_region_multiplier_increases_price():
    base = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "eastus", 1, 730)
    pricier = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "australiaeast", 1, 730)
    assert pricier["monthly_cost"] > base["monthly_cost"]


def test_reserved_3yr_discount_applied():
    payg = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "eastus", 1, 730, buying_option="payg")
    ri = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "eastus", 1, 730, buying_option="reserved_3yr")
    # 62% discount for vm/reserved_3yr in the snapshot.
    assert ri["monthly_cost"] == pytest.approx(payg["monthly_cost"] * (1 - 0.62), abs=0.01)
    assert ri["monthly_savings_vs_payg"] > 0


def test_hybrid_benefit_only_applies_to_windows_sku():
    linux = cost_catalog.price_line_item(
        "virtual_machines", "Standard_D8s_v5", "eastus", 1, 730, hybrid_benefit=True
    )
    assert linux["hybrid_benefit_applied"] is False  # Linux SKU → no AHB
    windows = cost_catalog.price_line_item(
        "virtual_machines", "Standard_D8s_v5_Windows", "eastus", 1, 730, hybrid_benefit=True
    )
    assert windows["hybrid_benefit_applied"] is True
    no_ahb = cost_catalog.price_line_item(
        "virtual_machines", "Standard_D8s_v5_Windows", "eastus", 1, 730, hybrid_benefit=False
    )
    assert windows["monthly_cost"] < no_ahb["monthly_cost"]


def test_ineligible_option_downgrades_to_payg():
    # Blob storage is not eligible for spot.
    line = cost_catalog.price_line_item("blob_storage", "Hot_LRS", "eastus", 1000, 0, buying_option="spot")
    assert line["buying_option"] == "payg"
    assert line["option_downgraded"] is True


def test_gb_month_unit_ignores_hours():
    line = cost_catalog.price_line_item("blob_storage", "Hot_LRS", "eastus", quantity=1000, hours_per_month=730)
    # 0.0184 * 1000 = 18.40 regardless of hours
    assert line["monthly_cost"] == pytest.approx(18.40, abs=0.01)
    assert line["hours_per_month"] is None


def test_currency_conversion():
    usd = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "eastus", 1, 730, currency="USD")
    eur = cost_catalog.price_line_item("virtual_machines", "Standard_D4s_v5", "eastus", 1, 730, currency="EUR")
    assert eur["currency"] == "EUR"
    assert eur["monthly_cost"] == pytest.approx(usd["monthly_cost"] * 0.92, abs=0.05)


def test_unknown_service_and_sku_are_soft_failures():
    assert cost_catalog.price_line_item("nope", "x")["status"] == "unknown"
    assert cost_catalog.price_line_item("virtual_machines", "nope")["status"] == "unknown"


def test_estimate_aggregates_totals_and_savings():
    out = cost_catalog.estimate(
        [
            {"service_key": "virtual_machines", "sku": "Standard_D4s_v5", "region": "eastus",
             "quantity": 1, "hours_per_month": 730, "buying_option": "reserved_1yr"},
            {"service_key": "blob_storage", "sku": "Hot_LRS", "region": "eastus", "quantity": 1000},
            {"service_key": "bad", "sku": "bad"},
        ],
        currency="USD",
    )
    assert out["priced_count"] == 2
    assert out["unpriced_count"] == 1
    assert out["total_monthly"] == pytest.approx(
        out["line_items"][0]["monthly_cost"] + out["line_items"][1]["monthly_cost"], abs=0.01
    )
    assert out["total_annual"] == pytest.approx(out["total_monthly"] * 12, abs=0.01)
    assert out["total_monthly_savings"] >= 0


def test_list_skus_applies_region_multiplier():
    eastus = {s["name"]: s for s in cost_catalog.list_skus("virtual_machines", "eastus")}
    syd = {s["name"]: s for s in cost_catalog.list_skus("virtual_machines", "australiaeast")}
    assert syd["Standard_D4s_v5"]["unit_price"] > eastus["Standard_D4s_v5"]["unit_price"]


# ── Route layer ──────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def auth_client():
    import httpx

    from auth.entra import get_current_user
    from main import app

    async def fake_get_current_user(request: Request):
        uid = request.headers.get("X-Test-User") or uuid.uuid4().hex[:8]
        return {"oid": uid, "sub": uid}

    app.dependency_overrides[get_current_user] = fake_get_current_user
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_catalog_endpoint(auth_client):
    resp = await auth_client.get("/api/cost/catalog", headers={"X-Test-User": "u1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["services"] and body["regions"] and body["buying_options"]
    assert "meta" in body


@pytest.mark.asyncio
async def test_skus_endpoint(auth_client):
    resp = await auth_client.get(
        "/api/cost/skus", params={"service": "virtual_machines", "region": "westeurope"},
        headers={"X-Test-User": "u1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["skus"]
    assert body["unit"] == "hour"

    missing = await auth_client.get(
        "/api/cost/skus", params={"service": "nope"}, headers={"X-Test-User": "u1"}
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_estimate_endpoint(auth_client):
    resp = await auth_client.post(
        "/api/cost/estimate",
        json={
            "currency": "USD",
            "items": [
                {"service_key": "virtual_machines", "sku": "Standard_D4s_v5",
                 "region": "eastus", "quantity": 2, "hours_per_month": 730,
                 "buying_option": "reserved_1yr"},
            ],
        },
        headers={"X-Test-User": "u1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["priced_count"] == 1
    assert body["total_monthly"] > 0
    assert body["total_monthly_savings"] > 0
