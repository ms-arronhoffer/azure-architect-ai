"""Bulk ingest of the Azure Retail Pricing catalog into ``PricingMeter``.

Walks the public Retail Pricing API (``prices.azure.com``) following the real
``NextPageLink`` pagination field, normalises each meter onto the canonical
``PricingMeter`` shape, and upserts keyed on ``(meterId, armRegionName,
currencyCode)``. Stale rows past the TTL are pruned. This is what the
resolver/catalog query instead of the old loose live ``contains`` filter.

Exposed for both the APScheduler job (``services/scheduler.py``,
``pricing_ingest_daily``) and the manual ``POST /api/cost/pricing/ingest``
admin endpoint.

By default it scrapes only ``settings.pricing_regions`` x ``pricing_currency``
and ``priceType eq 'Consumption'`` to keep the dataset bounded; set
``pricing_regions=["*"]`` to scrape every region.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import delete, select

from config import settings
from db import PricingMeter, session_scope
from middleware.logging import get_logger
from services.pricing_resolver import search_key

_log = get_logger("pricing_ingest")

PRICING_API = "https://prices.azure.com/api/retail/prices"
_SNAPSHOT_PATH = (
    Path(__file__).resolve().parent.parent / "knowledge" / "pricing" / "sku_catalog.json"
)
_PAGE_CAP = 2000  # safety valve — ~2M rows max at $top=1000


def _build_filter(regions: list[str], currency: str) -> str:
    clauses = ["priceType eq 'Consumption'"]
    regions = [r for r in (regions or []) if r and r != "*"]
    if regions:
        ors = " or ".join(f"armRegionName eq '{r}'" for r in regions)
        clauses.append(f"({ors})")
    return " and ".join(clauses)


async def _http_get_json(
    client: httpx.AsyncClient, url: str, params: dict[str, Any] | None
) -> dict[str, Any]:
    """Single GET returning parsed JSON. Isolated so tests can monkeypatch it."""
    resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


async def fetch_prices(
    regions: list[str] | None = None,
    currency: str | None = None,
    page_cap: int = _PAGE_CAP,
) -> list[dict[str, Any]]:
    """Walk the paginated Retail feed and return every meter item."""
    regions = regions if regions is not None else settings.pricing_regions
    currency = currency or settings.pricing_currency
    headers = {"User-Agent": settings.ingest_user_agent, "Accept": "application/json"}
    out: list[dict[str, Any]] = []
    url: str | None = PRICING_API
    params: dict[str, Any] | None = {
        "$filter": _build_filter(regions, currency),
        "currencyCode": currency,
        "$top": 1000,
    }
    pages = 0
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
        while url:
            data = await _http_get_json(client, url, params)
            out.extend(data.get("Items") or [])
            # NextPageLink is a fully-formed URL that already encodes the query.
            url = data.get("NextPageLink") or None
            params = None
            pages += 1
            if pages >= page_cap:
                _log.warning("pricing_ingest.pagination_cap_hit", pages=pages)
                break
    _log.info("pricing_ingest.fetched", pages=pages, items=len(out))
    return out


def _row_id(meter_id: str, region: str, currency: str, item: dict[str, Any]) -> str:
    if meter_id:
        return f"{meter_id}|{region}|{currency}"
    # Fall back to a composite when the API omits meterId.
    return "|".join(
        [
            item.get("skuName", ""),
            item.get("meterName", ""),
            region,
            currency,
        ]
    )


def normalize(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map a Retail API item onto the canonical ``PricingMeter`` dict shape.

    Returns ``None`` when the item lacks the fields the resolver needs.
    """
    region = item.get("armRegionName") or ""
    currency = item.get("currencyCode") or settings.pricing_currency
    service_name = item.get("serviceName") or ""
    if not service_name or not region:
        return None
    meter_id = item.get("meterId") or ""
    sku_name = item.get("skuName") or ""
    arm_sku = item.get("armSkuName") or ""
    meter_name = item.get("meterName") or ""
    return {
        "id": _row_id(meter_id, region, currency, item),
        "meter_id": meter_id,
        "service_name": service_name,
        "service_family": item.get("serviceFamily") or "",
        "product_name": item.get("productName") or "",
        "sku_name": sku_name,
        "meter_name": meter_name,
        "arm_sku_name": arm_sku,
        "arm_region_name": region,
        "unit_of_measure": item.get("unitOfMeasure") or "",
        "retail_price": float(item.get("retailPrice") or 0.0),
        "currency_code": currency,
        "price_type": item.get("priceType") or "Consumption",
        "search_key": search_key(f"{sku_name} {arm_sku} {meter_name}"),
        "effective_start_date": item.get("effectiveStartDate"),
    }


async def upsert_meters(entries: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert normalised rows keyed on ``id``. Returns counts."""
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    inserted = updated = unchanged = 0
    seen: set[str] = set()

    async with session_scope() as session:
        for entry in entries:
            row_id = entry["id"]
            if row_id in seen:
                continue
            seen.add(row_id)
            existing: PricingMeter | None = (
                await session.execute(select(PricingMeter).where(PricingMeter.id == row_id))
            ).scalars().first()

            if existing is None:
                session.add(PricingMeter(last_synced_at=now, **entry))
                inserted += 1
                continue

            changed = (
                existing.retail_price != entry["retail_price"]
                or existing.sku_name != entry["sku_name"]
                or existing.meter_name != entry["meter_name"]
                or existing.product_name != entry["product_name"]
                or existing.unit_of_measure != entry["unit_of_measure"]
            )
            if changed:
                for field, value in entry.items():
                    setattr(existing, field, value)
                updated += 1
            else:
                unchanged += 1
            existing.last_synced_at = now
        await session.commit()

    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


async def prune_stale(ttl_days: int | None = None) -> int:
    """Delete rows whose ``last_synced_at`` is older than the TTL. Returns count."""
    ttl_days = ttl_days if ttl_days is not None else settings.pricing_catalog_ttl_days
    cutoff = (dt.datetime.now(dt.UTC) - dt.timedelta(days=ttl_days)).isoformat().replace(
        "+00:00", "Z"
    )
    async with session_scope() as session:
        result = await session.execute(
            delete(PricingMeter).where(PricingMeter.last_synced_at < cutoff)
        )
        await session.commit()
        return result.rowcount or 0


async def export_snapshot(path: Path | None = None) -> dict[str, Any]:
    """Write the catalog table to the committed JSON snapshot so CI / offline
    runs resolve prices without a scrape."""
    path = path or _SNAPSHOT_PATH
    async with session_scope() as session:
        rows = (await session.execute(select(PricingMeter))).scalars().all()
    meters = [
        {
            "meterId": r.meter_id,
            "serviceName": r.service_name,
            "serviceFamily": r.service_family,
            "productName": r.product_name,
            "skuName": r.sku_name,
            "meterName": r.meter_name,
            "armSkuName": r.arm_sku_name,
            "armRegionName": r.arm_region_name,
            "unitOfMeasure": r.unit_of_measure,
            "retailPrice": r.retail_price,
            "currencyCode": r.currency_code,
            "priceType": r.price_type,
            "effectiveStartDate": r.effective_start_date,
        }
        for r in rows
    ]
    payload = {
        "generated_at": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        "currency": settings.pricing_currency,
        "source": "Azure Retail Pricing API (prices.azure.com)",
        "meters": meters,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {"path": str(path), "rows": len(meters)}


async def run_ingest() -> dict[str, Any]:
    """Top-level entry point — fetch, normalise, upsert, prune, log."""
    started = dt.datetime.now(dt.UTC)
    try:
        raw = await fetch_prices()
    except Exception as exc:
        _log.exception("pricing_ingest.fetch_failed", error=str(exc))
        return {"ok": False, "stage": "fetch", "error": str(exc)}

    normalised: list[dict[str, Any]] = []
    for item in raw:
        norm = normalize(item)
        if norm is not None:
            normalised.append(norm)

    try:
        counts = await upsert_meters(normalised)
    except Exception as exc:
        _log.exception("pricing_ingest.upsert_failed", error=str(exc))
        return {"ok": False, "stage": "upsert", "error": str(exc)}

    pruned = 0
    try:
        pruned = await prune_stale()
    except Exception as exc:
        _log.exception("pricing_ingest.prune_failed", error=str(exc))

    # Refresh the in-memory catalog caches so the new rows are visible.
    try:
        from services import pricing_catalog

        pricing_catalog.clear_cache()
    except Exception:
        pass

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "fetched": len(raw),
        "normalized": len(normalised),
        "pruned": pruned,
        "duration_s": round(duration_s, 2),
        **counts,
    }
    _log.info("pricing_ingest.completed", **summary)
    return summary


__all__ = [
    "export_snapshot",
    "fetch_prices",
    "normalize",
    "prune_stale",
    "run_ingest",
    "upsert_meters",
]
