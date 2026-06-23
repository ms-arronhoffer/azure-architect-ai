"""Cached Azure pricing catalog + deterministic calculator.

The Cost Optimize panel is a structured pricing calculator: users pick a
service, region, SKU and buying option from dropdowns rather than typing free
text. To make that instant (and testable without network), pricing is driven by
a committed snapshot of Azure Retail prices at
``knowledge/pricing/sku_catalog.json`` rather than a live API round-trip.

The snapshot stores representative pay-as-you-go list prices for a baseline
region (East US) plus per-region multipliers, a family→buying-option discount
table, and Azure Hybrid Benefit license fractions. ``price_line_item`` and
``estimate`` apply region multiplier → buying-option discount → hybrid benefit →
currency conversion deterministically.

This is intentionally separate from ``pricing_service`` (the live Retail API
wrapper used by the 7-phase ``cost_pipeline``): the calculator favours speed and
determinism; the deep-analysis pipeline favours live accuracy.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from middleware.logging import get_logger

log = get_logger("cost_catalog")

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "pricing" / "sku_catalog.json"


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    """Load and cache the committed pricing snapshot."""
    with _CATALOG_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


# ── Lookup helpers ───────────────────────────────────────────────────────────

def _service_index() -> dict[str, dict[str, Any]]:
    return {svc["key"]: svc for svc in load_catalog().get("services", [])}


def _region_index() -> dict[str, dict[str, Any]]:
    return {r["slug"]: r for r in load_catalog().get("regions", [])}


def _currency_index() -> dict[str, dict[str, Any]]:
    return {c["code"]: c for c in load_catalog().get("currencies", [])}


def _option_index() -> dict[str, dict[str, Any]]:
    return {o["key"]: o for o in load_catalog().get("buying_options", [])}


def get_service(service_key: str) -> dict[str, Any] | None:
    return _service_index().get(service_key)


def get_sku(service_key: str, sku_name: str) -> dict[str, Any] | None:
    svc = get_service(service_key)
    if not svc:
        return None
    return next((s for s in svc.get("skus", []) if s["name"] == sku_name), None)


def list_services() -> list[dict[str, Any]]:
    """Service metadata for the dropdown (without the full SKU list)."""
    out: list[dict[str, Any]] = []
    for svc in load_catalog().get("services", []):
        out.append(
            {
                "key": svc["key"],
                "display": svc["display"],
                "family": svc["family"],
                "unit": svc["unit"],
                "quantity_label": svc.get("quantity_label"),
                "usage_label": svc.get("usage_label"),
                "default_hours": svc.get("default_hours", 730),
                "default_quantity": svc.get("default_quantity", 1),
                "eligible_options": svc.get("eligible_options", ["payg"]),
                "hybrid_benefit": svc.get("hybrid_benefit"),
                "sku_count": len(svc.get("skus", [])),
            }
        )
    return out


def list_regions() -> list[dict[str, Any]]:
    return list(load_catalog().get("regions", []))


def list_currencies() -> list[dict[str, Any]]:
    return list(load_catalog().get("currencies", []))


def list_buying_options() -> list[dict[str, Any]]:
    return list(load_catalog().get("buying_options", []))


def list_skus(service_key: str, region: str = "eastus") -> list[dict[str, Any]]:
    """SKU options for a service in a region, priced for that region.

    Returns ``unit_price`` already adjusted by the region multiplier so the
    dropdown can show region-correct list prices.
    """
    svc = get_service(service_key)
    if not svc:
        return []
    mult = _region_index().get(region, {}).get("price_multiplier", 1.0)
    out: list[dict[str, Any]] = []
    for s in svc.get("skus", []):
        item = dict(s)
        item["unit_price"] = round(s["unit_price"] * mult, 5)
        item["base_unit_price"] = s["unit_price"]
        out.append(item)
    return out


def catalog_meta() -> dict[str, Any]:
    cat = load_catalog()
    return {
        "generated_at": cat.get("generated_at"),
        "source": cat.get("source"),
        "currency": cat.get("currency", "USD"),
    }


# ── Pricing math ─────────────────────────────────────────────────────────────

_UNIT_LABEL = {
    "hour": "1 Hour",
    "month": "1 Month",
    "gb_month": "1 GB/Month",
    "per_1k": "1K units",
}


def _discount_fraction(family: str, buying_option: str) -> float:
    if buying_option == "payg":
        return 0.0
    table = load_catalog().get("discounts", {})
    fam = table.get(family) or table.get("default", {})
    return float(fam.get(buying_option, 0.0))


def _hybrid_benefit_fraction(svc: dict[str, Any], sku: dict[str, Any]) -> float:
    """License fraction Azure Hybrid Benefit removes for this service/SKU."""
    key = svc.get("hybrid_benefit")
    if not key:
        return 0.0
    # Windows VMs only qualify for the windows benefit when the SKU is Windows.
    if key == "vm_windows" and (sku.get("os") or "").lower() != "windows":
        return 0.0
    return float(load_catalog().get("hybrid_benefit", {}).get(key, 0.0))


def price_line_item(
    service_key: str,
    sku_name: str,
    region: str = "eastus",
    quantity: float = 1.0,
    hours_per_month: float = 730.0,
    buying_option: str = "payg",
    hybrid_benefit: bool = False,
    currency: str = "USD",
) -> dict[str, Any]:
    """Compute monthly cost for a single configured line item.

    Always returns a dict; on an unknown service/SKU it returns ``status:
    "unknown"`` with ``monthly_cost`` ``None`` rather than raising.
    """
    svc = get_service(service_key)
    if not svc:
        return {
            "service_key": service_key,
            "sku": sku_name,
            "region": region,
            "status": "unknown",
            "monthly_cost": None,
            "note": f"Unknown service '{service_key}'.",
        }
    sku = get_sku(service_key, sku_name)
    if not sku:
        return {
            "service_key": service_key,
            "service": svc["display"],
            "sku": sku_name,
            "region": region,
            "status": "unknown",
            "monthly_cost": None,
            "note": f"Unknown SKU '{sku_name}' for {svc['display']}.",
        }

    # Buying option falls back to PAYG when not eligible for this service.
    eligible = svc.get("eligible_options", ["payg"])
    applied_option = buying_option if buying_option in eligible else "payg"
    option_downgraded = applied_option != buying_option

    region_mult = _region_index().get(region, {}).get("price_multiplier", 1.0)
    cur = _currency_index().get(currency, {"rate": 1.0, "symbol": "$", "code": "USD"})
    rate = float(cur.get("rate", 1.0))

    unit = svc["unit"]
    base_unit_price = float(sku["unit_price"]) * region_mult
    qty = max(float(quantity), 0.0)
    hours = max(float(hours_per_month), 0.0)

    # Monthly quantity multiplier per billing unit.
    if unit == "hour":
        units = qty * hours
    else:  # month, gb_month, per_1k → quantity already expresses the monthly amount
        units = qty

    payg_monthly = base_unit_price * units

    discount = _discount_fraction(svc["family"], applied_option)
    after_option = payg_monthly * (1.0 - discount)

    ahb_fraction = _hybrid_benefit_fraction(svc, sku) if hybrid_benefit else 0.0
    after_ahb = after_option * (1.0 - ahb_fraction)

    monthly_usd = after_ahb
    monthly = monthly_usd * rate
    payg_converted = payg_monthly * rate
    savings = payg_converted - monthly

    return {
        "service_key": service_key,
        "service": svc["display"],
        "family": svc["family"],
        "sku": sku_name,
        "sku_display": sku.get("display", sku_name),
        "region": region,
        "unit": unit,
        "unit_of_measure": _UNIT_LABEL.get(unit, unit),
        "unit_price": round(base_unit_price * rate, 5),
        "quantity": qty,
        "hours_per_month": hours if unit == "hour" else None,
        "buying_option": applied_option,
        "option_downgraded": option_downgraded,
        "hybrid_benefit_applied": ahb_fraction > 0,
        "discount_fraction": round(discount + (1 - discount) * ahb_fraction, 4),
        "currency": cur.get("code", currency),
        "currency_symbol": cur.get("symbol", "$"),
        "payg_monthly": round(payg_converted, 2),
        "monthly_cost": round(monthly, 2),
        "annual_cost": round(monthly * 12, 2),
        "monthly_savings_vs_payg": round(savings, 2),
        "status": "ok",
    }


def estimate(items: list[dict[str, Any]], currency: str = "USD") -> dict[str, Any]:
    """Price a list of configured line items and aggregate totals."""
    cur = _currency_index().get(currency, {"rate": 1.0, "symbol": "$", "code": "USD"})
    lines: list[dict[str, Any]] = []
    for it in items:
        lines.append(
            price_line_item(
                service_key=it.get("service_key", ""),
                sku_name=it.get("sku", ""),
                region=it.get("region", "eastus"),
                quantity=float(it.get("quantity", 1) or 0),
                hours_per_month=float(it.get("hours_per_month", 730) or 0),
                buying_option=it.get("buying_option", "payg"),
                hybrid_benefit=bool(it.get("hybrid_benefit", False)),
                currency=currency,
            )
        )
    priced = [ln for ln in lines if ln.get("monthly_cost") is not None]
    total_monthly = round(sum(ln["monthly_cost"] for ln in priced), 2)
    total_payg = round(sum(ln["payg_monthly"] for ln in priced), 2)
    total_savings = round(total_payg - total_monthly, 2)
    return {
        "line_items": lines,
        "currency": cur.get("code", currency),
        "currency_symbol": cur.get("symbol", "$"),
        "total_monthly": total_monthly,
        "total_annual": round(total_monthly * 12, 2),
        "total_payg_monthly": total_payg,
        "total_monthly_savings": total_savings,
        "savings_pct": round((total_savings / total_payg * 100) if total_payg else 0.0, 1),
        "priced_count": len(priced),
        "unpriced_count": len(lines) - len(priced),
        "source": load_catalog().get("source"),
        "generated_at": load_catalog().get("generated_at"),
    }


__all__ = [
    "catalog_meta",
    "estimate",
    "get_service",
    "get_sku",
    "list_buying_options",
    "list_currencies",
    "list_regions",
    "list_services",
    "list_skus",
    "load_catalog",
    "price_line_item",
]
