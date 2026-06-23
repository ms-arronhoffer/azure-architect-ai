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
from datetime import UTC, datetime
from typing import Any

from middleware.logging import get_logger
from services import cost_catalog, pricing_service

log = get_logger("meter_pricing_service")

PRICING_DATA_SOURCE = pricing_service.PRICING_DATA_SOURCE


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _confidence_label(score: float) -> str:
    if score >= 0.8:
        return "high"
    if score >= 0.5:
        return "medium"
    if score > 0.0:
        return "low"
    return "none"


def _meter_confidence(item: dict[str, Any], best: dict[str, Any], *, required: bool) -> float:
    """Score how cleanly a requested SKU matched the chosen retail record.

    High when the requested SKU substring is present in the matched skuName;
    medium when a record was found but the SKU was unspecified or fuzzy; the
    caller sets 0 for unpriced meters.
    """
    requested = (item.get("sku") or "").strip().lower()
    matched_sku = (best.get("skuName") or "").lower()
    if requested and matched_sku:
        if requested in matched_sku or matched_sku in requested:
            return 0.9
        # token overlap
        if {w for w in requested.replace("_", " ").split() if len(w) > 1} & set(matched_sku.split()):
            return 0.7
        return 0.5
    if requested and not matched_sku:
        return 0.4
    # No requested SKU: a found price is reasonable but unverified.
    return 0.65 if required else 0.6


def _citation(best: dict[str, Any], region: str, currency: str) -> dict[str, Any]:
    return {
        "meter_id": best.get("meterId"),
        "meter_name": best.get("meterName"),
        "sku_name": best.get("skuName"),
        "product_name": best.get("productName"),
        "region": region,
        "unit_price": best.get("retailPrice"),
        "unit_of_measure": best.get("unitOfMeasure"),
        "currency": best.get("currencyCode", currency),
        "retrieved_at": _now_iso(),
        "source": PRICING_DATA_SOURCE,
    }


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
        "confidence": 0.0,
        "confidence_label": "none",
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
            "confidence": round(_meter_confidence(item, best, required=required), 2),
            "confidence_label": _confidence_label(
                _meter_confidence(item, best, required=required)
            ),
            "citation": _citation(best, region, currency),
        }
    )
    return row


def _line_confidence(meters: list[dict[str, Any]]) -> float:
    """Cost-weighted average meter confidence for a line (priced meters only)."""
    priced = [m for m in meters if m.get("priced") and (m.get("monthly_cost") or 0) > 0]
    if not priced:
        # Priced-but-zero (e.g. fully within free grant) → trust the lookup.
        any_priced = [m for m in meters if m.get("priced")]
        if any_priced:
            return round(sum(m.get("confidence", 0) for m in any_priced) / len(any_priced), 2)
        return 0.0
    total = sum(m.get("monthly_cost") or 0 for m in priced)
    if total <= 0:
        return round(sum(m.get("confidence", 0) for m in priced) / len(priced), 2)
    weighted = sum((m.get("confidence", 0) * (m.get("monthly_cost") or 0)) for m in priced)
    return round(weighted / total, 2)


def _normalize_meter_monthly(price: float, unit: str, qty: float, hours: float) -> float:
    """Normalise a single retail record to a monthly cost for discovery."""
    u = (unit or "").lower()
    if "hour" in u:
        return price * hours * qty
    if "month" in u:
        return price * qty
    return price * qty


async def _discover_line(
    item: dict[str, Any], region: str, currency: str
) -> dict[str, Any] | None:
    """Dynamic meter discovery for a service absent from the meter catalog.

    Queries the Retail API, groups records by ``meterName``, and prices the
    primary (cheapest consumption) meter with a proper citation + confidence,
    rather than collapsing to an unlabelled single estimate. Returns ``None``
    when the API yields nothing so the caller can fall back to legacy pricing.
    """
    service = item.get("service", "")
    sku = item.get("sku", "")
    quantity = float(item.get("quantity", 1) or 1)
    hours = float(item.get("hours_per_month", 730) or 730)

    try:
        records = await pricing_service.get_price(service, sku, region, currency)
    except Exception as exc:
        log.warning("meter_pricing.discovery_failed", service=service, error=str(exc))
        return None
    priced = [r for r in records if float(r.get("retailPrice", 0) or 0) > 0]
    if not priced:
        return None

    # Prefer an hourly/monthly "instance" meter as the primary cost driver.
    def _rank(r: dict[str, Any]) -> tuple[int, float]:
        unit = (r.get("unitOfMeasure") or "").lower()
        kind = 0 if ("hour" in unit or "month" in unit) else 1
        return (kind, float(r.get("retailPrice", 0) or 0))

    best = min(priced, key=_rank)
    unit = best.get("unitOfMeasure", "")
    monthly = _normalize_meter_monthly(
        float(best.get("retailPrice", 0) or 0), unit, quantity, hours
    )
    conf = _meter_confidence(item, best, required=True)
    distinct_meters = {r.get("meterName") for r in priced if r.get("meterName")}
    row = {
        "dimension": "discovered",
        "label": best.get("meterName") or "Primary meter",
        "unit": unit,
        "quantity": quantity,
        "billable_quantity": quantity,
        "unit_price": float(best.get("retailPrice", 0) or 0),
        "unit_of_measure": unit,
        "monthly_cost": round(monthly, 2),
        "meter_id": best.get("meterId"),
        "meter_name": best.get("meterName"),
        "currency": best.get("currencyCode", currency),
        "priced": True,
        "confidence": round(conf, 2),
        "confidence_label": _confidence_label(conf),
        "citation": _citation(best, region, currency),
        "source": PRICING_DATA_SOURCE,
    }
    note = None
    if len(distinct_meters) > 1:
        note = (
            f"{len(distinct_meters)} billing meters discovered; priced the primary "
            "meter. Secondary meters (storage, transactions, egress) need explicit "
            "quantities to price."
        )
    line = {
        "service": service,
        "display_name": item.get("display_name") or service,
        "sku": sku,
        "region": region,
        "catalog_matched": False,
        "discovered": True,
        "meters": [row],
        "monthly_subtotal": round(monthly, 2),
        "currency": best.get("currencyCode", currency),
        "confidence": round(conf, 2),
        "confidence_label": _confidence_label(conf),
    }
    if note:
        line["note"] = note
    return line


async def price_line_item(
    item: dict[str, Any],
    region_default: str = "eastus",
    currency: str = "USD",
    *,
    dynamic_discovery: bool = False,
) -> dict[str, Any]:
    """Price one catalog-resolved line item across all of its billing meters.

    For services not in the meter catalog: when ``dynamic_discovery`` is set,
    first try to discover and price the primary meter from the live Retail API;
    otherwise (and on discovery miss) fall back to the legacy single-meter
    ``pricing_service.estimate_line_item`` so callers always get a result."""
    service = item.get("service", "")
    region = item.get("region") or region_default
    svc = cost_catalog.resolve_service(service)

    if svc is None:
        if dynamic_discovery:
            discovered = await _discover_line(item, region, currency)
            if discovered is not None:
                return discovered
        legacy = await pricing_service.estimate_line_item(
            service=service,
            sku=item.get("sku", ""),
            quantity=float(item.get("quantity", 1) or 1),
            hours_per_month=float(item.get("hours_per_month", 730) or 730),
            region=region,
        )
        priced = legacy.get("monthly_estimate") is not None
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
                    "priced": priced,
                    "confidence": 0.4 if priced else 0.0,
                    "confidence_label": "low" if priced else "none",
                    "source": PRICING_DATA_SOURCE,
                }
            ],
            "monthly_subtotal": legacy.get("monthly_estimate") or 0.0,
            "currency": legacy.get("currency", currency),
            "confidence": 0.4 if priced else 0.0,
            "confidence_label": "low" if priced else "none",
        }

    dims = svc.get("dimensions", []) or []
    priced_rows = await asyncio.gather(
        *[_price_dimension(svc, d, item, region, currency) for d in dims]
    )
    meters = [r for r in priced_rows if r is not None]
    subtotal = round(sum(m.get("monthly_cost") or 0 for m in meters), 2)
    line_conf = _line_confidence(meters)

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
        "confidence": line_conf,
        "confidence_label": _confidence_label(line_conf),
    }


async def price_model(
    items: list[dict[str, Any]],
    region_default: str = "eastus",
    currency: str = "USD",
    *,
    dynamic_discovery: bool = False,
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
        *[
            price_line_item(it, region_default, currency, dynamic_discovery=dynamic_discovery)
            for it in items
        ]
    )
    total = round(sum(line.get("monthly_subtotal") or 0 for line in lines), 2)
    matched = sum(1 for line in lines if line.get("catalog_matched"))
    discovered = sum(1 for line in lines if line.get("discovered"))
    unpriced = sum(
        1
        for line in lines
        for m in line.get("meters", [])
        if not m.get("priced")
    )
    low_conf = sum(1 for line in lines if (line.get("confidence") or 0) < 0.5)
    return {
        "line_items": list(lines),
        "total_monthly_estimate": total,
        "currency": currency,
        "summary": {
            "total_lines": len(lines),
            "catalog_matched": matched,
            "discovered": discovered,
            "unpriced_meters": unpriced,
            "low_confidence_lines": low_conf,
        },
        "data_source": PRICING_DATA_SOURCE,
        "disclaimer": (
            "Meter-level estimate from Azure Retail (pay-as-you-go) pricing. "
            "Reserved Instances and Savings Plans can reduce eligible compute "
            "40-72%. Actual costs depend on real usage."
        ),
    }


__all__ = ["PRICING_DATA_SOURCE", "price_line_item", "price_model"]
