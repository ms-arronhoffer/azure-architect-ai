import html
import json
import os
import re

_AZURE_XML_PATH = os.path.join(os.path.dirname(__file__), "..", "icons", "azure.xml")

_FALLBACK_STYLE = (
    "rounded=1;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;"
    "fontColor=#000000;align=center;"
)

# Maps logical shape names used in diagram_service to normalized azure.xml title keys.
_OVERRIDES: dict[str, str] = {
    "virtual_network": "virtual_networks",
    "subnet": "subnets",
    "app_service": "app_services",
    "function_app": "function_apps",
    "sql_database": "azure_sql",
    "cosmos_db": "azure_cosmos_db",
    "redis_cache": "cache_redis",
    "storage_account": "storage_accounts",
    "key_vault": "key_vaults",
    "api_management": "api_management_services",
    "application_gateway": "application_gateways",
    "load_balancer": "load_balancers",
    "firewall": "firewalls",
    "container_registry": "container_registries",
    "aks": "kubernetes_services",
    "kubernetes_service": "kubernetes_services",
    "service_bus": "azure_service_bus",
    "event_hub": "event_hubs",
    "monitor": "monitor",
    "log_analytics": "log_analytics_workspaces",
    "app_insights": "application_insights",
    "application_insights": "application_insights",
    "openai": "azure_openai",
    "azure_openai": "azure_openai",
    "cognitive_services": "cognitive_services",
    "ai_search": "cognitive_search",
    "search": "cognitive_search",
    "dns": "dns_zones",
    "vpn_gateway": "virtual_network_gateways",
    "expressroute": "expressroute_circuits",
    "bastion": "bastions",
    "virtual_machine": "virtual_machine",
    "vm": "virtual_machine",
    "container_apps": "container_apps_environments",
    "entra": "entra_id_protection",
    "purview": "azure_purview_accounts",
    "synapse": "azure_synapse_analytics",
    "front_door": "front_door_and_cdn_profiles",
    "defender": "microsoft_defender_for_cloud",
    "machine_learning": "machine_learning",
    "ml": "machine_learning",
}


def _normalize(title: str) -> str:
    t = re.sub(r"^\d+-icon-service-", "", title)
    return t.lower().replace("-", "_").replace(" ", "_")


def _load_icon_styles() -> dict[str, str]:
    styles: dict[str, str] = {}
    try:
        with open(_AZURE_XML_PATH, encoding="utf-8") as f:
            raw = f.read()
        # Strip <mxlibrary>...</mxlibrary> wrapper
        inner = re.sub(r"^<mxlibrary>|</mxlibrary>\s*$", "", raw.strip())
        entries = json.loads(inner)
        for entry in entries:
            title = entry.get("title", "")
            xml_encoded = entry.get("xml", "")
            if not title or not xml_encoded:
                continue
            xml_decoded = html.unescape(xml_encoded)
            m = re.search(r'style="([^"]+)"', xml_decoded)
            if not m:
                continue
            style = m.group(1) + ";align=center;"
            key = _normalize(title)
            styles[key] = style
    except Exception:
        pass
    return styles


_ICON_STYLES: dict[str, str] = _load_icon_styles()


def get_icon_style(logical_name: str) -> str:
    name = logical_name.lower().replace("-", "_").replace(" ", "_")

    # 1. Override map
    if name in _OVERRIDES:
        key = _OVERRIDES[name]
        if key in _ICON_STYLES:
            return _ICON_STYLES[key]

    # 2. Exact normalized key match
    if name in _ICON_STYLES:
        return _ICON_STYLES[name]

    # 3. Substring match — name appears in key or key appears in name
    for key, style in _ICON_STYLES.items():
        if name in key or key in name:
            return style

    # 4. Word-level fuzzy — any word in name matches any word in key
    words = set(name.split("_"))
    for key, style in _ICON_STYLES.items():
        if words & set(key.split("_")):
            return style

    return _FALLBACK_STYLE
