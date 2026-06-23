"""Catalog access layer for Azure Retail pricing.

Bridges the pure :mod:`pricing_resolver` matcher to the actual catalog data:

1. the locally-scraped ``PricingMeter`` table (preferred, kept fresh by the
   ``pricing_ingest_daily`` scheduler job);
2. a committed JSON snapshot (``knowledge/pricing/sku_catalog.json``) loaded as
   a fallback when the table is empty — so a fresh checkout / CI / offline run
   still resolves prices deterministically without a scrape.

Every pricing consumer (chat agent, cost pipeline, future drawing tool) routes
through :func:`resolve_meter` instead of loose live ``contains`` queries.
"""
from __future__ import annotations

import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from config import settings
from middleware.logging import get_logger
from services import pricing_resolver

log = get_logger("pricing_catalog")

_SNAPSHOT_PATH = (
    Path(__file__).resolve().parent.parent / "knowledge" / "pricing" / "sku_catalog.json"
)

# Canonical Retail-row field set the resolver consumes.
_CANONICAL_FIELDS = (
    "meterId",
    "serviceName",
    "serviceFamily",
    "productName",
    "skuName",
    "meterName",
    "armSkuName",
    "armRegionName",
    "unitOfMeasure",
    "retailPrice",
    "currencyCode",
    "priceType",
    "effectiveStartDate",
)

# Short-lived cache of resolver results keyed on the request tuple.
_resolve_cache: dict[tuple, tuple[dict, float]] = {}
_RESOLVE_CACHE_TTL = 6 * 3600  # 6 hours — mirrors the old pricing_service cache.


@lru_cache(maxsize=1)
def _load_snapshot() -> list[dict[str, Any]]:
    """Load and cache the committed JSON snapshot of catalog rows."""
    try:
        with _SNAPSHOT_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
        meters = data.get("meters") if isinstance(data, dict) else data
        return [m for m in (meters or []) if isinstance(m, dict)]
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("pricing_catalog.snapshot_load_failed", error=str(exc))
        return []


def _service_name_map() -> dict[str, str]:
    # Imported lazily to avoid a circular import (pricing_service imports us).
    from services.pricing_service import SERVICE_NAME_MAP

    return SERVICE_NAME_MAP


def _db_to_canonical(row: Any) -> dict[str, Any]:
    return {
        "meterId": row.meter_id,
        "serviceName": row.service_name,
        "serviceFamily": row.service_family,
        "productName": row.product_name,
        "skuName": row.sku_name,
        "meterName": row.meter_name,
        "armSkuName": row.arm_sku_name,
        "armRegionName": row.arm_region_name,
        "unitOfMeasure": row.unit_of_measure,
        "retailPrice": row.retail_price,
        "currencyCode": row.currency_code,
        "priceType": row.price_type,
        "effectiveStartDate": row.effective_start_date,
    }


async def _db_rows(
    service_name: str, region: str, currency: str
) -> list[dict[str, Any]] | None:
    """Return DB rows for service+region, or ``None`` when the table is empty
    / unavailable (signals the caller to fall back to the snapshot)."""
    try:
        from db import PricingMeter, select, session_scope

        async with session_scope() as session:
            has_any = (
                await session.execute(select(PricingMeter.id).limit(1))
            ).first()
            if not has_any:
                return None
            stmt = select(PricingMeter).where(
                PricingMeter.service_name == service_name,
                PricingMeter.arm_region_name == region,
                PricingMeter.currency_code == currency,
            )
            rows = (await session.execute(stmt)).scalars().all()
        return [_db_to_canonical(r) for r in rows]
    except Exception as exc:
        log.warning("pricing_catalog.db_query_failed", error=str(exc))
        return None


async def _distinct_services(rows_source: list[dict[str, Any]]) -> list[str]:
    return sorted({r.get("serviceName") for r in rows_source if r.get("serviceName")})


async def _candidate_rows(
    service: str, region: str, currency: str
) -> tuple[list[dict[str, Any]], str, float, str]:
    """Resolve the canonical service and gather candidate rows for it.

    Returns ``(rows, resolved_service, service_confidence, source)``.
    """
    service_map = _service_name_map()

    db_rows = await _db_rows(service, region, currency)
    if db_rows is not None:
        # Table is populated — resolve the service against DB-known names.
        from db import PricingMeter, select, session_scope

        async with session_scope() as session:
            names = (
                await session.execute(select(PricingMeter.service_name).distinct())
            ).scalars().all()
        known = sorted({n for n in names if n})
        resolved, conf = pricing_resolver.resolve_service_name(service, known, service_map)
        if resolved != service:
            db_rows = await _db_rows(resolved, region, currency) or []
        return db_rows, resolved, conf, "catalog_db"

    # Fall back to committed snapshot.
    snapshot = _load_snapshot()
    known = await _distinct_services(snapshot)
    resolved, conf = pricing_resolver.resolve_service_name(service, known, service_map)
    rows = [
        r
        for r in snapshot
        if r.get("serviceName") == resolved
        and (r.get("armRegionName") == region or not r.get("armRegionName"))
        and (r.get("currencyCode", currency) == currency)
    ]
    return rows, resolved, conf, "catalog_snapshot"


async def resolve_meter(
    service: str,
    sku: str = "",
    region: str = "eastus",
    currency: str = "USD",
    meter_hint: str = "",
) -> dict[str, Any]:
    """Resolve the most-likely meter for a (service, sku, region) hint.

    Returns ``{matched, confidence, candidates, source, resolved_service,
    service_confidence, low_confidence, unmatched_reason}``. ``matched`` is the
    canonical Retail row dict (or ``None`` on a catalog miss).
    """
    region = region or "eastus"
    currency = currency or "USD"
    floor = settings.pricing_resolver_confidence_floor
    cache_key = (service.lower(), sku.lower(), region, currency, meter_hint.lower())
    cached = _resolve_cache.get(cache_key)
    if cached and (time.monotonic() - cached[1]) < _RESOLVE_CACHE_TTL:
        return cached[0]

    rows, resolved_service, svc_conf, source = await _candidate_rows(
        service, region, currency
    )
    result = pricing_resolver.resolve(sku, rows, meter_hint=meter_hint, confidence_floor=floor)
    result["source"] = source
    result["resolved_service"] = resolved_service
    result["service_confidence"] = svc_conf

    _resolve_cache[cache_key] = (result, time.monotonic())
    return result


def clear_cache() -> None:
    """Drop the in-memory resolver cache and snapshot cache (tests / ingest)."""
    _resolve_cache.clear()
    _load_snapshot.cache_clear()


__all__ = ["clear_cache", "resolve_meter"]
