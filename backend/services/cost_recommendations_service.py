"""Deterministic cost-optimization recommendation engine.

Unlike ``reservations_service`` / ``rightsizing_service`` (which need a live
subscription), this engine works on **manual input alone** — the meter-level
cost breakdown produced by ``meter_pricing_service`` — so the cost tool offers
actionable savings even before an engagement is connected.

Each heuristic returns a structured recommendation:

    {
      id, line_ref, type, title, rationale,
      current_monthly, proposed_monthly, monthly_savings,
      confidence, effort
    }

Heuristics implemented:
  * reserved_instance  — RI / Savings Plan modelling on eligible compute meters
  * storage_tier       — flag GRS/RA-GRS redundancy when capacity dominates
  * idle_resource      — instances allocated < ~25% of the month (low hours)
  * region_shift       — point at the cheapest / greenest equivalent region

All math is deterministic and grounded in the priced breakdown; nothing is
invented. The engine never raises — a failing heuristic is skipped.
"""
from __future__ import annotations

from typing import Any

from middleware.logging import get_logger
from services import carbon_service, cost_catalog, reservations_service

log = get_logger("cost_recommendations_service")

# Fractional discount bands used when live RI prices are unavailable. Keyed by
# commitment term; conservative midpoints of published Azure RI/SP savings.
_RI_DISCOUNT = {"1yr_ri": 0.40, "3yr_ri": 0.60, "savings_plan": 0.28}

# Redundancy tiers that usually overpay when capacity dominates a storage line.
_EXPENSIVE_REDUNDANCY = ("gzrs", "ra-grs", "ragrs", "grs")


def _compute_monthly(line: dict[str, Any]) -> float:
    """Sum the priced compute meters on a line (hours-billed dimensions)."""
    total = 0.0
    for m in line.get("meters", []):
        unit = (m.get("unit") or "").lower()
        if "hour" in unit and m.get("monthly_cost"):
            total += float(m["monthly_cost"])
    return round(total, 2)


def _ri_discount_for(line: dict[str, Any]) -> float:
    """Resolve the RI/SP discount: catalog band first, then a default."""
    svc = cost_catalog.resolve_service(line.get("service", ""))
    if svc and isinstance(svc.get("ri_discounts"), dict):
        bands = svc["ri_discounts"]
        return float(bands.get("three_year", bands.get("one_year", 0.4)) or 0.4)
    return _RI_DISCOUNT["3yr_ri"]


def _reserved_instance_recs(breakdown: dict[str, Any]) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    for idx, line in enumerate(breakdown.get("line_items", [])):
        if not line.get("ri_eligible"):
            continue
        compute = _compute_monthly(line)
        if compute <= 0:
            continue
        discount = _ri_discount_for(line)
        proposed = round(compute * (1 - discount), 2)
        savings = round(compute - proposed, 2)
        if savings <= 0:
            continue
        be = reservations_service.break_even(
            payg_monthly=compute,
            reserved_monthly=proposed,
            upfront_cost=0.0,
            term_years=3,
        )
        recs.append(
            {
                "id": f"ri-{idx}",
                "line_ref": idx,
                "service": line.get("service"),
                "type": "reserved_instance",
                "title": f"Commit {line.get('display_name') or line.get('service')} to a 3-year reservation",
                "rationale": (
                    f"Compute meters total ${compute:,.2f}/mo at pay-as-you-go. A 3-year "
                    f"reservation (~{int(discount * 100)}% off eligible compute) cuts this to "
                    f"${proposed:,.2f}/mo."
                ),
                "current_monthly": compute,
                "proposed_monthly": proposed,
                "monthly_savings": savings,
                "confidence": "medium",
                "effort": "low",
                "break_even": be,
            }
        )
    return recs


def _storage_tier_recs(breakdown: dict[str, Any]) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    for idx, line in enumerate(breakdown.get("line_items", [])):
        if line.get("category") != "storage":
            continue
        sku = (line.get("sku") or "").lower()
        if not any(r in sku for r in _EXPENSIVE_REDUNDANCY):
            continue
        capacity = next(
            (m for m in line.get("meters", []) if m.get("dimension") == "capacity"), None
        )
        if not capacity or not capacity.get("monthly_cost"):
            continue
        current = float(capacity["monthly_cost"])
        # GRS is ~2x LRS; dropping to LRS roughly halves capacity cost.
        proposed = round(current * 0.5, 2)
        savings = round(current - proposed, 2)
        if savings <= 0:
            continue
        recs.append(
            {
                "id": f"storage-{idx}",
                "line_ref": idx,
                "service": line.get("service"),
                "type": "storage_tier",
                "title": f"Re-evaluate redundancy on {line.get('display_name') or line.get('service')}",
                "rationale": (
                    f"This account uses geo-redundant storage ('{line.get('sku')}'). If the "
                    f"workload tolerates LRS/ZRS, capacity cost drops from ${current:,.2f} to "
                    f"~${proposed:,.2f}/mo."
                ),
                "current_monthly": current,
                "proposed_monthly": proposed,
                "monthly_savings": savings,
                "confidence": "low",
                "effort": "medium",
            }
        )
    return recs


def _idle_resource_recs(breakdown: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    for idx, line in enumerate(breakdown.get("line_items", [])):
        item = items[idx] if idx < len(items) else {}
        hours = float(item.get("hours_per_month", 730) or 730)
        if hours >= 730 or hours <= 0:
            continue
        compute = _compute_monthly(line)
        if compute <= 0:
            continue
        # Auto-shutdown to business hours (~160h/mo) when already part-time.
        target_hours = min(hours, 160.0)
        proposed = round(compute * (target_hours / hours), 2) if hours else compute
        savings = round(compute - proposed, 2)
        if savings <= 0.01:
            continue
        recs.append(
            {
                "id": f"idle-{idx}",
                "line_ref": idx,
                "service": line.get("service"),
                "type": "idle_resource",
                "title": f"Schedule auto-shutdown for {line.get('display_name') or line.get('service')}",
                "rationale": (
                    f"Modelled at {hours:.0f} h/mo. Tightening to ~{target_hours:.0f} h/mo "
                    f"(business hours) trims compute from ${compute:,.2f} to ${proposed:,.2f}/mo."
                ),
                "current_monthly": compute,
                "proposed_monthly": proposed,
                "monthly_savings": savings,
                "confidence": "low",
                "effort": "low",
            }
        )
    return recs


async def _region_shift_recs(breakdown: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Greenest-region carbon delta for the whole model (cost-neutral signal)."""
    recs: list[dict[str, Any]] = []
    try:
        line_items = [
            {
                "service": it.get("service", ""),
                "sku": it.get("sku", ""),
                "region": it.get("region", "eastus"),
                "quantity": it.get("quantity", 1),
                "hours_per_month": it.get("hours_per_month", 730),
            }
            for it in items
        ]
        if not line_items:
            return recs
        current_region = line_items[0]["region"]
        candidates = ["swedencentral", "norwayeast", "francecentral", "westus2"]
        compare = [r for r in candidates if r != current_region]
        result = carbon_service.compare_regions(compare, line_items)
        rows = result.get("options") if isinstance(result, dict) else result
        if not rows:
            return recs
        greenest = min(
            rows,
            key=lambda r: r.get("kgco2e_per_month", float("inf")),
        )
        recs.append(
            {
                "id": "region-green",
                "line_ref": None,
                "service": None,
                "type": "region_shift",
                "title": f"Greener region option: {greenest.get('region')}",
                "rationale": (
                    f"Running this workload in {greenest.get('region')} would emit "
                    f"~{greenest.get('kgco2e_per_month', 0):.1f} kgCO₂e/mo. Validate "
                    f"latency and data-residency before moving."
                ),
                "current_monthly": None,
                "proposed_monthly": None,
                "monthly_savings": 0.0,
                "confidence": "low",
                "effort": "high",
                "carbon_kgco2e_per_month": greenest.get("kgco2e_per_month"),
            }
        )
    except Exception as exc:  # never raise
        log.info("cost_recommendations.region_shift_skipped", error=str(exc))
    return recs


async def recommend(
    breakdown: dict[str, Any], items: list[dict[str, Any]]
) -> dict[str, Any]:
    """Aggregate every heuristic into a ranked recommendation list.

    ``breakdown`` is the output of ``meter_pricing_service.price_model``;
    ``items`` is the original line-item payload (same order)."""
    recs: list[dict[str, Any]] = []
    for fn in (_reserved_instance_recs, _storage_tier_recs):
        try:
            recs.extend(fn(breakdown))
        except Exception as exc:
            log.info("cost_recommendations.heuristic_skipped", fn=fn.__name__, error=str(exc))
    try:
        recs.extend(_idle_resource_recs(breakdown, items))
    except Exception as exc:
        log.info("cost_recommendations.idle_skipped", error=str(exc))
    recs.extend(await _region_shift_recs(breakdown, items))

    # Rank by annual $ impact (savings * 12), carbon-only recs sink to the end.
    recs.sort(key=lambda r: (r.get("monthly_savings") or 0), reverse=True)
    total_savings = round(sum(r.get("monthly_savings") or 0 for r in recs), 2)
    return {
        "recommendations": recs,
        "total_monthly_savings": total_savings,
        "total_annual_savings": round(total_savings * 12, 2),
        "count": len(recs),
    }


__all__ = ["recommend"]
