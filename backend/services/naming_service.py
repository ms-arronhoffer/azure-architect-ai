"""Azure CAF naming convention validator.

Validates resource names against the Cloud Adoption Framework abbreviation +
environment + region pattern: `<abbr>-<workload>-<env>-<region>[-<suffix>]`.

Resource-specific length and character constraints are checked separately so
the caller can distinguish "wrong shape" from "Azure will reject this name".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Cloud Adoption Framework resource type abbreviations.
# Source: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations
CAF_ABBREVIATIONS: dict[str, str] = {
    "resourceGroup": "rg",
    "virtualNetwork": "vnet",
    "subnet": "snet",
    "networkInterface": "nic",
    "networkSecurityGroup": "nsg",
    "publicIp": "pip",
    "loadBalancer": "lb",
    "applicationGateway": "agw",
    "firewall": "afw",
    "frontDoor": "afd",
    "virtualMachine": "vm",
    "vmScaleSet": "vmss",
    "aksCluster": "aks",
    "containerApp": "ca",
    "containerAppsEnvironment": "cae",
    "containerRegistry": "cr",
    "functionApp": "func",
    "appService": "app",
    "appServicePlan": "asp",
    "staticWebApp": "stapp",
    "logicApp": "logic",
    "storageAccount": "st",
    "sqlServer": "sql",
    "sqlDatabase": "sqldb",
    "cosmosAccount": "cosmos",
    "postgres": "psql",
    "mysql": "mysql",
    "redis": "redis",
    "keyVault": "kv",
    "appConfiguration": "appcs",
    "managedIdentity": "id",
    "logAnalytics": "log",
    "appInsights": "appi",
    "eventHub": "evh",
    "eventGrid": "evgt",
    "serviceBus": "sb",
    "openAi": "oai",
    "aiSearch": "srch",
    "machineLearning": "mlw",
    "dataFactory": "adf",
    "synapse": "syn",
    "databricks": "dbw",
    "apim": "apim",
}

VALID_ENVS = {"dev", "test", "stg", "prod", "sandbox", "shared"}

# Common Azure region short codes (CAF style).
REGION_CODES = {
    "eastus", "eastus2", "westus", "westus2", "westus3",
    "centralus", "northcentralus", "southcentralus", "westcentralus",
    "northeurope", "westeurope", "uksouth", "ukwest",
    "francecentral", "germanywestcentral", "swedencentral", "switzerlandnorth",
    "norwayeast", "polandcentral", "italynorth",
    "eastasia", "southeastasia", "japaneast", "japanwest",
    "australiaeast", "australiasoutheast", "koreacentral", "centralindia",
    "uaenorth", "southafricanorth", "brazilsouth", "canadacentral", "canadaeast",
    "usgovvirginia", "usgovarizona", "chinanorth3", "chinaeast2",
}

# Resource-specific lower/upper bounds + allowed character class.
# Pattern strings are *full-name* constraints, not just the suffix.
@dataclass(frozen=True)
class ResourceRule:
    min_len: int
    max_len: int
    allowed: str  # regex character class body, no anchors
    note: str = ""


RESOURCE_RULES: dict[str, ResourceRule] = {
    "storageAccount": ResourceRule(3, 24, r"a-z0-9", "lowercase letters + digits only, no hyphens"),
    "keyVault": ResourceRule(3, 24, r"a-zA-Z0-9\-", "must start with a letter, alphanumerics + hyphens"),
    "containerRegistry": ResourceRule(5, 50, r"a-zA-Z0-9", "alphanumerics only, no hyphens"),
    "cosmosAccount": ResourceRule(3, 44, r"a-z0-9\-", "lowercase + digits + hyphens"),
    "sqlServer": ResourceRule(1, 63, r"a-z0-9\-", "lowercase + digits + hyphens"),
    "functionApp": ResourceRule(2, 60, r"a-zA-Z0-9\-", "alphanumerics + hyphens"),
    "appService": ResourceRule(2, 60, r"a-zA-Z0-9\-", "alphanumerics + hyphens"),
    "openAi": ResourceRule(2, 64, r"a-zA-Z0-9\-", "alphanumerics + hyphens"),
}

DEFAULT_RULE = ResourceRule(2, 80, r"a-zA-Z0-9\-", "")


@dataclass
class ValidationResult:
    name: str
    resource_type: str
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    suggestion: str | None = None


def suggest_name(
    resource_type: str,
    workload: str,
    env: str = "dev",
    region: str = "eastus2",
    suffix: str | None = None,
) -> str:
    """Build a CAF-conformant name for the given inputs."""
    abbr = CAF_ABBREVIATIONS.get(resource_type, resource_type[:4])
    rule = RESOURCE_RULES.get(resource_type, DEFAULT_RULE)
    parts = [abbr, workload, env, region]
    if suffix:
        parts.append(suffix)
    sep = "" if "-" not in rule.allowed else "-"
    name = sep.join(parts) if sep else "".join(parts)
    # Storage / ACR need lowercase-only, no hyphens.
    if "\\-" not in rule.allowed:
        name = name.replace("-", "").lower()
    if not any(ch.isupper() for ch in rule.allowed):
        name = name.lower()
    return name[: rule.max_len]


def validate_name(name: str, resource_type: str, env: str | None = None) -> ValidationResult:
    rule = RESOURCE_RULES.get(resource_type, DEFAULT_RULE)
    result = ValidationResult(name=name, resource_type=resource_type, valid=True)

    if not (rule.min_len <= len(name) <= rule.max_len):
        result.errors.append(
            f"length {len(name)} outside allowed range {rule.min_len}-{rule.max_len} ({rule.note})"
        )
        result.valid = False

    if not re.fullmatch(rf"[{rule.allowed}]+", name):
        result.errors.append(f"contains characters outside [{rule.allowed}] ({rule.note})")
        result.valid = False

    abbr = CAF_ABBREVIATIONS.get(resource_type)
    if abbr and not (name.startswith(f"{abbr}-") or name.startswith(abbr)):
        result.warnings.append(
            f"does not start with CAF abbreviation '{abbr}' for {resource_type}"
        )

    if env and env not in VALID_ENVS:
        result.warnings.append(f"env '{env}' not in {sorted(VALID_ENVS)}")

    found_env = next((e for e in VALID_ENVS if f"-{e}-" in name or name.endswith(f"-{e}")), None)
    if env and found_env and found_env != env:
        result.warnings.append(f"name encodes env '{found_env}' but caller passed '{env}'")

    found_region = next((r for r in REGION_CODES if r in name), None)
    if not found_region:
        result.warnings.append(
            "no recognized Azure region code found in name (e.g. eastus2, westeurope)"
        )

    if not result.valid:
        result.suggestion = suggest_name(
            resource_type=resource_type,
            workload=_extract_workload(name) or "workload",
            env=env or "dev",
        )

    return result


def _extract_workload(name: str) -> str | None:
    parts = name.replace("_", "-").split("-")
    return parts[1] if len(parts) >= 2 else None


def validate_batch(items: list[dict]) -> list[ValidationResult]:
    """Validate a batch. Each item: {name, resource_type, env?}."""
    return [
        validate_name(i["name"], i["resource_type"], i.get("env"))
        for i in items
    ]
