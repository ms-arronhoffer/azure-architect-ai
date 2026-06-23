"""Normalized component model + service resolution for architecture pricing.

This is the shared vocabulary the architecture-pricing pipeline speaks: every
input path (draw.io XML, our own diagram JSON, a vision pass over an image, or a
free-text description) is reduced to a list of :class:`Component` rows, and then
priced identically downstream.

Responsibilities:
  * ``resolve_service`` — map a logical shape / label / draw.io style token to a
    canonical Azure Retail Pricing ``serviceName`` so it can be priced even when
    it is not in the hand-tuned meter catalog.
  * ``classify`` — decide whether a component is ``priceable``, ``not_billable``
    (logical container / free control-plane / license-only, with a reason), or
    ``unknown`` (recognised as Azure but no resolvable retail service).
  * ``apply_defaults`` — fill missing quantities from
    ``knowledge/pricing/default_profiles.yaml`` and record each filled value as
    an explicit, human-readable assumption.

Nothing here performs network I/O; pricing lives in ``meter_pricing_service``.
"""
from __future__ import annotations

import functools
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from middleware.logging import get_logger
from services import cost_catalog
from services.pricing_service import SERVICE_NAME_MAP

log = get_logger("component_model")

_PROFILES_PATH = (
    Path(__file__).resolve().parent.parent
    / "knowledge"
    / "pricing"
    / "default_profiles.yaml"
)

# Logical shape names (diagram_service) and common draw.io Azure shape tokens →
# canonical Azure Retail Pricing serviceName. Keys are matched after
# normalisation (lower-case, spaces/hyphens → underscores). Services that have
# no metered retail price are intentionally absent and handled by ``classify``.
SHAPE_TO_SERVICE: dict[str, str] = {
    "virtual_machine": "Virtual Machines",
    "vm": "Virtual Machines",
    "virtual_machines": "Virtual Machines",
    "vmss": "Virtual Machines",
    "virtual_machine_scale_set": "Virtual Machines",
    "app_service": "Azure App Service",
    "app_services": "Azure App Service",
    "web_app": "Azure App Service",
    "app_service_plan": "Azure App Service",
    "function_app": "Azure Functions",
    "function_apps": "Azure Functions",
    "functions": "Azure Functions",
    "aks": "Azure Kubernetes Service",
    "kubernetes_service": "Azure Kubernetes Service",
    "kubernetes_services": "Azure Kubernetes Service",
    "container_apps": "Azure Container Apps",
    "container_apps_environments": "Azure Container Apps",
    "container_instances": "Container Instances",
    "container_registry": "Container Registry",
    "container_registries": "Container Registry",
    "redis_cache": "Azure Cache for Redis",
    "cache_redis": "Azure Cache for Redis",
    "redis": "Azure Cache for Redis",
    "sql_database": "SQL Database",
    "azure_sql": "SQL Database",
    "sql_managed_instance": "SQL Managed Instance",
    "cosmos_db": "Azure Cosmos DB",
    "azure_cosmos_db": "Azure Cosmos DB",
    "storage_account": "Storage",
    "storage_accounts": "Storage",
    "blob_storage": "Storage",
    "key_vault": "Key Vault",
    "key_vaults": "Key Vault",
    "api_management": "API Management",
    "api_management_services": "API Management",
    "application_gateway": "Application Gateway",
    "application_gateways": "Application Gateway",
    "front_door": "Azure Front Door",
    "front_door_and_cdn_profiles": "Azure Front Door",
    "load_balancer": "Load Balancer",
    "load_balancers": "Load Balancer",
    "firewall": "Azure Firewall",
    "firewalls": "Azure Firewall",
    "nat_gateway": "NAT Gateway",
    "public_ip": "Virtual Network",
    "vpn_gateway": "VPN Gateway",
    "virtual_network_gateways": "VPN Gateway",
    "expressroute": "ExpressRoute",
    "expressroute_circuits": "ExpressRoute",
    "service_bus": "Service Bus",
    "azure_service_bus": "Service Bus",
    "event_hub": "Event Hubs",
    "event_hubs": "Event Hubs",
    "event_grid": "Event Grid",
    "log_analytics": "Log Analytics",
    "log_analytics_workspaces": "Log Analytics",
    "app_insights": "Azure Monitor",
    "application_insights": "Azure Monitor",
    "monitor": "Azure Monitor",
    "openai": "Azure OpenAI",
    "azure_openai": "Azure OpenAI",
    "cognitive_services": "Cognitive Services",
    "ai_search": "Azure Cognitive Search",
    "cognitive_search": "Azure Cognitive Search",
    "search": "Azure Cognitive Search",
    "synapse": "Azure Synapse Analytics",
    "azure_synapse_analytics": "Azure Synapse Analytics",
    "data_factory": "Azure Data Factory v2",
    "databricks": "Azure Databricks",
    "machine_learning": "Machine Learning",
    "ml": "Machine Learning",
    "bandwidth": "Bandwidth",
    "egress": "Bandwidth",
}


@dataclass
class Component:
    """One normalized node extracted from any input source."""

    label: str
    service: str | None = None          # canonical Azure Retail serviceName
    shape: str = ""                     # logical shape / draw.io token
    sku: str = ""
    region: str = ""
    quantity: float = 1.0
    hours_per_month: float | None = None
    dimensions: dict[str, Any] = field(default_factory=dict)
    group: str = ""
    tier: int | None = None
    source: str = ""                    # xml | json | vision | text | implied
    classification: str = "unknown"     # priceable | not_billable | unknown
    reason: str = ""                    # why not_billable / unknown
    assumptions: list[str] = field(default_factory=list)
    node_id: str = ""

    def to_line_item(self) -> dict[str, Any]:
        """Project to the line-item shape ``meter_pricing_service`` consumes."""
        item: dict[str, Any] = {
            "service": self.service or self.shape or self.label,
            "display_name": self.label,
            "sku": self.sku,
            "region": self.region,
            "quantity": self.quantity,
            "dimensions": dict(self.dimensions),
        }
        if self.hours_per_month is not None:
            item["hours_per_month"] = self.hours_per_month
        return item


@functools.lru_cache(maxsize=1)
def _profiles_raw() -> dict[str, Any]:
    try:
        with _PROFILES_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except FileNotFoundError:
        log.warning("component_model.profiles_missing", path=str(_PROFILES_PATH))
        return {}
    except yaml.YAMLError as exc:
        log.error("component_model.profiles_parse_failed", error=str(exc))
        return {}
    return data if isinstance(data, dict) else {}


def profiles() -> dict[str, dict[str, Any]]:
    return dict(_profiles_raw().get("profiles", {}) or {})


def implied_rules() -> list[dict[str, Any]]:
    return list(_profiles_raw().get("implied", []) or [])


@functools.lru_cache(maxsize=1)
def _not_billable_rules() -> list[tuple[set[str], str]]:
    rules: list[tuple[set[str], str]] = []
    for rule in _profiles_raw().get("not_billable", []) or []:
        terms = {str(t).strip().lower() for t in rule.get("match", []) if t}
        reason = str(rule.get("reason", "Not a billable Azure resource."))
        if terms:
            rules.append((terms, reason))
    return rules


def _normalize(name: str) -> str:
    return name.strip().lower().replace("-", "_").replace(" ", "_")


def _not_billable_reason(*names: str) -> str | None:
    """Return a reason if any of the candidate names is a known free/logical
    resource, else None. Matches whole words or exact rule terms."""
    haystacks = [n.strip().lower() for n in names if n]
    for terms, reason in _not_billable_rules():
        for term in terms:
            for hay in haystacks:
                if hay == term or term == hay:
                    return reason
                # token-boundary contains so "vnet hub" matches "vnet"
                if term in hay.split() or hay in term.split():
                    return reason
                if f" {term} " in f" {hay} ":
                    return reason
    return None


def _resolve_direct(*candidates: str) -> str | None:
    """Direct (non-fuzzy) resolution: catalog alias → shape map → name map."""
    for cand in candidates:
        if not cand:
            continue
        raw = cand.strip().lower()
        norm = _normalize(cand)
        catalog_entry = cost_catalog.resolve_service(raw)
        if catalog_entry:
            return str(catalog_entry.get("service"))
        if norm in SHAPE_TO_SERVICE:
            return SHAPE_TO_SERVICE[norm]
        if raw in SERVICE_NAME_MAP:
            return SERVICE_NAME_MAP[raw]
    return None


def _resolve_fuzzy(*candidates: str) -> str | None:
    """Last-resort token-overlap match across known service names."""
    known: dict[str, str] = {}
    for svc in cost_catalog.all_services():
        known[_normalize(svc.get("service", ""))] = str(svc.get("service"))
    for norm_key, svc in SHAPE_TO_SERVICE.items():
        known[norm_key] = svc
    for cand in candidates:
        if not cand:
            continue
        words = {w for w in _normalize(cand).split("_") if len(w) > 2}
        if not words:
            continue
        for key, svc in known.items():
            if words & {w for w in key.split("_") if len(w) > 2}:
                return svc
    return None


def resolve_service(*candidates: str) -> str | None:
    """Resolve the first candidate that maps to a priceable Azure service.

    Direct resolution (catalog alias → supplemental shape map → pricing
    SERVICE_NAME_MAP) is tried first; token-overlap fuzzy matching is a last
    resort. Returns the canonical Azure Retail ``serviceName`` or ``None``.
    """
    return _resolve_direct(*candidates) or _resolve_fuzzy(*candidates)


def classify(component: Component) -> Component:
    """Set ``service`` / ``classification`` / ``reason`` on a component in place.

    Precedence: a direct service mapping wins (so "Public IP" stays priceable);
    otherwise an explicit not-billable match (logical containers, free
    control-plane, license-only) is honoured before any fuzzy resolution, so
    "VNet"/"subnet" are never mis-priced as a compute service.
    """
    direct = _resolve_direct(component.shape, component.label, component.sku)
    if direct:
        component.service = direct
        component.classification = "priceable"
        component.reason = ""
        return component

    reason = _not_billable_reason(component.label, component.shape)
    if reason:
        component.classification = "not_billable"
        component.reason = reason
        component.service = None
        return component

    fuzzy = _resolve_fuzzy(component.shape, component.label, component.sku)
    if fuzzy:
        component.service = fuzzy
        component.classification = "priceable"
        component.reason = ""
        return component

    component.classification = "unknown"
    component.reason = component.reason or (
        f"Could not map '{component.label or component.shape}' to a priceable "
        "Azure service."
    )
    return component


def apply_defaults(component: Component) -> Component:
    """Fill missing sku/quantity/dimensions from the service's default profile,
    recording each filled value as a human-readable assumption."""
    if component.classification != "priceable" or not component.service:
        return component

    profile = profiles().get(component.service)
    if not profile:
        if component.hours_per_month is None:
            component.hours_per_month = 730.0
        return component

    note = str(profile.get("note", "")).strip()
    assumed: list[str] = []

    if not component.sku and profile.get("sku"):
        component.sku = str(profile["sku"])
        assumed.append(f"SKU {component.sku}")

    prof_qty = profile.get("quantity")
    if (not component.quantity or component.quantity == 1.0) and prof_qty and prof_qty != 1:
        component.quantity = float(prof_qty)
        assumed.append(f"{int(prof_qty)} instance(s)")

    if component.hours_per_month is None:
        component.hours_per_month = float(profile.get("hours_per_month", 730) or 730)

    for key, val in (profile.get("dimensions") or {}).items():
        if key not in component.dimensions:
            component.dimensions[key] = val
            assumed.append(f"{key.replace('_', ' ')}={val}")

    if assumed:
        prefix = note or "Defaulted from typical usage profile."
        component.assumptions.append(f"{prefix} ({', '.join(assumed)})")
    return component


def normalize(component: Component) -> Component:
    """Full per-component normalization: classify then apply defaults."""
    classify(component)
    apply_defaults(component)
    return component


__all__ = [
    "SHAPE_TO_SERVICE",
    "Component",
    "apply_defaults",
    "classify",
    "implied_rules",
    "normalize",
    "profiles",
    "resolve_service",
]
