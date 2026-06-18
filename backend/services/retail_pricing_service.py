"""Live retail price lookup with MCP fallback.

Thin layer over ``pricing_service`` so callers get one entry point for
"price this thing right now" without re-implementing the SKU normalisation
and MCP fallback dance. Kept separate because the reservations / right-
sizing engines compose it differently than the architecture cost emitter.

Cache lives inside ``pricing_service`` (6h TTL); we don't re-cache here.
"""
from __future__ import annotations

from typing import Any

from middleware.logging import get_logger
from services import pricing_service

log = get_logger("retail_pricing_service")


async def lookup(
    service: str,
    sku: str = "",
    region: str = "eastus",
    quantity: float = 1,
    hours_per_month: float = 730.0,
    currency: str = "USD",
) -> dict[str, Any]:
    """Resolve one live retail price line. Always returns a dict with
    ``monthly_estimate`` (None when unknown) plus the raw matched SKU
    and source metadata for citation."""
    result = await pricing_service.estimate_line_item(
        service=service,
        sku=sku,
        quantity=quantity,
        hours_per_month=hours_per_month,
        region=region,
    )
    if currency and result.get("currency") and result["currency"] != currency:
        result["note"] = f"Returned in {result['currency']}; requested {currency} not available."
    return result


async def lookup_many(items: list[dict]) -> dict[str, Any]:
    """Batch retail lookup. ``items`` is the same shape ``estimate_architecture``
    accepts. Returns the aggregate envelope (line_items, total, currency)."""
    return await pricing_service.estimate_architecture(items)


__all__ = ["lookup", "lookup_many"]
