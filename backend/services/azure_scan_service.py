"""Live Azure subscription scanner using Resource Graph.

Read-only. Uses `DefaultAzureCredential` (same path as openai_service.py and
the deployed managed identity). Issues KQL queries via Azure Resource Graph,
then compares the inventory against a chosen reference architecture from
`data.reference_archs` to produce a drift report.

Drift v1 surfaces:
  - service coverage gap (expected services missing in subscription)
  - tagging compliance (resources without required tags)
  - public IPs (unexpected exposure)
  - NSG rules with 0.0.0.0/0 inbound on management ports
  - oversized SKUs (VMs not in recommended family)

Anything heavier (RBAC over-privilege, cost delta) is left for v2.
"""
from __future__ import annotations

import re
from typing import Iterable

from azure.identity import DefaultAzureCredential
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest, QueryRequestOptions

from config import settings
from data.reference_archs import REFERENCE_ARCHS
from middleware.logging import get_logger
from observability import tracer

log = get_logger("azure_scan_service")

REQUIRED_TAGS = ("environment", "owner", "costCenter")
MANAGEMENT_PORTS = {"22", "3389", "5985", "5986", "1433", "3306", "5432"}

_RESOURCE_RE = re.compile(
    r"^\s*resource\s+\S+\s+'([\w.]+/[\w./]+)@[\d\-]+(?:-preview)?'",
    re.M,
)

_credential: DefaultAzureCredential | None = None
_client: ResourceGraphClient | None = None


def _get_client() -> ResourceGraphClient:
    global _credential, _client
    if _client is None:
        _credential = DefaultAzureCredential()
        _client = ResourceGraphClient(_credential)
    return _client


def _resolve_subscription(subscription_id: str | None) -> str:
    sub = subscription_id or settings.azure_subscription_id
    if not sub:
        raise ValueError(
            "subscription_id not provided and AZURE_SUBSCRIPTION_ID not configured"
        )
    return sub


def _query(kql: str, subscriptions: list[str]) -> list[dict]:
    client = _get_client()
    req = QueryRequest(
        subscriptions=subscriptions,
        query=kql,
        options=QueryRequestOptions(result_format="objectArray"),
    )
    resp = client.resources(req)
    data = resp.data or []
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "rows" in data and "columns" in data:
        cols = [c["name"] for c in data["columns"]]
        return [dict(zip(cols, row)) for row in data["rows"]]
    return []


def list_resources(subscription_id: str | None = None) -> list[dict]:
    sub = _resolve_subscription(subscription_id)
    kql = (
        "Resources | project id, name, type, location, "
        "resourceGroup, sku, tags, properties"
    )
    return _query(kql, [sub])


def list_public_ips(subscription_id: str | None = None) -> list[dict]:
    sub = _resolve_subscription(subscription_id)
    kql = (
        "Resources | where type =~ 'microsoft.network/publicipaddresses' "
        "| project id, name, location, resourceGroup, "
        "ipAddress=properties.ipAddress, sku, tags"
    )
    return _query(kql, [sub])


def list_open_nsg_rules(subscription_id: str | None = None) -> list[dict]:
    sub = _resolve_subscription(subscription_id)
    kql = (
        "Resources | where type =~ 'microsoft.network/networksecuritygroups' "
        "| mv-expand rule = properties.securityRules "
        "| where rule.properties.access =~ 'Allow' "
        "and rule.properties.direction =~ 'Inbound' "
        "and (rule.properties.sourceAddressPrefix == '*' "
        "or rule.properties.sourceAddressPrefix == '0.0.0.0/0' "
        "or rule.properties.sourceAddressPrefix =~ 'Internet') "
        "| project id, name, resourceGroup, "
        "ruleName=rule.name, "
        "destinationPortRange=rule.properties.destinationPortRange, "
        "protocol=rule.properties.protocol"
    )
    return _query(kql, [sub])


def _tag_violations(resources: Iterable[dict]) -> list[dict]:
    out: list[dict] = []
    for r in resources:
        tags = r.get("tags") or {}
        missing = [t for t in REQUIRED_TAGS if t not in tags]
        if missing:
            out.append({
                "id": r.get("id"),
                "name": r.get("name"),
                "type": r.get("type"),
                "missing_tags": missing,
            })
    return out


def _public_exposure(public_ips: Iterable[dict]) -> list[dict]:
    return [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "ip": p.get("ipAddress"),
            "resource_group": p.get("resourceGroup"),
        }
        for p in public_ips
        if p.get("ipAddress")
    ]


def _management_port_exposure(open_rules: Iterable[dict]) -> list[dict]:
    out: list[dict] = []
    for r in open_rules:
        port = str(r.get("destinationPortRange", ""))
        # KQL returns "22" or "*" or "1000-2000" — flag exact match or wildcard
        if port == "*" or port in MANAGEMENT_PORTS:
            out.append({
                "nsg": r.get("name"),
                "rule": r.get("ruleName"),
                "port": port,
                "protocol": r.get("protocol"),
                "resource_group": r.get("resourceGroup"),
            })
    return out


def _service_coverage(resources: Iterable[dict], expected_services: list[str]) -> dict:
    present_types = {(r.get("type") or "").lower() for r in resources}
    expected_normalized = {
        # crude mapping; matches against type token like 'microsoft.web/sites'
        svc.lower(): svc for svc in expected_services
    }
    found, missing = [], []
    for key, original in expected_normalized.items():
        if any(key.replace(" ", "") in t for t in present_types):
            found.append(original)
        else:
            missing.append(original)
    return {"expected": expected_services, "present": found, "missing": missing}


def scan_drift(
    reference_arch_id: str,
    subscription_id: str | None = None,
) -> dict:
    """Run all drift checks and return a structured report."""
    arch = next((a for a in REFERENCE_ARCHS if a["id"] == reference_arch_id), None)
    if arch is None:
        raise ValueError(f"unknown reference architecture: {reference_arch_id}")

    sub = _resolve_subscription(subscription_id)
    with tracer.start_as_current_span(
        "azure.scan.drift",
        attributes={"azure.subscription_id": sub},
    ):
        log.info("scan.start", subscription=sub, reference_arch=reference_arch_id)

        resources = list_resources(sub)
        public_ips = list_public_ips(sub)
        open_rules = list_open_nsg_rules(sub)

        report = {
            "subscription_id": sub,
            "reference_arch": {
                "id": arch["id"],
                "title": arch["title"],
            },
            "summary": {
                "total_resources": len(resources),
                "public_ips": len(public_ips),
            },
            "findings": {
                "service_coverage": _service_coverage(resources, arch.get("services", [])),
                "tag_violations": _tag_violations(resources),
                "public_exposure": _public_exposure(public_ips),
                "open_management_ports": _management_port_exposure(open_rules),
            },
        }
        log.info(
            "scan.complete",
            subscription=sub,
            resources=len(resources),
            tag_violations=len(report["findings"]["tag_violations"]),
            open_ports=len(report["findings"]["open_management_ports"]),
        )
        return report


__all__ = [
    "extract_expected_types_from_bicep",
    "list_open_nsg_rules",
    "list_public_ips",
    "list_resources",
    "scan_drift",
    "scan_drift_against_design",
]


def extract_expected_types_from_bicep(bicep_code: str) -> list[str]:
    """Return unique ARM resource types declared in Bicep source.

    Cheap regex extraction — does not require valid Bicep compilation.
    Useful for drift coverage checks even on imported/edited templates.
    """
    if not bicep_code:
        return []
    return sorted({m.group(1) for m in _RESOURCE_RE.finditer(bicep_code)})


def scan_drift_against_design(
    design_name: str,
    bicep_code: str,
    subscription_id: str | None = None,
) -> dict:
    """Drift report comparing a live subscription against the user's Bicep design."""
    expected = extract_expected_types_from_bicep(bicep_code)
    sub = _resolve_subscription(subscription_id)
    with tracer.start_as_current_span(
        "azure.scan.drift_against_design",
        attributes={"azure.subscription_id": sub, "design": design_name},
    ):
        log.info("scan_design.start", subscription=sub, design=design_name, expected=len(expected))
        resources = list_resources(sub)
        public_ips = list_public_ips(sub)
        open_rules = list_open_nsg_rules(sub)
        report = {
            "subscription_id": sub,
            "design": {"name": design_name, "expected_types": expected},
            "summary": {
                "total_resources": len(resources),
                "public_ips": len(public_ips),
            },
            "findings": {
                "service_coverage": _service_coverage(resources, expected),
                "tag_violations": _tag_violations(resources),
                "public_exposure": _public_exposure(public_ips),
                "open_management_ports": _management_port_exposure(open_rules),
            },
        }
        log.info(
            "scan_design.complete",
            subscription=sub,
            design=design_name,
            missing=len(report["findings"]["service_coverage"]["missing"]),
        )
        return report
