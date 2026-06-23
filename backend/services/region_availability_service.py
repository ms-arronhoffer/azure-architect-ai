"""Region-availability lookup for a single Azure SKU / meter.

The Pricing Desk asks "where can I run this, and what does it cost in each
place?". This module fans a single service+SKU lookup across a curated set of
candidate Azure regions using the live Retail Pricing API and reports, per
region, the best matching unit price or ``available: False`` when no meter is
published there.

It reuses ``pricing_service.get_price`` (and therefore its 6h cache), so a
repeat sweep is cheap. It never raises — a failed region degrades to
``available: False`` so the caller always gets a complete grid.
"""
from __future__ import annotations

import asyncio
from typing import Any

from middleware.logging import get_logger
from services import pricing_service

log = get_logger("region_availability_service")

PRICING_DATA_SOURCE = pricing_service.PRICING_DATA_SOURCE

# Curated candidate regions — broad geographic spread without fanning the whole
# catalogue (each region is one Retail API call). Override via ``regions=``.
DEFAULT_REGIONS: tuple[str, ...] = (
    "eastus",
    "eastus2",
    "westus2",
    "westus3",
    "centralus",
    "southcentralus",
    "canadacentral",
    "brazilsouth",
    "northeurope",
    "westeurope",
    "uksouth",
    "francecentral",
    "germanywestcentral",
    "swedencentral",
    "uaenorth",
    "southafricanorth",
    "australiaeast",
    "southeastasia",
    "eastasia",
    "japaneast",
    "centralindia",
    "koreacentral",
)


def _best_record(records: list[dict], sku: str) -> dict | None:
    """Pick the most relevant priced record for the requested SKU."""
    if not records:
        return None
    priced = [r for r in records if float(r.get("retailPrice", 0) or 0) > 0]
    pool = priced or records
    if sku:
        exact = [r for r in pool if sku.lower() in (r.get("skuName") or "").lower()]
        if exact:
            pool = exact
    return min(pool, key=lambda r: float(r.get("retailPrice", float("inf")) or float("inf")))


async def _price_in_region(
    service: str, sku: str, region: str, currency: str
) -> dict[str, Any]:
    """Resolve the best unit price for one region. Never raises."""
    row: dict[str, Any] = {
        "region": region,
        "available": False,
        "unit_price": None,
        "unit_of_measure": None,
        "sku": sku,
        "currency": currency,
    }
    try:
        records = await pricing_service.get_price(
            service=service, sku_name=sku, region=region, currency=currency
        )
    except Exception as exc:  # never raise — degrade to unavailable
        log.warning("region_availability.lookup_failed", region=region, error=str(exc))
        row["note"] = f"lookup failed: {exc}"
        return row

    best = _best_record(records, sku)
    if best is None:
        return row

    row.update(
        {
            "available": True,
            "unit_price": float(best.get("retailPrice", 0) or 0),
            "unit_of_measure": best.get("unitOfMeasure"),
            "sku": best.get("skuName", sku),
            "currency": best.get("currencyCode", currency),
        }
    )
    return row


async def availability(
    service: str,
    sku: str = "",
    regions: list[str] | tuple[str, ...] | None = None,
    currency: str = "USD",
) -> dict[str, Any]:
    """Return per-region availability + unit price for one service/SKU.

    The response is sorted cheapest-available first (unavailable regions last),
    and flags the cheapest region so the UI can offer a one-click re-price.
    """
    candidate = tuple(regions) if regions else DEFAULT_REGIONS
    # De-dupe while preserving order.
    seen: set[str] = set()
    ordered = [r for r in candidate if r and not (r in seen or seen.add(r))]

    rows = await asyncio.gather(
        *[_price_in_region(service, sku, r, currency) for r in ordered]
    )

    def _sort_key(r: dict[str, Any]) -> tuple[int, float]:
        if not r.get("available"):
            return (1, float("inf"))
        return (0, float(r.get("unit_price") or float("inf")))

    rows_sorted = sorted(rows, key=_sort_key)
    available_rows = [r for r in rows_sorted if r.get("available")]
    cheapest = available_rows[0]["region"] if available_rows else None
    for r in rows_sorted:
        r["cheapest"] = r.get("available") and r["region"] == cheapest

    return {
        "service": service,
        "requested_sku": sku,
        "currency": currency,
        "regions": rows_sorted,
        "available_count": len(available_rows),
        "total_regions": len(rows_sorted),
        "cheapest_region": cheapest,
        "source": PRICING_DATA_SOURCE,
    }


__all__ = ["DEFAULT_REGIONS", "PRICING_DATA_SOURCE", "availability"]
