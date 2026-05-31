"""Shared internal representation for IaC generation.

The Bicep emitter is currently LLM-prompt-driven (no Jinja templates). To add
Terraform and ARM without diverging, we crystallize a minimal IR that all three
emitters consume. v1 only covers the 15 reference archs, mapped service-by-service.

Service names use the same labels found in `data.reference_archs.REFERENCE_ARCHS`
so the IR can be derived directly from a reference arch entry.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class IacResource:
    """One concrete Azure resource. Properties stay as a flat dict so each
    emitter can map them to its own type system.
    """

    logical_name: str
    azure_type: str  # e.g. "Microsoft.Web/sites"
    sku: str | None = None
    location_ref: str = "location"  # parameter name
    properties: dict = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)


@dataclass
class IacParameter:
    name: str
    type: Literal["string", "int", "bool"] = "string"
    default: str | int | bool | None = None
    description: str = ""


@dataclass
class IacModule:
    name: str
    description: str
    parameters: list[IacParameter] = field(default_factory=list)
    resources: list[IacResource] = field(default_factory=list)
    outputs: dict[str, str] = field(default_factory=dict)


# Service label → (azure_type, default sku) mapping used to materialize an IR
# from a reference_archs.py entry. Conservative defaults; tune per workload.
SERVICE_CATALOG: dict[str, tuple[str, str | None]] = {
    "App Service": ("Microsoft.Web/sites", "P1v3"),
    "Application Gateway": ("Microsoft.Network/applicationGateways", "WAF_v2"),
    "Azure SQL Database": ("Microsoft.Sql/servers/databases", "GP_S_Gen5_2"),
    "Azure Cache for Redis": ("Microsoft.Cache/redis", "Standard"),
    "Key Vault": ("Microsoft.KeyVault/vaults", "standard"),
    "Log Analytics": ("Microsoft.OperationalInsights/workspaces", "PerGB2018"),
    "AKS": ("Microsoft.ContainerService/managedClusters", None),
    "Azure Container Registry": ("Microsoft.ContainerRegistry/registries", "Premium"),
    "Service Bus": ("Microsoft.ServiceBus/namespaces", "Standard"),
    "Application Insights": ("Microsoft.Insights/components", None),
    "Azure Monitor": ("Microsoft.Insights/components", None),
    "Virtual Network": ("Microsoft.Network/virtualNetworks", None),
    "Azure Firewall": ("Microsoft.Network/azureFirewalls", "Premium"),
    "ExpressRoute": ("Microsoft.Network/expressRouteCircuits", "Premium_MeteredData"),
    "VPN Gateway": ("Microsoft.Network/virtualNetworkGateways", "VpnGw2"),
    "Azure Bastion": ("Microsoft.Network/bastionHosts", "Standard"),
    "DDoS Protection": ("Microsoft.Network/ddosProtectionPlans", None),
    "Network Watcher": ("Microsoft.Network/networkWatchers", None),
    "Cosmos DB": ("Microsoft.DocumentDB/databaseAccounts", None),
    "Storage Account": ("Microsoft.Storage/storageAccounts", "Standard_LRS"),
    "Event Hub": ("Microsoft.EventHub/namespaces", "Standard"),
    "Event Grid": ("Microsoft.EventGrid/topics", None),
    "Functions": ("Microsoft.Web/sites", "Y1"),
    "Container Apps": ("Microsoft.App/containerApps", None),
}


def _logical(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


def module_from_reference_arch(arch: dict) -> IacModule:
    """Build a generic IR from a reference architecture entry."""
    module = IacModule(
        name=arch["id"].replace("-", "_"),
        description=arch.get("description", arch.get("title", "")),
        parameters=[
            IacParameter("location", "string", "eastus2", "Azure region"),
            IacParameter("namePrefix", "string", "aa", "Resource name prefix"),
            IacParameter("environment", "string", "dev", "Deployment environment"),
        ],
    )
    for svc in arch.get("services", []):
        entry = SERVICE_CATALOG.get(svc)
        if entry is None:
            continue
        azure_type, sku = entry
        module.resources.append(
            IacResource(
                logical_name=_logical(svc),
                azure_type=azure_type,
                sku=sku,
                properties={"service_label": svc},
            )
        )
    return module


__all__ = [
    "IacModule",
    "IacParameter",
    "IacResource",
    "SERVICE_CATALOG",
    "module_from_reference_arch",
]
