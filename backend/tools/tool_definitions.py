"""Aggregator. Tool schemas live in tools/domains/*.py."""

from tools.domains.architecture import TOOLS as _architecture_tools
from tools.domains.bicep import TOOLS as _bicep_tools
from tools.domains.codegen import TOOLS as _codegen_tools
from tools.domains.comparison import TOOLS as _comparison_tools
from tools.domains.compliance import TOOLS as _compliance_tools
from tools.domains.cost import TOOLS as _cost_tools
from tools.domains.devsecops import TOOLS as _devsecops_tools
from tools.domains.drbc import TOOLS as _drbc_tools
from tools.domains.governance import TOOLS as _governance_tools
from tools.domains.iac import TOOLS as _iac_tools
from tools.domains.learning import TOOLS as _learning_tools
from tools.domains.migration import TOOLS as _migration_tools
from tools.domains.monitoring import TOOLS as _monitoring_tools
from tools.domains.network import TOOLS as _network_tools
from tools.domains.operations import TOOLS as _operations_tools
from tools.domains.presentation import TOOLS as _presentation_tools
from tools.domains.project import TOOLS as _project_tools
from tools.domains.qa import TOOLS as _qa_tools
from tools.domains.security import TOOLS as _security_tools
from tools.domains.sizing import TOOLS as _sizing_tools
from tools.domains.stakeholder import TOOLS as _stakeholder_tools
from tools.domains.troubleshoot import TOOLS as _troubleshoot_tools
from tools.domains.waf import TOOLS as _waf_tools

TOOLS = _architecture_tools + _bicep_tools + _codegen_tools + _comparison_tools + _compliance_tools + _cost_tools + _devsecops_tools + _drbc_tools + _governance_tools + _iac_tools + _learning_tools + _migration_tools + _monitoring_tools + _network_tools + _operations_tools + _presentation_tools + _project_tools + _qa_tools + _security_tools + _sizing_tools + _stakeholder_tools + _troubleshoot_tools + _waf_tools

_BY_NAME = {t["function"]["name"]: t for t in TOOLS}

def get_tools(*names: str) -> list:
    return [_BY_NAME[n] for n in names if n in _BY_NAME]

TOOLS_BY_MODE: dict[str, list] = {
    "qa":           get_tools("search_azure_docs", "compare_services", "recommend_service"),
    "architecture": get_tools("search_azure_docs", "design_architecture", "assess_waf_pillar",
                              "generate_bicep", "generate_terraform", "generate_arm",
                              "estimate_costs", "generate_adr",
                              "generate_project_timeline", "validate_resource_naming",
                              "suggest_resource_name", "design_network_topology"),
    "reference":    get_tools("search_azure_docs"),
    "compare":      get_tools("search_azure_docs", "compare_services"),
    "waf":          get_tools("search_azure_docs", "assess_waf_pillar"),
    "review":       get_tools("search_azure_docs", "assess_waf_pillar"),
    "compliance":   get_tools("search_azure_docs", "map_compliance"),
    "migration":    get_tools("search_azure_docs", "assess_migration", "generate_project_timeline"),
    "regional":     get_tools("search_azure_docs", "compare_regions"),
    "cost":         get_tools("search_azure_docs", "estimate_costs"),
    "drbc":         get_tools("search_azure_docs", "design_dr_strategy", "generate_project_timeline"),
    "monitoring":   get_tools("search_azure_docs", "generate_monitoring_config"),
    "situation":    get_tools("create_stakeholder_plan"),
    "presentation": get_tools("generate_deck_outline", "review_deck_outline"),
    "certprep":     get_tools("search_azure_docs", "generate_practice_exam"),
    "learningplan": get_tools("generate_learning_plan"),
    "codegen":      get_tools("generate_code_files"),
    "tco":          get_tools("search_azure_docs", "estimate_costs", "generate_tco_report"),
    "bootstrap":      get_tools("search_azure_docs", "design_architecture", "generate_bicep",
                                "generate_terraform", "generate_arm", "estimate_costs"),
    "aiarchitecture": get_tools("search_azure_docs", "design_architecture", "estimate_costs",
                                "generate_bicep", "generate_terraform", "generate_arm",
                                "generate_project_timeline"),
    "dataplatform":   get_tools("search_azure_docs", "design_architecture", "estimate_costs",
                                "generate_bicep", "generate_terraform", "generate_arm"),
    "apim":           get_tools("search_azure_docs", "design_architecture", "generate_bicep",
                                "generate_terraform", "generate_arm", "estimate_costs"),
    "network":        get_tools("search_azure_docs", "design_network_topology", "generate_bicep",
                                "generate_terraform", "generate_arm", "estimate_costs"),
    "landingzone":    get_tools("search_azure_docs", "design_landing_zone", "generate_bicep",
                                "generate_terraform", "generate_arm",
                                "map_compliance", "validate_resource_naming", "suggest_resource_name"),
    "identity":       get_tools("search_azure_docs", "design_rbac_model", "map_compliance",
                                "generate_bicep", "generate_terraform", "generate_arm",
                                "validate_resource_naming"),
    "threatmodel":    get_tools("search_azure_docs", "generate_threat_register", "assess_waf_pillar",
                                "map_compliance"),
    "devsecops":      get_tools("search_azure_docs", "design_pipeline", "generate_bicep",
                                "generate_terraform", "generate_arm"),
    "reliability":    get_tools("search_azure_docs", "define_slo_framework", "assess_waf_pillar",
                                "generate_monitoring_config"),
    "sizing":         get_tools("search_azure_docs", "recommend_sku", "estimate_costs"),
    "troubleshoot":   get_tools("search_azure_docs", "diagnose_issue", "generate_kql_queries",
                                "generate_remediation_runbook"),
    "devops":         get_tools("search_azure_docs", "generate_cicd_pipeline", "design_pipeline"),
    "finops":         get_tools("search_azure_docs", "estimate_costs", "generate_tco_report",
                                "design_cost_alerts"),
    "securityposture": get_tools("search_azure_docs", "assess_security_posture",
                                 "assess_waf_pillar", "map_compliance"),
    "multicloud":     get_tools("search_azure_docs", "compare_clouds", "compare_services"),
    "governance":     get_tools("search_azure_docs", "design_landing_zone", "map_compliance",
                                "validate_resource_naming", "suggest_resource_name"),
    "security":       get_tools("search_azure_docs", "assess_security_posture",
                                "generate_threat_register", "design_rbac_model",
                                "assess_waf_pillar", "map_compliance"),
    "ops":            get_tools("search_azure_docs", "generate_monitoring_config",
                                "define_slo_framework", "assess_waf_pillar",
                                "generate_kql_queries", "generate_remediation_runbook"),
}

# Modes that benefit from MCP tools (informational/guidance, not subscription-bound actions)
_MCP_ENABLED_MODES = {
    "qa", "architecture", "waf", "review", "compliance", "migration",
    "regional", "cost", "drbc", "monitoring", "compare", "certprep", "reference",
    "aiarchitecture", "dataplatform", "apim", "network", "landingzone", "identity",
    "threatmodel", "devsecops", "reliability", "sizing", "troubleshoot",
    "devops", "finops", "securityposture", "multicloud",
    "governance", "security", "ops",
}


def get_tools_for_mode(mode: str) -> list:
    """Return built-in tools for mode, merged with relevant MCP tools."""
    from services.mcp_service import get_mcp_tools
    base = TOOLS_BY_MODE.get(mode, [])
    if mode not in _MCP_ENABLED_MODES:
        return base
    mcp_tools = get_mcp_tools()
    return base + mcp_tools
