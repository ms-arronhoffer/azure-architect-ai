"""Reservation & savings-plan recommendation engine.

Wraps Azure Consumption ``reservationRecommendations`` plus a simple
break-even calculator. The Consumption API already publishes RI / SP
recommendations sized against the subscription's actual usage, so we
expose those rather than reinventing the math — then layer a
``break_even_months`` and ``recommended_action`` field that an architect
can paste straight into a customer deck.

SDK methods are synchronous; route handlers should call via
``asyncio.to_thread`` to keep the event loop free.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from azure.identity import DefaultAzureCredential
from azure.mgmt.consumption import ConsumptionManagementClient

from config import settings
from middleware.logging import get_logger

log = get_logger("reservations_service")

_credential: DefaultAzureCredential | None = None
_client: ConsumptionManagementClient | None = None


def _get_client(subscription_id: str) -> ConsumptionManagementClient:
    global _credential, _client
    if _client is None:
        _credential = DefaultAzureCredential()
    # ConsumptionManagementClient is per-subscription; cheap to rebuild but
    # keep a single instance when the subscription is stable.
    if _client is None or getattr(_client, "_subscription_id", None) != subscription_id:
        _client = ConsumptionManagementClient(_credential, subscription_id=subscription_id)
        _client._subscription_id = subscription_id  # type: ignore[attr-defined]
    return _client


def _resolve_subscription(subscription_id: str | None) -> str:
    sub = subscription_id or settings.azure_subscription_id
    if not sub:
        raise ValueError("subscription_id not provided and AZURE_SUBSCRIPTION_ID not configured")
    return sub


def _break_even_months(upfront_cost: float, monthly_savings: float) -> float | None:
    if not upfront_cost or not monthly_savings or monthly_savings <= 0:
        return None
    return round(upfront_cost / monthly_savings, 1)


def recommend_reservations(
    subscription_id: str | None = None,
    scope: str = "Single",
    lookback_days: int = 30,
) -> dict[str, Any]:
    """Pull live RI / SP recommendations for ``subscription_id``.

    ``scope`` is ``"Single"`` (one subscription) or ``"Shared"`` (billing
    account). ``lookback_days`` ∈ {7, 30, 60}; the API only accepts those
    three. Returns a list with one entry per resource type with payback
    months and a one-line recommended action.
    """
    sub = _resolve_subscription(subscription_id)
    if lookback_days not in (7, 30, 60):
        lookback_days = 30
    look = f"Last{lookback_days}Days"
    scope_path = f"/subscriptions/{sub}"
    client = _get_client(sub)

    out: list[dict[str, Any]] = []
    try:
        # filter syntax: properties/scope eq 'Single' and properties/lookBackPeriod eq 'Last30Days'
        odata = f"properties/scope eq '{scope}' and properties/lookBackPeriod eq '{look}'"
        page = client.reservation_recommendations.list(scope=scope_path, filter=odata)
        for rec in page:
            props = getattr(rec, "properties", None) or rec
            payg = float(getattr(props, "cost_with_no_reserved_instances", 0) or 0)
            ri = float(getattr(props, "total_cost_with_reserved_instances", 0) or 0)
            savings = float(getattr(props, "net_savings", payg - ri) or 0)
            qty = int(getattr(props, "recommended_quantity", 0) or 0)
            term = getattr(props, "term", "P1Y") or "P1Y"
            sku = getattr(props, "sku_name", None) or getattr(rec, "sku", "")
            region = getattr(props, "location", None) or ""
            first_cost = float(getattr(props, "first_usage_date", 0) or 0)  # rarely populated
            monthly_savings = savings / 12 if term == "P1Y" else savings / 36
            upfront = float(getattr(props, "total_cost_with_reserved_instances", 0) or 0)
            payback = _break_even_months(upfront, monthly_savings)
            action = (
                f"Reserve {qty}× {sku} ({term}) — saves ~${monthly_savings:,.0f}/mo, "
                f"payback ~{payback or '—'} mo"
                if qty and savings > 0
                else "No commit recommended at current usage"
            )
            out.append({
                "resource_type": getattr(rec, "resource_type", None) or getattr(props, "resource_type", ""),
                "sku": sku,
                "region": region,
                "term": term,
                "recommended_quantity": qty,
                "scope": scope,
                "lookback_days": lookback_days,
                "payg_cost": round(payg, 2),
                "ri_cost": round(ri, 2),
                "net_savings": round(savings, 2),
                "monthly_savings": round(monthly_savings, 2),
                "break_even_months": payback,
                "recommended_action": action,
            })
    except Exception as exc:
        log.warning("reservations.list_failed", error=str(exc), subscription=sub)
        return {
            "subscription_id": sub,
            "scope": scope,
            "lookback_days": lookback_days,
            "recommendations": [],
            "error": str(exc),
        }

    out.sort(key=lambda r: r.get("monthly_savings") or 0, reverse=True)
    return {
        "subscription_id": sub,
        "scope": scope,
        "lookback_days": lookback_days,
        "recommendations": out,
        "queried_at": dt.datetime.now(dt.UTC).isoformat(),
    }


def break_even(
    payg_monthly: float,
    reserved_monthly: float,
    upfront_cost: float = 0.0,
    term_years: int = 1,
) -> dict[str, Any]:
    """Pure-math comparator for "should we reserve?" questions when the
    architect already has the two prices in hand (e.g. from the pricing
    calculator or a PAYG card). No Azure auth required.
    """
    monthly_savings = payg_monthly - reserved_monthly
    payback = _break_even_months(upfront_cost, monthly_savings) if upfront_cost else 0.0
    term_months = term_years * 12
    total_savings = monthly_savings * term_months - upfront_cost
    return {
        "payg_monthly": round(payg_monthly, 2),
        "reserved_monthly": round(reserved_monthly, 2),
        "monthly_savings": round(monthly_savings, 2),
        "upfront_cost": round(upfront_cost, 2),
        "term_years": term_years,
        "break_even_months": payback,
        "total_term_savings": round(total_savings, 2),
        "recommendation": (
            "Reserve" if monthly_savings > 0 and (payback is None or payback < term_months * 0.6)
            else "Stay PAYG"
        ),
    }


# Typical Azure 1-year RI / SP savings vs PAYG by resource class. Conservative
# midpoint estimates from Microsoft's published reservation discounts (compute
# 1Y ≈ 35-40%, SQL 1Y ≈ 33%, Cosmos 1Y ≈ 20%). Used as a heuristic when the
# engagement declares an existing commitment but we don't have the line-item
# RI price from Cost Management.
_RI_DISCOUNT_BY_FAMILY: dict[str, float] = {
    "vm": 0.38,
    "compute": 0.38,
    "aks": 0.38,
    "appservice": 0.30,
    "sql": 0.33,
    "cosmos": 0.20,
    "synapse": 0.30,
    "redis": 0.30,
    "default": 0.30,
}


def _family_for_sku(service: str, sku: str) -> str:
    s = (service or "").lower()
    k = (sku or "").lower()
    if "virtual machine" in s or "vm" in s or k.startswith("standard_"):
        return "vm"
    if "aks" in s or "kubernetes" in s:
        return "aks"
    if "app service" in s or "appservice" in s:
        return "appservice"
    if "sql" in s:
        return "sql"
    if "cosmos" in s:
        return "cosmos"
    if "synapse" in s:
        return "synapse"
    if "redis" in s:
        return "redis"
    return "default"


def _commit_matches_line(commit_key: str, service: str, sku: str) -> bool:
    """Loose match: commit key is treated as a substring against service+sku."""
    needle = (commit_key or "").lower().strip()
    if not needle:
        return False
    hay = f"{(service or '').lower()} {(sku or '').lower()}"
    return needle in hay


def apply_reservation_discounts(
    estimate: dict[str, Any],
    commitments: dict[str, Any] | None,
) -> dict[str, Any]:
    """Adjust an `estimate_architecture` payload in place for engagement RIs.

    `commitments` is the engagement's declared inventory of reserved
    instances / savings plans (e.g. ``{"Standard_D8s_v5": 10,
    "SQL_GeneralPurpose": 4}``). When a line item matches a commit key we
    cap the discountable quantity at the commit and apply a family-typical
    1Y RI discount. We do NOT touch lines without a matching commit — the
    user explicitly opted in by declaring them on the Engagement record.
    """
    if not commitments or not estimate.get("line_items"):
        return estimate
    adjustments: list[dict[str, Any]] = []
    new_total = 0.0
    for item in estimate["line_items"]:
        monthly = item.get("monthly_estimate") or 0
        qty = int(item.get("quantity") or 1)
        svc = item.get("service") or ""
        sku = item.get("sku") or ""
        match_key = next(
            (k for k in commitments if _commit_matches_line(k, svc, sku)),
            None,
        )
        if match_key and monthly > 0 and qty > 0:
            commit_qty = int(commitments.get(match_key) or 0)
            covered = min(qty, max(commit_qty, 0))
            if covered > 0:
                per_unit = monthly / qty
                discount_rate = _RI_DISCOUNT_BY_FAMILY.get(
                    _family_for_sku(svc, sku),
                    _RI_DISCOUNT_BY_FAMILY["default"],
                )
                covered_savings = per_unit * covered * discount_rate
                new_monthly = round(monthly - covered_savings, 2)
                item["original_monthly_estimate"] = round(monthly, 2)
                item["monthly_estimate"] = new_monthly
                item["reservation_applied"] = {
                    "commit_key": match_key,
                    "covered_quantity": covered,
                    "discount_rate": discount_rate,
                    "monthly_savings": round(covered_savings, 2),
                }
                adjustments.append({
                    "service": svc,
                    "sku": sku,
                    "commit_key": match_key,
                    "covered_quantity": covered,
                    "monthly_savings": round(covered_savings, 2),
                })
                monthly = new_monthly
        new_total += monthly
    if adjustments:
        estimate["total_monthly_estimate"] = round(new_total, 2)
        estimate["reservation_adjustments"] = adjustments
        estimate["reservation_monthly_savings"] = round(
            sum(a["monthly_savings"] for a in adjustments), 2
        )
    return estimate


__all__ = ["apply_reservation_discounts", "break_even", "recommend_reservations"]
