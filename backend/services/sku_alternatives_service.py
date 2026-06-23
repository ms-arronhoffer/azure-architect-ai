"""Cheaper-equivalent SKU suggestions.

Given a baseline Azure line item (service + SKU + region), this module consults
the grounded equivalence map ``knowledge/pricing/sku_alternatives.yaml``, derives
functionally-comparable candidate SKUs (e.g. Intel ``D8s_v5`` -> AMD ``D8as_v5``),
prices each through the live Retail API via ``pricing_service.estimate_line_item``,
and returns the priced alternatives ranked cheapest-first with the delta versus
the baseline.

Design notes mirror ``region_availability_service``:
  * It never raises — a candidate that fails to price is simply dropped.
  * It reuses ``pricing_service`` (and therefore its 6h cache).
  * It only suggests SKUs derived from the grounded map, so the model cannot
    invent an alternative that does not exist.
"""
from __future__ import annotations

import functools
import re
from pathlib import Path
from typing import Any

import yaml

from middleware.logging import get_logger
from services import pricing_service

log = get_logger("sku_alternatives_service")

_MAP_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "pricing" / "sku_alternatives.yaml"


@functools.lru_cache(maxsize=1)
def _rules() -> list[dict[str, Any]]:
    """Load and cache the equivalence rules. Returns [] when the file is absent."""
    try:
        with _MAP_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except FileNotFoundError:
        log.warning("sku_alternatives.file_missing", path=str(_MAP_PATH))
        return []
    except yaml.YAMLError as exc:
        log.error("sku_alternatives.parse_failed", error=str(exc))
        return []
    rules = data.get("rules") if isinstance(data, dict) else None
    return list(rules) if isinstance(rules, list) else []


def _candidate_skus(service: str, sku: str) -> list[dict[str, Any]]:
    """Apply every matching rule to the baseline SKU and return unique candidates.

    Each candidate carries the SKU plus the rule's rationale/tradeoff metadata.
    Candidates identical to the baseline (case-insensitive) are dropped.
    """
    if not sku:
        return []
    service_lc = (service or "").lower()
    sku_norm = sku.strip()
    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for rule in _rules():
        rule_service = str(rule.get("service", "")).lower()
        if rule_service and rule_service not in service_lc:
            continue
        pattern = rule.get("pattern")
        replacement = rule.get("replacement")
        if not pattern or replacement is None:
            continue
        try:
            new_sku, n = re.subn(pattern, replacement, sku_norm)
        except re.error as exc:
            log.warning("sku_alternatives.bad_pattern", rule=rule.get("id"), error=str(exc))
            continue
        if n == 0:
            continue
        key = new_sku.strip().lower()
        if key == sku_norm.lower() or key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "sku": new_sku,
                "rule_id": rule.get("id"),
                "rationale": rule.get("rationale", ""),
                "tradeoff": rule.get("tradeoff", ""),
                "est_savings_pct": rule.get("est_savings_pct"),
            }
        )
    return candidates


async def suggest(
    service: str,
    sku: str,
    region: str = "eastus",
    quantity: float = 1,
    hours_per_month: float = 730.0,
) -> dict[str, Any]:
    """Price the baseline and every grounded alternative, ranked cheapest-first.

    Returns an envelope with the priced ``baseline`` and a list of
    ``alternatives`` (each: sku, monthly_estimate, delta_vs_baseline,
    savings_pct, cheaper, rationale, tradeoff). Alternatives that cannot be
    priced in the requested region are dropped, so an unknown/uncovered SKU
    yields an empty list rather than a fabricated suggestion.
    """
    baseline = await pricing_service.estimate_line_item(
        service=service,
        sku=sku,
        quantity=quantity,
        hours_per_month=hours_per_month,
        region=region,
    )
    baseline_monthly = baseline.get("monthly_estimate")

    alternatives: list[dict[str, Any]] = []
    for cand in _candidate_skus(service, sku):
        priced = await pricing_service.estimate_line_item(
            service=service,
            sku=cand["sku"],
            quantity=quantity,
            hours_per_month=hours_per_month,
            region=region,
        )
        monthly = priced.get("monthly_estimate")
        if monthly is None:
            continue  # unavailable in this region — never fabricate
        if priced.get("sku_swapped"):
            # estimate_line_item could not find the exact equivalent and fell
            # back to an unrelated SKU — drop it rather than mislead.
            continue
        delta = None
        savings_pct = None
        cheaper = False
        if baseline_monthly:
            delta = round(monthly - baseline_monthly, 2)
            cheaper = monthly < baseline_monthly
            savings_pct = round((baseline_monthly - monthly) / baseline_monthly * 100, 1)
        alternatives.append(
            {
                "sku": priced.get("sku", cand["sku"]),
                "requested_sku": cand["sku"],
                "region": region,
                "monthly_estimate": monthly,
                "unit_price": priced.get("unit_price"),
                "delta_vs_baseline": delta,
                "savings_pct": savings_pct,
                "cheaper": cheaper,
                "rule_id": cand["rule_id"],
                "rationale": cand["rationale"],
                "tradeoff": cand["tradeoff"],
                "est_savings_pct": cand["est_savings_pct"],
            }
        )

    alternatives.sort(key=lambda a: (a["monthly_estimate"] if a["monthly_estimate"] is not None else float("inf")))

    cheaper_count = sum(1 for a in alternatives if a.get("cheaper"))
    return {
        "service": service,
        "baseline": {
            "sku": baseline.get("sku", sku),
            "requested_sku": sku,
            "region": region,
            "monthly_estimate": baseline_monthly,
            "unit_price": baseline.get("unit_price"),
        },
        "alternatives": alternatives,
        "alternative_count": len(alternatives),
        "cheaper_count": cheaper_count,
        "currency": baseline.get("currency", "USD"),
        "source": pricing_service.PRICING_DATA_SOURCE,
    }


__all__ = ["suggest"]
