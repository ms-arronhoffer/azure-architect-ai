"""Service billing catalog loader.

Loads ``knowledge/pricing/service_catalog.yaml`` — the meter map that turns the
cost tool from a single-SKU pricer into a meter-aware estimator. Provides
alias→service resolution and a JSON-serialisable view for the frontend.

The catalog is parsed once and cached at import time; it is small (<20 KB) and
read-only at runtime.
"""
from __future__ import annotations

import functools
from pathlib import Path
from typing import Any

import yaml

from middleware.logging import get_logger

log = get_logger("cost_catalog")

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "pricing" / "service_catalog.yaml"


@functools.lru_cache(maxsize=1)
def _load_raw() -> dict[str, Any]:
    try:
        with _CATALOG_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except FileNotFoundError:
        log.warning("cost_catalog.file_missing", path=str(_CATALOG_PATH))
        return {"version": 0, "services": []}
    except yaml.YAMLError as exc:
        log.error("cost_catalog.parse_failed", error=str(exc))
        return {"version": 0, "services": []}
    if not isinstance(data, dict) or not isinstance(data.get("services"), list):
        log.error("cost_catalog.invalid_shape")
        return {"version": 0, "services": []}
    return data


@functools.lru_cache(maxsize=1)
def _alias_index() -> dict[str, dict[str, Any]]:
    """Map every alias / service / label (lower-cased) to its service entry."""
    index: dict[str, dict[str, Any]] = {}
    for svc in _load_raw().get("services", []):
        keys = {svc.get("service", ""), svc.get("label", "")}
        keys.update(svc.get("aliases", []) or [])
        for key in keys:
            if key:
                index[key.strip().lower()] = svc
    return index


def all_services() -> list[dict[str, Any]]:
    """Return the raw list of service catalog entries."""
    return list(_load_raw().get("services", []))


def resolve_service(name: str) -> dict[str, Any] | None:
    """Resolve a free-text service name to its catalog entry, or None."""
    if not name:
        return None
    return _alias_index().get(name.strip().lower())


def currency_default() -> str:
    return str(_load_raw().get("currency_default", "USD"))


def region_default() -> str:
    return str(_load_raw().get("region_default", "eastus"))


def public_catalog() -> dict[str, Any]:
    """A trimmed, JSON-serialisable view for the frontend.

    Exposes each service's user-facing dimensions (key, label, unit, defaults,
    whether they are required) without the internal Retail-API match hints.
    """
    services = []
    for svc in _load_raw().get("services", []):
        dims = []
        for dim in svc.get("dimensions", []) or []:
            dims.append(
                {
                    "key": dim.get("key"),
                    "label": dim.get("label"),
                    "unit": dim.get("unit"),
                    "quantity_field": dim.get("quantity_field"),
                    "default_quantity": dim.get("default_quantity", 0),
                    "included_free": dim.get("included_free", 0),
                    "required": bool(dim.get("required", False)),
                    "instance_scaled": bool(dim.get("instance_scaled", False)),
                }
            )
        services.append(
            {
                "service": svc.get("service"),
                "label": svc.get("label"),
                "aliases": svc.get("aliases", []),
                "category": svc.get("category"),
                "sku_field": svc.get("sku_field"),
                "ri_eligible": bool(svc.get("ri_eligible", False)),
                "dimensions": dims,
            }
        )
    return {
        "version": _load_raw().get("version", 1),
        "currency_default": currency_default(),
        "region_default": region_default(),
        "services": services,
    }


__all__ = [
    "all_services",
    "currency_default",
    "public_catalog",
    "region_default",
    "resolve_service",
]
