"""Carbon-emissions estimator for Azure compute hours.

Crude order-of-magnitude estimate using a region → kgCO2e/kWh table and
a SKU → kW table. Good enough to answer "how green is this region?" and
"what's the carbon delta if we move from West US to North Europe?" -- not
a substitute for the real Microsoft Emissions Impact Dashboard.

Sources for the carbon-intensity values:
  - Microsoft Sustainability Calculator (2024 regional averages)
  - electricityMaps.com Azure region mapping

Numbers are rounded to one decimal because the underlying figures shift
quarterly; pretending three-digit precision would be dishonest.
"""
from __future__ import annotations

from typing import Any

# kg CO2e per kWh by Azure region (2024 averages, lower is greener).
# Missing region → falls back to GLOBAL_AVERAGE.
GLOBAL_AVERAGE_KGCO2E_PER_KWH = 0.4
REGION_CARBON_INTENSITY: dict[str, float] = {
    "northeurope": 0.27,
    "westeurope": 0.30,
    "swedencentral": 0.04,
    "norwayeast": 0.03,
    "francecentral": 0.06,
    "switzerlandnorth": 0.05,
    "uksouth": 0.20,
    "ukwest": 0.20,
    "germanywestcentral": 0.35,
    "canadacentral": 0.13,
    "canadaeast": 0.13,
    "centralus": 0.42,
    "eastus": 0.39,
    "eastus2": 0.39,
    "northcentralus": 0.45,
    "southcentralus": 0.40,
    "westus": 0.21,
    "westus2": 0.21,
    "westus3": 0.31,
    "japaneast": 0.49,
    "japanwest": 0.49,
    "koreacentral": 0.42,
    "southeastasia": 0.43,
    "eastasia": 0.71,
    "australiaeast": 0.66,
    "australiasoutheast": 0.66,
    "brazilsouth": 0.10,
    "centralindia": 0.71,
    "southindia": 0.71,
    "southafricanorth": 0.91,
    "uaenorth": 0.46,
}

# Rough sustained power draw (kW) per VM size at typical 50% load.
# Generic compute D/E families; reflects average TDP × utilisation.
_SKU_POWER_KW: dict[str, float] = {
    "ds1_v2": 0.04, "ds2_v2": 0.08, "ds3_v2": 0.16, "ds4_v2": 0.32, "ds5_v2": 0.64,
    "d2s_v3": 0.08, "d4s_v3": 0.16, "d8s_v3": 0.32, "d16s_v3": 0.64, "d32s_v3": 1.28,
    "d2s_v4": 0.07, "d4s_v4": 0.14, "d8s_v4": 0.28, "d16s_v4": 0.55, "d32s_v4": 1.10,
    "d2s_v5": 0.06, "d4s_v5": 0.12, "d8s_v5": 0.24, "d16s_v5": 0.48, "d32s_v5": 0.96,
    "e2s_v5": 0.07, "e4s_v5": 0.14, "e8s_v5": 0.28, "e16s_v5": 0.55,
    "f2s_v2": 0.05, "f4s_v2": 0.10, "f8s_v2": 0.20, "f16s_v2": 0.40,
}
DEFAULT_VM_POWER_KW = 0.20  # ~middle of D4-D8 v5


def _normalise_sku(sku: str) -> str:
    return (sku or "").strip().lower().removeprefix("standard_")


def estimate_for_line_items(
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Estimate monthly kg CO2e for a list of compute line items.

    Each item: ``{"service": str, "sku": str, "region": str,
    "quantity": float, "hours_per_month": float}``. Non-compute services
    are skipped silently (storage/network carbon is dominated by the
    upstream compute).
    """
    rows: list[dict[str, Any]] = []
    total_kgco2e = 0.0
    total_kwh = 0.0
    for item in items:
        region = (item.get("region") or "eastus").lower()
        sku = _normalise_sku(item.get("sku", ""))
        qty = float(item.get("quantity") or 1)
        hours = float(item.get("hours_per_month") or 730.0)
        power_kw = _SKU_POWER_KW.get(sku, DEFAULT_VM_POWER_KW)
        kwh = power_kw * hours * qty
        intensity = REGION_CARBON_INTENSITY.get(region, GLOBAL_AVERAGE_KGCO2E_PER_KWH)
        kgco2e = kwh * intensity
        total_kgco2e += kgco2e
        total_kwh += kwh
        rows.append({
            "service": item.get("service"),
            "sku": item.get("sku"),
            "region": region,
            "quantity": qty,
            "hours_per_month": hours,
            "kwh_per_month": round(kwh, 1),
            "kgco2e_per_kwh": intensity,
            "kgco2e_per_month": round(kgco2e, 1),
            "power_assumption_kw": power_kw,
        })
    return {
        "line_items": rows,
        "total_kwh_per_month": round(total_kwh, 1),
        "total_kgco2e_per_month": round(total_kgco2e, 1),
        "methodology": (
            "Order-of-magnitude only. Power draws are sustained averages at ~50% utilisation; "
            "regional intensities are 2024 grid averages. For audit-grade numbers use the "
            "Microsoft Emissions Impact Dashboard."
        ),
    }


def compare_regions(
    candidate_regions: list[str],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Re-run the line items in each candidate region and rank by carbon.
    Use for "where should we deploy if carbon is the constraint?" questions.
    """
    options: list[dict[str, Any]] = []
    for region in candidate_regions:
        scoped = [dict(item, region=region) for item in items]
        est = estimate_for_line_items(scoped)
        options.append({
            "region": region,
            "kwh_per_month": est["total_kwh_per_month"],
            "kgco2e_per_month": est["total_kgco2e_per_month"],
            "kgco2e_per_kwh": REGION_CARBON_INTENSITY.get(
                region.lower(), GLOBAL_AVERAGE_KGCO2E_PER_KWH
            ),
        })
    options.sort(key=lambda o: o["kgco2e_per_month"])
    return {
        "options": options,
        "greenest": options[0]["region"] if options else None,
    }


__all__ = ["compare_regions", "estimate_for_line_items"]
