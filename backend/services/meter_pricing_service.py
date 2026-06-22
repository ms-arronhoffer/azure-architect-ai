"""Meter-aware Azure pricing engine.

Where ``pricing_service.estimate_line_item`` multiplies a *single* retail price
by hours/qty/GB, this module prices **every billing dimension** a service emits,
driven by ``knowledge/pricing/service_catalog.yaml``:

  * SQL Database  -> vCore compute + data storage + backup storage
  * Storage       -> capacity (graduated tiers) + write ops + read ops
  * Functions     -> executions (first 1M free) + GB-seconds (first 400k free)
  * Cosmos DB     -> provisioned RU/s (hourly) + transactional storage

For each dimension it:
  1. Resolves the monthly quantity from the line item (hours, instance count,
     or a named ``dimensions`` value), applying ``instance_scaled`` and
     ``multiply_hours`` and subtracting ``included_free``.
  2. Queries the Retail API filtered by the dimension's ``meter_match`` hints
     (skuName / meterName / productName / unitOfMeasure), then drops excluded
     records client-side.
  3. Applies graduated ``tierMinimumUnits`` math when ``tiered: true``, else a
     flat unit-price multiply.

Returns a per-meter breakdown plus a line subtotal. Reuses ``pricing_service``'s
6h cache and never raises — unknown meters degrade to a ``priced: false`` row.
"""
from __future__ import annotations

import asyncio
from typing import Any

from middleware.logging import get_logger
from services import cost_catalog, pricing_service

log = get_logger("meter_pricing_service")

PRICING_DATA_SOURCE = pricing_service.PRICING_DATA_SOURCE


def _resolve_quantity(dim: dict[str, Any], item: dict[str, Any]) -> float:
    """Resolve the monthly quantity for one dimension from a line item."""
    field = dim.get("quantity_field", "")
    dims = item.get("dimensions") or {}
    instances = float(item.get("quantity", 1) or 1)
    if field == "__hours__":
        base = float(item.get("hours_per_month", dim.get("default_quantity", 730)) or 0)
    elif field == "__instances__":
        base = instances
    else:
        raw = dims.get(field, dim.get("default_quantity", 0))
        try:
            base = float(raw if raw is not None else 0)
        except (TypeError, ValueError):
            base = 0.0
    if dim.get("instance_scaled"):
        base *= instances
    return base


def _pick_records(records: list[dict], match: dict[str, Any]) -> list[dict]:
    """Drop records excluded by product/meter name, keep priced candidates."""
    excl_p = [e.lower() for e in match.get("product_excludes", []) or []]
    excl_m = [e.lower() for e in match.get("meter_excludes", []) or []]
    out: list[dict] = []
    for r in records:
        pn = (r.get("productName") or "").lower()
        mn = (r.get("meterName") or "").lower()
        if excl_p and any(e in pn for e in excl_p):
            continue
        if excl_m and any(e in mn for e in excl_m):
            continue
        out.append(r)
    return out


def _graduated_cost(records: list[dict], qty: float) -> float:
    """Apply cumulative tierMinimumUnits pricing across same-meter records."""
    tiers = sorted(records, key=lambda r: float(r.get("tierMinimumUnits", 0) or 0))
    cost = 0.0
    for i, tier in enumerate(tiers):
        start = float(tier.get("tierMinimumUnits", 0) or 0)
        nxt = (
            float(tiers[i + 1].get("tierMinimumUnits", 0) or 0)
            if i + 1 < len(tiers)
            else float("inf")
        )
        if qty <= start:
            break
        units = min(qty, nxt) - start
        cost += units * float(tier.get("retailPrice", 0) or 0)
    return cost


async def _price_dimension(
    svc: dict[str, Any], dim: dict[str, Any], item: dict[str, Any], region: str, currency: str
) -> dict[str, Any] | None:
    """Price a single billing dimension. Returns None when an optional meter has
    zero quantity (nothing to bill)."""
    qty = _resolve_quantity(dim, item)
    included = float(dim.get("included_free", 0) or 0)
    required = bool(dim.get("required", False))
    if qty <= 0 and not required:
        return None

    billable = max(0.0, qty - included)
    match = dim.get("meter_match", {}) or {}
    sku = item.get("sku", "") if match.get("sku_from_item") else match.get("sku_contains", "")

    row: dict[str, Any] = {
        "dimension": dim.get("key"),
        "label": dim.get("label"),
        "unit": dim.get("unit"),
        "quantity": round(qty, 4),
        "included_free": included,
        "billable_quantity": round(billable, 4),
        "unit_price": None,
        "unit_of_measure": None,
        "monthly_cost": None,
        "meter_id": None,
        "priced": False,
        "source": PRICING_DATA_SOURCE,
    }

    try:
        records = await pricing_service.get_price(
            service=svc.get("service", ""),
            sku_name=sku or "",
            region=region,
            currency=currency,
            meter_name=match.get("meter_contains", "") or "",
            product_name=match.get("product_contains", "") or "",
            unit_of_measure=match.get("unit_contains", "") or "",
        )
    except Exception as exc:  # never raise — degrade
        log.warning("meter_pricing.lookup_failed", dimension=dim.get("key"), error=str(exc))
        row["note"] = f"price lookup failed: {exc}"
        return row

    candidates = _pick_records(records, match)
    if not candidates:
        row["note"] = "no matching meter found"
        return row

    priced = [r for r in candidates if float(r.get("retailPrice", 0) or 0) > 0]
    pool = priced or candidates
    best = min(pool, key=lambda r: float(r.get("retailPrice", float("inf")) or float("inf")))

    if dim.get("tiered"):
        meter_name = best.get("meterName")
        same_meter = [r for r in pool if r.get("meterName") == meter_name] or [best]
        monthly = _graduated_cost(same_meter, billable)
        unit_price = float(best.get("retailPrice", 0) or 0)
    else:
        unit_price = float(best.get("retailPrice", 0) or 0)
        monthly = unit_price * billable
        if dim.get("multiply_hours"):
            monthly *= float(item.get("hours_per_month", 730) or 730)

    row.update(
        {
            "unit_price": unit_price,
            "unit_of_measure": best.get("unitOfMeasure"),
            "monthly_cost": round(monthly, 2),
            "meter_id": best.get("meterId"),
            "meter_name": best.get("meterName"),
            "currency": best.get("currencyCode", currency),
            "priced": True,
        }
    )
    return row


async def price_line_item(
    item: dict[str, Any], region_default: str = "eastus", currency: str = "USD"
) -> dict[str, Any]:
    """Price one catalog-resolved line item across all of its billing meters.

    Falls back to the legacy single-meter ``pricing_service.estimate_line_item``
    for services not present in the catalog, so callers always get a result."""
    service = item.get("service", "")
    region = item.get("region") or region_default
    svc = cost_catalog.resolve_service(service)

    if svc is None:
        legacy = await pricing_service.estimate_line_item(
            service=service,
            sku=item.get("sku", ""),
            quantity=float(item.get("quantity", 1) or 1),
            hours_per_month=float(item.get("hours_per_month", 730) or 730),
            region=region,
        )
        return {
            "service": service,
            "display_name": item.get("display_name") or service,
            "sku": item.get("sku", ""),
            "region": region,
            "catalog_matched": False,
            "meters": [
                {
                    "dimension": "legacy",
                    "label": "Estimate",
                    "unit": legacy.get("unit_of_measure"),
                    "unit_price": legacy.get("unit_price"),
                    "monthly_cost": legacy.get("monthly_estimate"),
                    "priced": legacy.get("monthly_estimate") is not None,
                    "source": PRICING_DATA_SOURCE,
                }
            ],
            "monthly_subtotal": legacy.get("monthly_estimate") or 0.0,
            "currency": legacy.get("currency", currency),
        }

    dims = svc.get("dimensions", []) or []
    priced_rows = await asyncio.gather(
        *[_price_dimension(svc, d, item, region, currency) for d in dims]
    )
    meters = [r for r in priced_rows if r is not None]
    subtotal = round(sum(m.get("monthly_cost") or 0 for m in meters), 2)

    return {
        "service": svc.get("service"),
        "display_name": item.get("display_name") or svc.get("label"),
        "category": svc.get("category"),
        "sku": item.get("sku", ""),
        "region": region,
        "catalog_matched": True,
        "ri_eligible": bool(svc.get("ri_eligible", False)),
        "tags": item.get("tags", []),
        "meters": meters,
        "monthly_subtotal": subtotal,
        "currency": currency,
    }


async def price_model(
    items: list[dict[str, Any]], region_default: str = "eastus", currency: str = "USD"
) -> dict[str, Any]:
    """Price a full cost model (list of line items). Returns the per-line
    breakdown, grand total, and a small validation summary."""
    if not items:
        return {
            "line_items": [],
            "total_monthly_estimate": 0.0,
            "currency": currency,
            "summary": {"total_lines": 0, "catalog_matched": 0, "unpriced_meters": 0},
            "data_source": PRICING_DATA_SOURCE,
        }

    lines = await asyncio.gather(
        *[price_line_item(it, region_default, currency) for it in items]
    )
    total = round(sum(line.get("monthly_subtotal") or 0 for line in lines), 2)
    matched = sum(1 for line in lines if line.get("catalog_matched"))
    unpriced = sum(
        1
        for line in lines
        for m in line.get("meters", [])
        if not m.get("priced")
    )
    return {
        "line_items": list(lines),
        "total_monthly_estimate": total,
        "currency": currency,
        "summary": {
            "total_lines": len(lines),
            "catalog_matched": matched,
            "unpriced_meters": unpriced,
        },
        "data_source": PRICING_DATA_SOURCE,
        "disclaimer": (
            "Meter-level estimate from Azure Retail (pay-as-you-go) pricing. "
            "Reserved Instances and Savings Plans can reduce eligible compute "
            "40-72%. Actual costs depend on real usage."
        ),
    }


__all__ = ["PRICING_DATA_SOURCE", "price_line_item", "price_model"]
