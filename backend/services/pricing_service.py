"""Azure Retail Pricing API wrapper — no auth required."""

from datetime import datetime, timezone

import httpx

PRICING_API = "https://prices.azure.com/api/retail/prices"
PRICING_DATA_SOURCE = "Azure Retail Pricing API (prices.azure.com)"

# Maps common service labels to Azure Retail Pricing API service names
SERVICE_NAME_MAP = {
    "app service": "Azure App Service",
    "functions": "Azure Functions",
    "container apps": "Azure Container Apps",
    "aks": "Azure Kubernetes Service",
    "vm": "Virtual Machines",
    "virtual machine": "Virtual Machines",
    "sql database": "SQL Database",
    "azure sql": "SQL Database",
    "cosmos db": "Azure Cosmos DB",
    "storage account": "Storage",
    "blob storage": "Storage",
    "service bus": "Service Bus",
    "event hubs": "Event Hubs",
    "key vault": "Key Vault",
    "api management": "API Management",
    "front door": "Azure Front Door",
    "application gateway": "Application Gateway",
    "log analytics": "Log Analytics",
    "monitor": "Azure Monitor",
    "bandwidth": "Bandwidth",
    "redis": "Azure Cache for Redis",
    "cognitive services": "Cognitive Services",
    "openai": "Azure OpenAI",
}


async def get_price(
    service: str,
    sku_name: str = "",
    region: str = "eastus",
    currency: str = "USD",
) -> list[dict]:
    """Query Azure Retail Pricing API. Retries without SKU filter if no results."""
    service_normalized = SERVICE_NAME_MAP.get(service.lower().strip(), service)
    region = region or "eastus"

    async def _query(include_sku: bool) -> list[dict]:
        filters = [
            f"serviceName eq '{service_normalized}'",
            f"armRegionName eq '{region}'",
            "priceType eq 'Consumption'",
        ]
        if include_sku and sku_name:
            filters.append(f"contains(tolower(skuName), '{sku_name.lower()}')")
        params = {"$filter": " and ".join(filters), "currencyCode": currency, "$top": 20}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(PRICING_API, params=params)
                resp.raise_for_status()
                return resp.json().get("Items", [])
        except Exception:
            return []

    results = await _query(include_sku=bool(sku_name))
    if not results and sku_name:
        results = await _query(include_sku=False)
    return results


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
    for (svc, _), items in zip(probes, results):
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
            "last_queried_at": datetime.now(timezone.utc).isoformat(),
        },
        "disclaimer": (
            "Estimates based on Azure Retail (pay-as-you-go) pricing. "
            "Reserved Instances can reduce compute costs 40-72%. "
            "Actual costs depend on exact usage patterns."
        ),
    }
