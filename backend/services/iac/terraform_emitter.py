"""Terraform HCL emitter for IacModule.

Generates `main.tf` + `variables.tf` content. Uses the official `azurerm`
provider with conservative defaults. v1 scope: scaffolding correct enough for
`terraform init && terraform validate` against the reference archs; real-world
deployments still need workload-specific tuning.
"""
from __future__ import annotations

from services.iac.ir import IacModule, IacResource

# azure_type → azurerm resource name
_AZURERM_MAP: dict[str, str] = {
    "Microsoft.Web/sites": "azurerm_linux_web_app",
    "Microsoft.Network/applicationGateways": "azurerm_application_gateway",
    "Microsoft.Sql/servers/databases": "azurerm_mssql_database",
    "Microsoft.Cache/redis": "azurerm_redis_cache",
    "Microsoft.KeyVault/vaults": "azurerm_key_vault",
    "Microsoft.OperationalInsights/workspaces": "azurerm_log_analytics_workspace",
    "Microsoft.ContainerService/managedClusters": "azurerm_kubernetes_cluster",
    "Microsoft.ContainerRegistry/registries": "azurerm_container_registry",
    "Microsoft.ServiceBus/namespaces": "azurerm_servicebus_namespace",
    "Microsoft.Insights/components": "azurerm_application_insights",
    "Microsoft.Network/virtualNetworks": "azurerm_virtual_network",
    "Microsoft.Network/azureFirewalls": "azurerm_firewall",
    "Microsoft.Network/expressRouteCircuits": "azurerm_express_route_circuit",
    "Microsoft.Network/virtualNetworkGateways": "azurerm_virtual_network_gateway",
    "Microsoft.Network/bastionHosts": "azurerm_bastion_host",
    "Microsoft.Network/ddosProtectionPlans": "azurerm_network_ddos_protection_plan",
    "Microsoft.Network/networkWatchers": "azurerm_network_watcher",
    "Microsoft.DocumentDB/databaseAccounts": "azurerm_cosmosdb_account",
    "Microsoft.Storage/storageAccounts": "azurerm_storage_account",
    "Microsoft.EventHub/namespaces": "azurerm_eventhub_namespace",
    "Microsoft.EventGrid/topics": "azurerm_eventgrid_topic",
    "Microsoft.App/containerApps": "azurerm_container_app",
}


def _hcl_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _resource_block(res: IacResource) -> str:
    tf_type = _AZURERM_MAP.get(res.azure_type)
    if tf_type is None:
        return (
            f"# TODO: unmapped Azure type {res.azure_type} for {res.logical_name}\n"
        )
    lines = [f'resource "{tf_type}" "{res.logical_name}" {{']
    lines.append('  name                = "${var.name_prefix}-' + res.logical_name + '-${var.environment}"')
    lines.append("  location            = azurerm_resource_group.main.location")
    lines.append("  resource_group_name = azurerm_resource_group.main.name")
    if res.sku and tf_type in {"azurerm_redis_cache", "azurerm_storage_account"}:
        # Many azurerm resources use different SKU attribute names; emit a hint.
        lines.append(f'  # sku = "{res.sku}"  # adjust per resource schema')
    lines.append("}")
    return "\n".join(lines) + "\n"


def emit_terraform(module: IacModule) -> dict[str, str]:
    """Return {filename: contents} for a Terraform module."""
    variables_tf = [
        'terraform {',
        '  required_providers {',
        '    azurerm = { source = "hashicorp/azurerm", version = "~> 3.100" }',
        '  }',
        '}',
        '',
        'provider "azurerm" { features {} }',
        '',
    ]
    for p in module.parameters:
        default = _hcl_string(str(p.default)) if p.default is not None else "null"
        tf_type = {"string": "string", "int": "number", "bool": "bool"}[p.type]
        variables_tf.append(f'variable "{p.name}" {{')
        variables_tf.append(f"  type    = {tf_type}")
        variables_tf.append(f"  default = {default}")
        if p.description:
            variables_tf.append(f"  description = {_hcl_string(p.description)}")
        variables_tf.append("}\n")

    main_tf = [
        f"# Generated from reference architecture: {module.description}",
        "",
        'resource "azurerm_resource_group" "main" {',
        '  name     = "${var.name_prefix}-${var.environment}-rg"',
        "  location = var.location",
        "}",
        "",
    ]
    for res in module.resources:
        main_tf.append(_resource_block(res))

    return {
        "main.tf": "\n".join(main_tf),
        "variables.tf": "\n".join(variables_tf),
    }


__all__ = ["emit_terraform"]
