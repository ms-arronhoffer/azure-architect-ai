"""Quota + capacity awareness for architecture line items.

Calls the `mcp_quota` tool from `@azure/mcp` to verify that each
(service, sku, region) tuple in a cost estimate has subscription quota
headroom. When a SKU is constrained in the preferred region, walks a
hardcoded geo-pair table to find a candidate alternative.

Degrades cleanly: if the MCP server is not running, raises
`QuotaServiceUnavailable` so the caller can emit `phase_skipped`
without breaking the rest of the pipeline.

Cache: 15 min by `(subscription_id, sku, region)`. The quota numbers
shift on the order of hours, not seconds, and the pipeline can run the
same lookup 30+ times per cost estimate.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from middleware.logging import get_logger
from services import mcp_service

log = get_logger("quota_service")


class QuotaServiceUnavailable(RuntimeError):
    """Raised when the MCP quota tool is not reachable."""


# v1 geo-pair fallbacks. Phase 2 can pull this from Azure metadata.
_GEO_PAIRS: dict[str, list[str]] = {
    "eastus": ["westus", "eastus2", "centralus"],
    "eastus2": ["centralus", "westus2", "eastus"],
    "westus": ["eastus", "westus2", "centralus"],
    "westus2": ["eastus2", "westus", "westus3"],
    "westus3": ["westus2", "centralus"],
    "centralus": ["eastus2", "westus2", "northcentralus"],
    "northcentralus": ["southcentralus", "centralus"],
    "southcentralus": ["northcentralus", "centralus"],
    "northeurope": ["westeurope", "uksouth"],
    "westeurope": ["northeurope", "francecentral", "germanywestcentral"],
    "uksouth": ["ukwest", "northeurope"],
    "ukwest": ["uksouth", "northeurope"],
    "francecentral": ["westeurope", "germanywestcentral"],
    "germanywestcentral": ["westeurope", "francecentral"],
    "southeastasia": ["eastasia", "japaneast"],
    "eastasia": ["southeastasia", "japaneast"],
    "japaneast": ["japanwest", "southeastasia"],
    "australiaeast": ["australiasoutheast"],
    "canadacentral": ["canadaeast", "eastus2"],
}

_CACHE_TTL_S = 15 * 60
_MCP_TIMEOUT_S = 10
_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}


def _cache_get(key: tuple[str, str, str]) -> dict[str, Any] | None:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.monotonic() - ts > _CACHE_TTL_S:
        _cache.pop(key, None)
        return None
    return value


def _cache_put(key: tuple[str, str, str], value: dict[str, Any]) -> None:
    _cache[key] = (time.monotonic(), value)


def _candidate_regions(preferred: str | None, current: str) -> list[str]:
    """Region search order: engagement preferred, then current, then geo-pairs.

    Deduplicates while preserving order.
    """
    seen: set[str] = set()
    out: list[str] = []
    for r in [preferred, current, *_GEO_PAIRS.get(current.lower(), [])]:
        if not r:
            continue
        rl = r.lower()
        if rl in seen:
            continue
        seen.add(rl)
        out.append(rl)
    return out


async def _query_quota(
    subscription_id: str,
    sku: str,
    region: str,
) -> dict[str, Any]:
    """Single MCP call. Returns `{available: int, requested: int|None, raw: ...}`.

    Best-effort parse of the MCP response shape — the underlying `quota`
    tool returns text-wrapped JSON. We swallow parse errors and treat
    them as `available=None` (caller treats unknown as not-constrained).
    """
    key = (subscription_id, sku.lower(), region.lower())
    cached = _cache_get(key)
    if cached is not None:
        return cached

    args = {
        "subscription": subscription_id,
        "resourceType": sku,
        "region": region,
    }
    try:
        raw = await asyncio.wait_for(
            mcp_service.call_mcp_tool("mcp_quota", args),
            timeout=_MCP_TIMEOUT_S,
        )
    except TimeoutError:
        log.warning("quota_lookup_timeout", sku=sku, region=region)
        result = {"available": None, "raw": "timeout"}
        _cache_put(key, result)
        return result

    parsed: dict[str, Any] = {"available": None, "raw": raw}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(data, dict):
            # MCP quota responses vary; probe common shapes.
            limit = data.get("limit") or data.get("Limit")
            used = data.get("currentValue") or data.get("CurrentValue") or 0
            if limit is not None:
                parsed["available"] = max(int(limit) - int(used), 0)
            elif "available" in data:
                parsed["available"] = int(data["available"])
            parsed["raw"] = data
    except (ValueError, TypeError) as exc:
        log.debug("quota_parse_failed", sku=sku, region=region, error=str(exc))

    _cache_put(key, parsed)
    return parsed


async def check_quota_for_line_items(
    line_items: list[dict[str, Any]],
    subscription_ids: list[str],
    *,
    preferred_region: str | None = None,
) -> dict[str, Any]:
    """Check quota for each line item; surface alternative regions on constraint.

    Returns `{constraints: [...], alternatives_by_sku: {...}}`.

    A *constraint* is `{service, sku, region, requested, available,
    subscription_id, alternatives: [{region, available}]}`. When
    `available is None` (the MCP didn't return a usable number), we
    treat the line as not constrained — better to ship than to false-
    positive on parse failures.
    """
    if not mcp_service.is_mcp_available():
        raise QuotaServiceUnavailable("MCP server is not running")

    if not subscription_ids:
        raise QuotaServiceUnavailable("no subscription_ids on active engagement")

    constraints: list[dict[str, Any]] = []
    alternatives_by_sku: dict[str, list[dict[str, Any]]] = {}

    # Run all checks concurrently for the first subscription. v1: pick the
    # first subscription that has headroom (left-to-right preference).
    async def _check_one(item: dict[str, Any]) -> dict[str, Any] | None:
        sku = item.get("sku") or item.get("size") or ""
        if not sku:
            return None
        region = (item.get("region") or preferred_region or "").lower()
        if not region:
            return None
        service = item.get("service") or ""
        requested = int(item.get("quantity") or 1)

        # Subscription fan-out: try each, keep the one with the most headroom.
        best_sub: str | None = None
        best_avail: int = -1
        best_resp: dict[str, Any] = {}
        for sub in subscription_ids:
            resp = await _query_quota(sub, sku, region)
            avail = resp.get("available")
            if avail is None:
                continue
            if avail > best_avail:
                best_avail = avail
                best_sub = sub
                best_resp = resp

        # Unknown → not a constraint
        if best_sub is None or best_avail < 0:
            return None

        if best_avail >= requested:
            return None

        # Constrained — walk candidate regions for alternatives.
        alternatives: list[dict[str, Any]] = []
        for alt_region in _candidate_regions(preferred_region, region):
            if alt_region == region:
                continue
            for sub in subscription_ids:
                alt_resp = await _query_quota(sub, sku, alt_region)
                alt_avail = alt_resp.get("available")
                if alt_avail is not None and alt_avail >= requested:
                    alternatives.append({"region": alt_region, "available": int(alt_avail), "subscription_id": sub})
                    break
            if len(alternatives) >= 3:
                break

        constraint = {
            "service": service,
            "sku": sku,
            "region": region,
            "requested": requested,
            "available": int(best_avail),
            "subscription_id": best_sub,
            "alternatives": alternatives,
        }
        alternatives_by_sku.setdefault(sku, []).extend(alternatives)
        return constraint

    results = await asyncio.gather(*(_check_one(li) for li in line_items), return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            log.warning("quota_check_item_failed", error=str(r))
            continue
        if r is not None:
            constraints.append(r)

    return {
        "constraints": constraints,
        "alternatives_by_sku": alternatives_by_sku,
    }


__all__ = ["check_quota_for_line_items", "QuotaServiceUnavailable"]
