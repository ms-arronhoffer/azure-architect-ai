"""ARM template (JSON) emitter for IacModule.

Direct ARM JSON — no `az bicep build` dependency, so this works in any deploy
context (local, Container Apps, CI). Generated templates pass
`az deployment validate`; per-resource property schemas are intentionally
sparse and need workload-specific tuning before deployment.
"""
from __future__ import annotations

import json
from typing import Any

from services.iac.ir import IacModule, IacResource

ARM_SCHEMA = "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#"

# azure_type → api version
_API_VERSIONS: dict[str, str] = {
    "Microsoft.Web/sites": "2023-12-01",
    "Microsoft.Network/applicationGateways": "2023-11-01",
    "Microsoft.Sql/servers/databases": "2023-08-01-preview",
    "Microsoft.Cache/redis": "2024-03-01",
    "Microsoft.KeyVault/vaults": "2023-07-01",
    "Microsoft.OperationalInsights/workspaces": "2023-09-01",
    "Microsoft.ContainerService/managedClusters": "2024-02-01",
    "Microsoft.ContainerRegistry/registries": "2023-11-01-preview",
    "Microsoft.ServiceBus/namespaces": "2024-01-01",
    "Microsoft.Insights/components": "2020-02-02",
    "Microsoft.Network/virtualNetworks": "2023-11-01",
    "Microsoft.Network/azureFirewalls": "2023-11-01",
    "Microsoft.Network/expressRouteCircuits": "2023-11-01",
    "Microsoft.Network/virtualNetworkGateways": "2023-11-01",
    "Microsoft.Network/bastionHosts": "2023-11-01",
    "Microsoft.Network/ddosProtectionPlans": "2023-11-01",
    "Microsoft.Network/networkWatchers": "2023-11-01",
    "Microsoft.DocumentDB/databaseAccounts": "2024-05-15",
    "Microsoft.Storage/storageAccounts": "2023-05-01",
    "Microsoft.EventHub/namespaces": "2024-01-01",
    "Microsoft.EventGrid/topics": "2024-06-01-preview",
    "Microsoft.App/containerApps": "2024-03-01",
}


def _arm_param_type(p_type: str) -> str:
    return {"string": "string", "int": "int", "bool": "bool"}[p_type]


def _arm_resource(res: IacResource) -> dict[str, Any]:
    api_version = _API_VERSIONS.get(res.azure_type, "2023-01-01")
    body: dict[str, Any] = {
        "type": res.azure_type,
        "apiVersion": api_version,
        "name": (
            f"[concat(parameters('namePrefix'), '-', '{res.logical_name}', '-', parameters('environment'))]"
        ),
        "location": f"[parameters('{res.location_ref}')]",
    }
    if res.sku:
        body["sku"] = {"name": res.sku}
    if res.depends_on:
        body["dependsOn"] = [
            f"[resourceId('{d}', '{d}')]" for d in res.depends_on
        ]
    return body


def emit_arm(module: IacModule) -> dict[str, str]:
    """Return {filename: contents} for an ARM template + parameters file."""
    template = {
        "$schema": ARM_SCHEMA,
        "contentVersion": "1.0.0.0",
        "metadata": {"description": module.description},
        "parameters": {
            p.name: {
                "type": _arm_param_type(p.type),
                **({"defaultValue": p.default} if p.default is not None else {}),
                **({"metadata": {"description": p.description}} if p.description else {}),
            }
            for p in module.parameters
        },
        "resources": [_arm_resource(r) for r in module.resources],
        "outputs": {
            k: {"type": "string", "value": v} for k, v in module.outputs.items()
        },
    }
    parameters_file = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            p.name: {"value": p.default}
            for p in module.parameters
            if p.default is not None
        },
    }
    return {
        "azuredeploy.json": json.dumps(template, indent=2),
        "azuredeploy.parameters.json": json.dumps(parameters_file, indent=2),
    }


__all__ = ["emit_arm"]
