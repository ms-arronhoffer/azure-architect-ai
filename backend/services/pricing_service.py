"""Azure Retail Pricing API wrapper — no auth required."""

import json
import re
import time
from datetime import UTC, datetime

import httpx

PRICING_API = "https://prices.azure.com/api/retail/prices"
PRICING_DATA_SOURCE = "Azure Retail Pricing API (prices.azure.com)"

_price_cache: dict[tuple, tuple[list[dict], float]] = {}
_PRICE_CACHE_TTL = 6 * 3600  # 6 hours

# Maps common service labels to Azure Retail Pricing API service names
SERVICE_NAME_MAP = {
    "app service": "Azure App Service",
    "azure app service": "Azure App Service",
    "functions": "Azure Functions",
    "azure functions": "Azure Functions",
    "container apps": "Azure Container Apps",
    "azure container apps": "Azure Container Apps",
    "aks": "Azure Kubernetes Service",
    "azure kubernetes service": "Azure Kubernetes Service",
    "vm": "Virtual Machines",
    "virtual machine": "Virtual Machines",
    "sql database": "SQL Database",
    "azure sql database": "SQL Database",
    "azure sql": "SQL Database",
    "cosmos db": "Azure Cosmos DB",
    "azure cosmos db": "Azure Cosmos DB",
    "storage account": "Storage",
    "blob storage": "Storage",
    "azure storage": "Storage",
    "azure blob storage": "Storage",
    "service bus": "Service Bus",
    "azure service bus": "Service Bus",
    "event hubs": "Event Hubs",
    "azure event hubs": "Event Hubs",
    "key vault": "Key Vault",
    "azure key vault": "Key Vault",
    "api management": "API Management",
    "azure api management": "API Management",
    "front door": "Azure Front Door",
    "azure front door": "Azure Front Door",
    "application gateway": "Application Gateway",
    "azure application gateway": "Application Gateway",
    "log analytics": "Log Analytics",
    "azure monitor log analytics": "Log Analytics",
    "monitor": "Azure Monitor",
    "azure monitor": "Azure Monitor",
    "bandwidth": "Bandwidth",
    "redis": "Azure Cache for Redis",
    "azure cache for redis": "Azure Cache for Redis",
    "cognitive services": "Cognitive Services",
    "openai": "Azure OpenAI",
    "azure openai": "Azure OpenAI",
}

# ARM-format SKU names → Pricing API display names
_ARM_SKU_ALIASES: dict[str, str] = {
    "standard_lrs": "LRS",
    "standard_grs": "GRS",
    "standard_ragrs": "RA-GRS",
    "standard_zrs": "ZRS",
    "premium_lrs": "Premium LRS",
    "premium_zrs": "Premium ZRS",
    # PerGB2018 is a Log Analytics billing model label, not a skuName — skip filter
    "pergb2018": "",
    "free": "Free",
    "standalone": "Standalone",
}

_SQL_TIER_MAP: dict[str, str] = {
    "gp_s": "General Purpose Serverless",
    "gp": "General Purpose",
    "bc": "Business Critical",
    "hs": "Hyperscale",
}


def _normalize_sku(sku: str) -> str:
    """Convert ARM-format SKU names to Azure Retail Pricing API display names."""
    if not sku:
        return sku
    lower = sku.lower()
    if lower in _ARM_SKU_ALIASES:
        return _ARM_SKU_ALIASES[lower]
    # SQL vCore patterns: GP_S_Gen5_2, GP_Gen5_4, BC_Gen5_8, HS_Gen5_16
    m = re.match(r"(gp_s|gp|bc|hs)_gen\d+_\d+", lower)
    if m:
        return _SQL_TIER_MAP.get(m.group(1), sku)
    # App Service / Isolated plan SKUs: the Retail API publishes skuName with a
    # space before the version suffix ("P1 v3", "P1mv3" -> "P1m v3", "I1 v2"),
    # but ARM / diagram inputs usually omit it ("P1v3"). Without this the SKU
    # filter matches nothing and the lookup retries unfiltered, collapsing to the
    # cheapest "Shared App" meter (~$0.01/hr).
    m = re.fullmatch(r"([a-z]\d+m?)(v\d+)", lower)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return sku


def _odata_escape(value: str) -> str:
    """Escape single quotes for an OData string literal."""
    return value.replace("'", "''")


async def get_price(
    service: str,
    sku_name: str = "",
    region: str = "eastus",
    currency: str = "USD",
    *,
    meter_name: str = "",
    product_name: str = "",
    unit_of_measure: str = "",
) -> list[dict]:
    """Query Azure Retail Pricing API. Retries without SKU filter if no results.

    Results are cached for 6 hours keyed by every filter argument. The optional
    ``meter_name`` / ``product_name`` / ``unit_of_measure`` arguments let the
    meter-aware pricing engine disambiguate the many records a single service
    publishes (e.g. SQL Database vCore compute vs. data storage vs. backup)."""
    service_normalized = SERVICE_NAME_MAP.get(service.lower().strip(), service)
    region = region or "eastus"
    effective_sku = _normalize_sku(sku_name)

    async def _query(include_sku: bool) -> list[dict]:
        cache_key = (
            service_normalized,
            effective_sku if include_sku else "",
            region,
            currency,
            meter_name.lower(),
            product_name.lower(),
            unit_of_measure.lower(),
        )
        cached = _price_cache.get(cache_key)
        if cached and (time.monotonic() - cached[1]) < _PRICE_CACHE_TTL:
            return cached[0]

        filters = [
            f"serviceName eq '{_odata_escape(service_normalized)}'",
            f"armRegionName eq '{_odata_escape(region)}'",
            "priceType eq 'Consumption'",
        ]
        if include_sku and effective_sku:
            filters.append(f"contains(tolower(skuName), '{_odata_escape(effective_sku.lower())}')")
        if meter_name:
            filters.append(f"contains(tolower(meterName), '{_odata_escape(meter_name.lower())}')")
        if product_name:
            filters.append(f"contains(tolower(productName), '{_odata_escape(product_name.lower())}')")
        if unit_of_measure:
            filters.append(
                f"contains(tolower(unitOfMeasure), '{_odata_escape(unit_of_measure.lower())}')"
            )
        params = {"$filter": " and ".join(filters), "currencyCode": currency, "$top": 50}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(PRICING_API, params=params)
                resp.raise_for_status()
                items = resp.json().get("Items", [])
                _price_cache[cache_key] = (items, time.monotonic())
                return items
        except Exception:
            return []

    results = await _query(include_sku=bool(sku_name))
    if not results and sku_name:
        results = await _query(include_sku=False)
    return results


async def _mcp_price_search(service: str, sku: str, region: str) -> list[dict]:
    """Last-resort fallback: use azure-pricing-mcp to find price when direct API fails."""
    try:
        from services.mcp_service import _session_map, call_mcp_tool
        tool = next(
            (t for t in ("azure_sku_discovery", "azure_price_search") if t in _session_map),
            None,
        )
        if not tool:
            return []
        raw = await call_mcp_tool(f"mcp_{tool}", {"service": service, "sku_hint": sku, "region": region})
        data = json.loads(raw) if isinstance(raw, str) else raw
        items = data if isinstance(data, list) else data.get("items") or data.get("Items") or []
        return [
            {
                "skuName": i.get("skuName") or i.get("sku_name", sku),
                "retailPrice": i.get("retailPrice") or i.get("price") or 0,
                "unitOfMeasure": i.get("unitOfMeasure") or i.get("unit", "1 Hour"),
                "currencyCode": i.get("currencyCode", "USD"),
            }
            for i in items
            if i.get("retailPrice") or i.get("price")
        ]
    except Exception:
        return []


async def estimate_line_item(
    service: str,
    sku: str = "",
    quantity: float = 1,
    hours_per_month: float = 730.0,
    region: str = "eastus",
) -> dict:
    """Estimate monthly cost for one line item. If the requested SKU is not found,
    consult validate_sku for suggestions and auto-swap to the first suggestion."""
    prices = await get_price(service, sku, region)
    requested_sku = sku
    sku_swapped = False

    # On miss with a specific SKU, try to recover via validate_sku suggestions
    if not prices and sku:
        validation = await validate_sku(service, sku, region)
        suggestions = validation.get("suggestions") or []
        if suggestions:
            sku = suggestions[0]
            sku_swapped = True
            prices = await get_price(service, sku, region)

    # Layer 3: MCP fallback when both direct API attempts failed
    if not prices and requested_sku:
        prices = await _mcp_price_search(service, requested_sku, region)

    if not prices:
        return {
            "service": service,
            "sku": requested_sku,
            "requested_sku": requested_sku,
            "region": region,
            "quantity": quantity,
            "unit_price": None,
            "monthly_estimate": None,
            "sku_status": "unknown",
            "note": "Price not found — check Azure Pricing Calculator for this SKU.",
        }

    # Pick the best matching price record
    if sku:
        best = prices[0]
        for p in prices:
            if sku.lower() in p.get("skuName", "").lower():
                best = p
                break
    else:
        # No SKU preference: pick the cheapest non-storage compute price
        compute_prices = [p for p in prices if "gb" not in p.get("unitOfMeasure", "").lower()]
        best = min(compute_prices or prices, key=lambda p: p.get("retailPrice", float("inf")))

    unit_price = best.get("retailPrice", 0)
    unit_of_measure = best.get("unitOfMeasure", "1 Hour")

    # Normalize to per-hour pricing
    if "hour" in unit_of_measure.lower():
        monthly = unit_price * hours_per_month * quantity
    elif "month" in unit_of_measure.lower():
        monthly = unit_price * quantity
    elif "gb" in unit_of_measure.lower():
        monthly = unit_price * quantity  # treat quantity as GB
    else:
        monthly = unit_price * quantity

    result = {
        "service": service,
        "sku": best.get("skuName", sku),
        "region": region,
        "quantity": quantity,
        "unit_price": unit_price,
        "unit_of_measure": unit_of_measure,
        "monthly_estimate": round(monthly, 2),
        "currency": best.get("currencyCode", "USD"),
        "source": PRICING_DATA_SOURCE,
    }
    if sku_swapped:
        result["requested_sku"] = requested_sku
        result["sku_swapped"] = True
    return result


async def validate_sku(service: str, sku: str, region: str = "eastus") -> dict:
    """Return best-match SKU info or suggestions when the requested SKU is not found."""
    prices = await get_price(service, sku, region)
    if not prices:
        broader = await get_price(service, "", region)
        available = list({p.get("skuName", "") for p in broader[:15] if p.get("skuName")})[:5]
        if available:
            return {
                "valid": False,
                "requested_sku": sku,
                "message": f"SKU '{sku}' not found for {service} in {region}.",
                "suggestions": available,
            }
        return {
            "valid": False,
            "requested_sku": sku,
            "message": f"Service '{service}' not available in region '{region}'.",
            "suggestions": [],
        }
    best = next((p for p in prices if sku.lower() in p.get("skuName", "").lower()), prices[0])
    return {
        "valid": True,
        "requested_sku": sku,
        "matched_sku": best.get("skuName", sku),
        "unit_price": best.get("retailPrice", 0),
        "unit_of_measure": best.get("unitOfMeasure", ""),
    }


async def get_regional_pricing_context(region: str = "eastus") -> str:
    """Fetch representative live pricing for common services to ground LLM cost estimates."""
    import asyncio

    probes = [
        ("Virtual Machines", "D2s v3"),
        ("App Service", "P1v3"),
        ("SQL Database", "General Purpose"),
        ("Storage", "LRS"),
        ("Azure Kubernetes Service", ""),
    ]
    results = await asyncio.gather(
        *[get_price(svc, sku, region) for svc, sku in probes],
        return_exceptions=True,
    )
    lines: list[str] = [f"### Live Azure Pricing ({region}, pay-as-you-go)\n"]
    found_any = False
    for (svc, _), items in zip(probes, results, strict=True):
        if isinstance(items, Exception) or not items:
            continue
        best = items[0]
        price = best.get("retailPrice", 0)
        unit = best.get("unitOfMeasure", "")
        sku_name = best.get("skuName", "")
        lines.append(f"- {svc} ({sku_name}): ${price:.4f}/{unit}")
        found_any = True
    return "\n".join(lines) if found_any else ""


async def estimate_architecture(line_items: list[dict]) -> dict:
    """Estimate total monthly cost for a list of services."""
    import asyncio

    tasks = [
        estimate_line_item(
            service=item.get("service", ""),
            sku=item.get("sku", ""),
            quantity=item.get("quantity", 1),
            hours_per_month=item.get("hours_per_month", 730),
            region=item.get("region", "eastus"),
        )
        for item in line_items
    ]
    results = await asyncio.gather(*tasks)

    total = sum(r["monthly_estimate"] or 0 for r in results)
    swapped = sum(1 for r in results if r.get("sku_swapped"))
    missing = sum(1 for r in results if r.get("monthly_estimate") is None)
    return {
        "line_items": results,
        "total_monthly_estimate": round(total, 2),
        "currency": "USD",
        "sku_validation": {
            "total_lines": len(results),
            "swapped": swapped,
            "missing": missing,
            "data_source": PRICING_DATA_SOURCE,
            "last_queried_at": datetime.now(UTC).isoformat(),
        },
        "disclaimer": (
            "Estimates based on Azure Retail (pay-as-you-go) pricing. "
            "Reserved Instances can reduce compute costs 40-72%. "
            "Actual costs depend on exact usage patterns."
        ),
    }
