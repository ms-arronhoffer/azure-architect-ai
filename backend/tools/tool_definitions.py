"""Azure OpenAI tool/function definitions for the architect agent."""

TOOLS = [
    # ── 0 ── search_azure_docs ─────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "search_azure_docs",
            "description": (
                "Search Microsoft Learn and Azure documentation for authoritative answers. "
                "Always call this before answering any Azure technical question. "
                "Returns article titles, URLs, and summaries."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Specific search query targeting the Azure topic.",
                    },
                    "category": {
                        "type": "string",
                        "enum": [
                            "architecture", "security", "cost", "reliability",
                            "networking", "storage", "compute", "identity", "",
                        ],
                        "description": "Optional category filter. Leave empty for broad search.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    # ── 1 ── design_architecture ───────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_architecture",
            "description": (
                "Generate a structured Azure architecture design. Returns a list of components "
                "(Azure services) and connections between them, plus a design overview. "
                "Call this for any architecture design or 'how would I build X on Azure' request."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "requirements": {
                        "type": "string",
                        "description": "Workload description — what the system needs to do.",
                    },
                    "constraints": {
                        "type": "string",
                        "description": "Compliance, region, budget, latency, or other constraints.",
                    },
                    "pattern": {
                        "type": "string",
                        "enum": [
                            "hub-spoke", "microservices", "event-driven",
                            "batch", "web-app", "saas-multitenant", "custom",
                        ],
                        "description": "Primary architectural pattern.",
                    },
                    "components": {
                        "type": "array",
                        "description": "List of Azure service components to include.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string", "description": "Display name"},
                                "shape": {
                                    "type": "string",
                                    "description": "draw.io azure2 shape key, e.g. application_gateway, aks, cosmos_db",
                                },
                                "category": {
                                    "type": "string",
                                    "enum": ["networking", "compute", "data", "security", "monitoring", "default"],
                                },
                                "tier": {
                                    "type": "integer",
                                    "description": "Layout tier 0=internet/users, 1=edge/gateway, 2=app, 3=data, 4=monitoring/security",
                                },
                            },
                            "required": ["id", "label", "shape"],
                        },
                    },
                    "connections": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from": {"type": "string"},
                                "to": {"type": "string"},
                                "label": {"type": "string"},
                            },
                            "required": ["from", "to"],
                        },
                    },
                    "overview": {
                        "type": "string",
                        "description": "1-2 sentence description of the architecture for the runbook.",
                    },
                    "deployment_steps": {
                        "type": "array",
                        "description": (
                            "Ordered deployment phases with service-specific Azure CLI commands. "
                            "Include real az CLI commands, resource names, and SKU flags for each service."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "phase": {"type": "string", "description": "Phase name, e.g. 'Phase 1 — Networking'"},
                                "service": {"type": "string", "description": "Azure service being deployed"},
                                "description": {"type": "string"},
                                "commands": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Azure CLI or Bicep commands to deploy this service",
                                },
                            },
                            "required": ["phase", "service", "commands"],
                        },
                    },
                },
                "required": ["requirements", "components", "connections", "overview"],
            },
        },
    },
    # ── 2 ── assess_waf_pillar ─────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_waf_pillar",
            "description": (
                "Assess an architecture against one Well-Architected Framework pillar. "
                "Returns a score (1-5), key findings, and remediation recommendations. "
                "Call once per pillar for a full WAF assessment."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pillar": {
                        "type": "string",
                        "enum": [
                            "reliability", "security", "cost",
                            "operational-excellence", "performance",
                        ],
                    },
                    "architecture_description": {
                        "type": "string",
                        "description": "Description of the architecture to assess.",
                    },
                    "score": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "description": "Pillar score: 1=critical gaps, 5=excellent.",
                    },
                    "findings": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key findings for this pillar.",
                    },
                    "recommendations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Prioritized remediation recommendations.",
                    },
                },
                "required": ["pillar", "architecture_description", "score", "findings", "recommendations"],
            },
        },
    },
    # ── 3 ── generate_bicep ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_bicep",
            "description": (
                "Generate Azure Bicep (IaC) templates for a given architecture or specific Azure resources. "
                "Returns ready-to-deploy Bicep code with parameter files and deployment instructions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "resources": {
                        "type": "array",
                        "description": "List of Azure resources to generate Bicep for.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "description": "Azure resource type, e.g. Microsoft.Web/sites"},
                                "name": {"type": "string", "description": "Logical resource name"},
                                "sku": {"type": "string", "description": "SKU/tier if applicable"},
                                "properties": {"type": "object", "description": "Key resource properties"},
                            },
                            "required": ["type", "name"],
                        },
                    },
                    "bicep_code": {
                        "type": "string",
                        "description": "Complete Bicep template code as a string.",
                    },
                    "param_file": {
                        "type": "string",
                        "description": "Bicep parameter file (.bicepparam) content.",
                    },
                    "deploy_commands": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Azure CLI commands to deploy the template.",
                    },
                    "target_scope": {
                        "type": "string",
                        "enum": ["resourceGroup", "subscription", "managementGroup"],
                        "description": (
                            "Bicep targetScope. Use 'resourceGroup' (default) for most PaaS/IaaS resources "
                            "(App Service, SQL, AKS, Key Vault, Storage, etc.). "
                            "Use 'subscription' for resource groups, subscription-level role assignments, "
                            "Azure Policy assignments, and Cost Management budgets. "
                            "Use 'managementGroup' only for org-wide policy initiatives. "
                            "Always choose the narrowest scope that satisfies the deployment requirements."
                        ),
                    },
                    "notes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Important notes, prerequisites, or customization guidance.",
                    },
                },
                "required": ["bicep_code", "target_scope"],
            },
        },
    },
    # ── 4 ── estimate_costs ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "estimate_costs",
            "description": (
                "Estimate monthly Azure costs for a set of services using the Azure Retail Pricing API. "
                "Returns line-item cost estimates with optimization recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "line_items": {
                        "type": "array",
                        "description": "Services to estimate costs for.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "service": {"type": "string", "description": "Azure service name, e.g. Azure App Service"},
                                "sku": {"type": "string", "description": "SKU/tier, e.g. P2v3, Standard"},
                                "quantity": {"type": "number", "description": "Number of instances or units"},
                                "hours_per_month": {"type": "number", "description": "Running hours per month (default 730)"},
                                "region": {"type": "string", "description": "Azure region, e.g. eastus"},
                            },
                            "required": ["service"],
                        },
                    },
                    "optimization_tips": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Cost optimization recommendations for the estimated workload.",
                    },
                },
                "required": ["line_items"],
            },
        },
    },
    # ── 5 ── generate_monitoring_config ────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_monitoring_config",
            "description": (
                "Generate Azure Monitor alert rules, KQL queries, and Log Analytics configurations "
                "for a described architecture or set of services."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "alert_rules": {
                        "type": "array",
                        "description": "Azure Monitor alert rule definitions.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "resource_type": {"type": "string"},
                                "metric_or_kql": {"type": "string", "description": "Metric name or KQL query"},
                                "threshold": {"type": "string"},
                                "severity": {"type": "integer", "minimum": 0, "maximum": 4},
                                "description": {"type": "string"},
                            },
                            "required": ["name", "metric_or_kql", "threshold", "severity"],
                        },
                    },
                    "kql_queries": {
                        "type": "array",
                        "description": "Useful KQL queries for dashboards and investigations.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "query": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["name", "query"],
                        },
                    },
                    "dashboard_widgets": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Recommended Azure Monitor dashboard tiles/workbook sections.",
                    },
                    "bicep_alerts": {
                        "type": "string",
                        "description": "Optional Bicep code to deploy the alert rules.",
                    },
                },
                "required": ["alert_rules"],
            },
        },
    },
    # ── 6 ── compare_services ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "compare_services",
            "description": (
                "Output a structured side-by-side comparison of 2-4 Azure services. "
                "Call this tool INSTEAD OF writing a text comparison table. "
                "The 'values' object in each row MUST use the exact same service name strings "
                "as the 'services' array — keys that don't match will show as blank cells."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "services": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Exact display names of the services, e.g. ['Azure Service Bus', 'Azure Event Hubs', 'Azure Event Grid']. These same strings must be keys in every values object.",
                    },
                    "use_case": {
                        "type": "string",
                        "description": "The workload or scenario driving the comparison.",
                    },
                    "comparison_rows": {
                        "type": "array",
                        "description": "6-8 comparison rows. Each row's 'values' keys MUST exactly match the strings in 'services'.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "dimension": {"type": "string", "description": "Row label, e.g. 'Primary use case fit'"},
                                "values": {
                                    "type": "object",
                                    "description": "Keys are the EXACT service name strings from the 'services' array. Values are 1-2 sentence descriptions.",
                                    "additionalProperties": {"type": "string"},
                                },
                            },
                            "required": ["dimension", "values"],
                        },
                    },
                    "recommendation": {
                        "type": "string",
                        "description": "Overall recommendation with 'choose X when...' guidance for each service.",
                    },
                    "decision_tree": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Decision criteria: 'if [condition] → choose [service]'.",
                    },
                },
                "required": ["services", "comparison_rows", "recommendation"],
            },
        },
    },
    # ── 7 ── map_compliance ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "map_compliance",
            "description": (
                "Map an Azure architecture or set of services to specific compliance framework "
                "requirements. Identifies gaps, required controls, and Azure-native compliance tools."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "framework": {
                        "type": "string",
                        "enum": ["HIPAA", "PCI-DSS", "SOC2", "FedRAMP", "GDPR", "ISO27001", "NIST-CSF", "CIS-Azure"],
                        "description": "Compliance framework to map against.",
                    },
                    "architecture_description": {
                        "type": "string",
                        "description": "Description of the architecture or services in scope.",
                    },
                    "controls_met": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of framework controls that are satisfied.",
                    },
                    "gaps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "control": {"type": "string"},
                                "gap": {"type": "string"},
                                "remediation": {"type": "string"},
                                "azure_service": {"type": "string"},
                            },
                            "required": ["control", "gap", "remediation"],
                        },
                        "description": "Controls not met and how to remediate.",
                    },
                    "azure_policy_recommendations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Recommended Azure Policy definitions or initiatives to enable.",
                    },
                    "shared_responsibility_notes": {
                        "type": "string",
                        "description": "What Microsoft is responsible for vs. what the customer must handle.",
                    },
                },
                "required": ["framework", "architecture_description", "controls_met", "gaps"],
            },
        },
    },
    # ── 8 ── assess_migration ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "assess_migration",
            "description": (
                "Assess a workload for cloud migration using the 6 R's framework "
                "(Rehost, Replatform, Refactor, Repurchase, Retain, Retire). "
                "Returns recommended migration strategy with effort, risk, and wave planning."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workload_name": {"type": "string"},
                    "current_state": {
                        "type": "string",
                        "description": "Current infrastructure, OS, database, application stack.",
                    },
                    "strategy": {
                        "type": "string",
                        "enum": ["Rehost", "Replatform", "Refactor", "Repurchase", "Retain", "Retire"],
                    },
                    "rationale": {"type": "string"},
                    "target_azure_services": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Azure services that replace the current stack.",
                    },
                    "effort_weeks": {
                        "type": "integer",
                        "description": "Estimated migration effort in weeks.",
                    },
                    "risk_level": {
                        "type": "string",
                        "enum": ["Low", "Medium", "High", "Critical"],
                    },
                    "wave": {
                        "type": "integer",
                        "description": "Suggested migration wave number (1 = first to migrate).",
                    },
                    "key_steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "High-level migration steps.",
                    },
                    "blockers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Known blockers or dependencies that must be resolved first.",
                    },
                },
                "required": ["workload_name", "current_state", "strategy", "rationale", "target_azure_services", "risk_level"],
            },
        },
    },
    # ── 9 ── design_dr_strategy ────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_dr_strategy",
            "description": (
                "Design a disaster recovery and business continuity strategy for an Azure workload. "
                "Returns DR pattern recommendation, service-specific configurations, and a test plan."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workload_description": {"type": "string"},
                    "rto_hours": {
                        "type": "number",
                        "description": "Required Recovery Time Objective in hours.",
                    },
                    "rpo_hours": {
                        "type": "number",
                        "description": "Required Recovery Point Objective in hours.",
                    },
                    "dr_pattern": {
                        "type": "string",
                        "enum": ["hot-standby", "warm-standby", "cold-standby", "pilot-light", "multi-region-active"],
                        "description": "Recommended DR pattern.",
                    },
                    "primary_region": {"type": "string"},
                    "secondary_region": {"type": "string"},
                    "service_configs": {
                        "type": "array",
                        "description": "Per-service DR configuration.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "service": {"type": "string"},
                                "dr_approach": {"type": "string"},
                                "rpo_achieved": {"type": "string"},
                                "azure_feature": {"type": "string"},
                            },
                            "required": ["service", "dr_approach"],
                        },
                    },
                    "failover_steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Step-by-step failover procedure.",
                    },
                    "test_plan": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "DR test procedures and recommended cadence.",
                    },
                    "estimated_monthly_dr_cost": {
                        "type": "string",
                        "description": "Rough cost estimate for the DR infrastructure.",
                    },
                },
                "required": ["workload_description", "dr_pattern", "service_configs", "failover_steps"],
            },
        },
    },
    # ── 10 ── generate_adr ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_adr",
            "description": (
                "Generate an Architecture Decision Record (ADR) documenting the primary architectural "
                "choice made during the design. Captures context, the decision made, trade-offs, "
                "and alternatives considered. Call this when the user requested an ADR output."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short title for the ADR, e.g. 'Use Azure Container Apps over AKS for stateless microservices'.",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["Proposed", "Accepted", "Deprecated"],
                    },
                    "context": {
                        "type": "string",
                        "description": "The architectural problem or question being addressed, including constraints and business drivers.",
                    },
                    "decision": {
                        "type": "string",
                        "description": "What was decided and the primary rationale.",
                    },
                    "consequences": {
                        "type": "string",
                        "description": "What becomes easier or harder as a result. Include positive outcomes and trade-offs.",
                    },
                    "alternatives": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Alternative options that were considered but rejected, with brief reason.",
                    },
                },
                "required": ["title", "status", "context", "decision", "consequences"],
            },
        },
    },
    # ── 11 ── generate_deck_outline ───────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_deck_outline",
            "description": (
                "Generate a complete slide-by-slide deck outline for a customer-facing presentation. "
                "Returns a structured outline with varied layouts, content bullets, and speaker notes. "
                "Always include a title slide, agenda slide, section dividers, summary, and references slide."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "deck_title": {"type": "string"},
                    "subtitle": {"type": "string"},
                    "slides": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "slide_number": {"type": "integer"},
                                "layout": {
                                    "type": "string",
                                    "enum": [
                                        "title", "agenda", "section_divider",
                                        "content", "two_column", "quote_stat",
                                        "summary", "references",
                                    ],
                                },
                                "title": {"type": "string"},
                                "content": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": (
                                        "Bullet points for content/summary/agenda/references layouts. "
                                        "For quote_stat: first item is the big stat/quote, second is a supporting fact. "
                                        "For title: first item is the subtitle text."
                                    ),
                                },
                                "right_content": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Right-column bullets for two_column layout only.",
                                },
                                "speaker_notes": {
                                    "type": "string",
                                    "description": "Full speaker notes for presenting this slide.",
                                },
                            },
                            "required": ["slide_number", "layout", "title", "content", "speaker_notes"],
                        },
                    },
                },
                "required": ["deck_title", "subtitle", "slides"],
            },
        },
    },
    # ── 12 ── review_deck_outline ─────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "review_deck_outline",
            "description": (
                "Review a presentation deck outline and return structured recommendations "
                "plus a fully improved version of the outline incorporating those recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "overall_assessment": {
                        "type": "string",
                        "description": "2-3 sentence overall quality assessment of the outline.",
                    },
                    "recommendations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["structure", "content", "narrative", "audience_fit"],
                                },
                                "issue": {"type": "string", "description": "What the problem is."},
                                "suggestion": {"type": "string", "description": "How to fix it."},
                                "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                            },
                            "required": ["type", "issue", "suggestion", "severity"],
                        },
                    },
                    "improved_outline": {
                        "type": "object",
                        "description": "A fully revised outline that incorporates all recommendations.",
                        "properties": {
                            "deck_title": {"type": "string"},
                            "subtitle": {"type": "string"},
                            "slides": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "slide_number": {"type": "integer"},
                                        "layout": {"type": "string"},
                                        "title": {"type": "string"},
                                        "content": {"type": "array", "items": {"type": "string"}},
                                        "right_content": {"type": "array", "items": {"type": "string"}},
                                        "speaker_notes": {"type": "string"},
                                    },
                                    "required": ["slide_number", "layout", "title", "content", "speaker_notes"],
                                },
                            },
                        },
                        "required": ["deck_title", "subtitle", "slides"],
                    },
                },
                "required": ["overall_assessment", "recommendations", "improved_outline"],
            },
        },
    },
    # ── 13 ── generate_code_files ─────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_code_files",
            "description": (
                "Generate complete, production-ready code files for the described requirements. "
                "Return all files needed to run the project, including configuration, tests, and README."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Relative file path, e.g. 'src/main.py' or 'README.md'.",
                                },
                                "content": {"type": "string", "description": "Complete file content."},
                                "language": {
                                    "type": "string",
                                    "description": "Language for syntax highlighting, e.g. 'python', 'typescript'.",
                                },
                                "description": {
                                    "type": "string",
                                    "description": "One-line description of what this file does.",
                                },
                            },
                            "required": ["name", "content", "language"],
                        },
                    },
                    "repo_name": {
                        "type": "string",
                        "description": "Suggested GitHub repository name (kebab-case, no spaces).",
                    },
                    "summary": {
                        "type": "string",
                        "description": "1-2 sentence summary of what was generated and how to run it.",
                    },
                },
                "required": ["files", "repo_name", "summary"],
            },
        },
    },
    # ── 14 ── generate_learning_plan ──────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_learning_plan",
            "description": (
                "Generate a structured learning plan with half-day modules, learning outcomes, "
                "prerequisite skills, and topic breakdowns with skills taught per session."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Descriptive title for the learning plan.",
                    },
                    "overview": {
                        "type": "string",
                        "description": "2-3 sentence summary of what the plan covers and who it is for.",
                    },
                    "target_audience": {
                        "type": "string",
                        "description": "Role and experience level of the intended learners.",
                    },
                    "duration_days": {
                        "type": "number",
                        "description": "Total duration in days (0.5 increments, max 3).",
                    },
                    "prerequisites": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific prerequisite skills or certifications required.",
                    },
                    "learning_outcomes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Measurable outcomes learners will achieve (verb + object).",
                    },
                    "modules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "session_label": {
                                    "type": "string",
                                    "description": "e.g. 'Day 1 – Morning' or 'Half Day – Morning'",
                                },
                                "title": {"type": "string"},
                                "duration_hours": {"type": "number"},
                                "description": {
                                    "type": "string",
                                    "description": "Brief explanation of the session focus and approach.",
                                },
                                "topics": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Ordered list of topics covered in this session.",
                                },
                                "skills_taught": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Observable skills learners will demonstrate after this session.",
                                },
                                "activities": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Labs, demos, discussions, or case studies.",
                                },
                            },
                            "required": ["session_label", "title", "description", "topics", "skills_taught"],
                        },
                    },
                },
                "required": ["title", "overview", "target_audience", "duration_days", "prerequisites", "learning_outcomes", "modules"],
            },
        },
    },
    # ── 15 ── generate_tco_report ─────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_tco_report",
            "description": (
                "Generate a structured Total Cost of Ownership (TCO) report comparing "
                "on-premises infrastructure to Azure. Include itemised costs, 3-year totals, "
                "migration costs, break-even timeline, and recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "on_prem_items": {
                        "type": "array",
                        "description": "On-premises cost line items.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "category": {"type": "string", "description": "e.g. Hardware, Software, Facilities, Staff"},
                                "description": {"type": "string"},
                                "annual_cost": {"type": "number", "description": "Annual USD cost"},
                            },
                            "required": ["category", "description", "annual_cost"],
                        },
                    },
                    "azure_items": {
                        "type": "array",
                        "description": "Azure service cost line items.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "service": {"type": "string", "description": "Azure service name"},
                                "sku": {"type": "string", "description": "SKU / tier / size"},
                                "monthly_cost": {"type": "number", "description": "Monthly USD cost"},
                            },
                            "required": ["service", "sku", "monthly_cost"],
                        },
                    },
                    "three_year_on_prem_total": {
                        "type": "number",
                        "description": "Total 3-year on-prem cost in USD.",
                    },
                    "three_year_azure_total": {
                        "type": "number",
                        "description": "Total 3-year Azure cost in USD (including migration).",
                    },
                    "migration_cost_estimate": {
                        "type": "number",
                        "description": "One-time migration cost estimate in USD.",
                    },
                    "break_even_months": {
                        "type": "number",
                        "description": "Months until Azure investment breaks even vs on-prem.",
                    },
                    "savings_percentage": {
                        "type": "number",
                        "description": "3-year cost savings as a percentage.",
                    },
                    "recommendations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Prioritised recommendations to maximise TCO savings.",
                    },
                },
                "required": [
                    "on_prem_items", "azure_items",
                    "three_year_on_prem_total", "three_year_azure_total", "recommendations",
                ],
            },
        },
    },
    # ── 16 ── design_network_topology ─────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_network_topology",
            "description": (
                "Design an Azure network topology including VNets, subnets, NSG rules, "
                "private endpoints, DNS design, and firewall configuration. "
                "Call this for any hub-spoke, vWAN, or network security design request."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topology_type": {
                        "type": "string",
                        "enum": ["hub-spoke", "vwan", "single-vnet", "peered"],
                        "description": "Primary topology pattern.",
                    },
                    "vnets": {
                        "type": "array",
                        "description": "VNet definitions with subnets.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "cidr": {"type": "string", "description": "e.g. 10.0.0.0/16"},
                                "region": {"type": "string"},
                                "subnets": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "cidr": {"type": "string"},
                                            "purpose": {"type": "string"},
                                        },
                                        "required": ["name", "cidr"],
                                    },
                                },
                            },
                            "required": ["name", "cidr", "subnets"],
                        },
                    },
                    "nsg_rules": {
                        "type": "array",
                        "description": "Key NSG rules to highlight.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "priority": {"type": "integer"},
                                "direction": {"type": "string", "enum": ["Inbound", "Outbound"]},
                                "action": {"type": "string", "enum": ["Allow", "Deny"]},
                                "source": {"type": "string"},
                                "destination": {"type": "string"},
                                "port": {"type": "string"},
                                "protocol": {"type": "string"},
                            },
                            "required": ["name", "priority", "direction", "action", "source", "destination", "port", "protocol"],
                        },
                    },
                    "private_endpoints": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "resource": {"type": "string"},
                                "subnet": {"type": "string"},
                                "private_dns_zone": {"type": "string"},
                            },
                            "required": ["resource", "subnet", "private_dns_zone"],
                        },
                    },
                    "dns_design": {
                        "type": "string",
                        "description": "DNS resolution strategy (e.g. Azure Private DNS Resolver for hybrid split-horizon).",
                    },
                    "firewall": {
                        "type": "string",
                        "description": "Azure Firewall configuration summary (tier, key rule collections).",
                    },
                },
                "required": ["topology_type", "vnets", "nsg_rules", "private_endpoints"],
            },
        },
    },
    # ── 17 ── design_landing_zone ──────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_landing_zone",
            "description": (
                "Design an Azure Landing Zone following Cloud Adoption Framework (CAF) principles. "
                "Returns management group hierarchy, policy initiatives, naming convention, "
                "mandatory tags, RBAC assignments, and subscription vending approach."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "management_groups": {
                        "type": "array",
                        "description": "Management group tree (flat list with parent_id for hierarchy).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "level": {"type": "integer", "description": "0=root, 1=platform, 2=workload, etc."},
                                "parent_id": {"type": "string"},
                            },
                            "required": ["name", "level"],
                        },
                    },
                    "policy_initiatives": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Policy initiative names to assign (e.g. 'Azure Security Benchmark', 'CIS Azure Foundations').",
                    },
                    "naming_convention": {
                        "type": "string",
                        "description": "CAF naming pattern with example (e.g. '<abbrev>-<workload>-<env>-<region>-<instance>').",
                    },
                    "mandatory_tags": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": "Tag name → allowed values or description.",
                    },
                    "rbac_assignments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "principal": {"type": "string"},
                                "role": {"type": "string"},
                                "scope": {"type": "string"},
                            },
                            "required": ["principal", "role", "scope"],
                        },
                    },
                    "subscription_vending": {
                        "type": "string",
                        "description": "Subscription vending automation approach and tooling.",
                    },
                },
                "required": ["management_groups", "policy_initiatives", "naming_convention", "mandatory_tags", "rbac_assignments"],
            },
        },
    },
    # ── 18 ── design_rbac_model ────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_rbac_model",
            "description": (
                "Design an Entra ID identity and RBAC model including role assignments, PIM, "
                "Conditional Access policies, managed identities, and workload identity federation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "principals": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of principals (groups, service principals, managed identities).",
                    },
                    "role_assignments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "principal": {"type": "string"},
                                "role": {"type": "string"},
                                "scope": {"type": "string"},
                                "type": {"type": "string", "enum": ["Active", "PIM-Eligible"]},
                            },
                            "required": ["principal", "role", "scope", "type"],
                        },
                    },
                    "custom_roles": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "permissions": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["name", "permissions"],
                        },
                    },
                    "conditional_access_policies": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "conditions": {"type": "string"},
                                "grant_controls": {"type": "string"},
                            },
                            "required": ["name", "conditions", "grant_controls"],
                        },
                    },
                    "pim_settings": {
                        "type": "string",
                        "description": "PIM activation settings (MFA, approval, max duration).",
                    },
                    "workload_federation": {
                        "type": "string",
                        "description": "Workload identity federation configuration (e.g. GitHub Actions OIDC → Entra ID).",
                    },
                },
                "required": ["principals", "role_assignments", "custom_roles", "conditional_access_policies"],
            },
        },
    },
    # ── 19 ── generate_threat_register ────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_threat_register",
            "description": (
                "Generate a STRIDE threat register for an Azure architecture. "
                "Returns trust boundaries, attack surface, threats with risk scores, "
                "and recommended security controls."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "trust_boundaries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Trust boundary definitions (e.g. 'Internet → API Gateway', 'App → Database').",
                    },
                    "attack_surface": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Exposed attack surface items.",
                    },
                    "threats": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "description": "e.g. T-001"},
                                "title": {"type": "string"},
                                "stride_category": {
                                    "type": "string",
                                    "enum": ["Spoofing", "Tampering", "Repudiation", "Information Disclosure", "Denial of Service", "Elevation of Privilege"],
                                },
                                "likelihood": {"type": "integer", "minimum": 1, "maximum": 5},
                                "impact": {"type": "integer", "minimum": 1, "maximum": 5},
                                "risk_score": {"type": "integer", "minimum": 1, "maximum": 25, "description": "likelihood × impact"},
                                "mitigations": {"type": "array", "items": {"type": "string"}},
                                "azure_controls": {"type": "array", "items": {"type": "string"}},
                                "status": {"type": "string", "enum": ["Open", "Mitigated", "Accepted"]},
                            },
                            "required": ["id", "title", "stride_category", "likelihood", "impact", "risk_score", "mitigations", "azure_controls", "status"],
                        },
                    },
                    "security_controls_recommended": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Overall recommended security controls.",
                    },
                },
                "required": ["trust_boundaries", "attack_surface", "threats", "security_controls_recommended"],
            },
        },
    },
    # ── 20 ── design_pipeline ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "design_pipeline",
            "description": (
                "Design a DevSecOps CI/CD pipeline with security gates, supply chain security, "
                "and workload identity. Returns pipeline stages, security scans, and identity configuration."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "platform": {
                        "type": "string",
                        "enum": ["github-actions", "azure-devops", "both"],
                    },
                    "branch_strategy": {
                        "type": "string",
                        "description": "Branching strategy (e.g. trunk-based, GitFlow, GitHub flow).",
                    },
                    "stages": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "jobs": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "is_security_gate": {"type": "boolean"},
                                            "steps": {"type": "array", "items": {"type": "string"}},
                                        },
                                        "required": ["name", "is_security_gate"],
                                    },
                                },
                            },
                            "required": ["name", "jobs"],
                        },
                    },
                    "security_scans": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["SAST", "DAST", "SCA", "IaC", "Container"]},
                                "tool": {"type": "string"},
                                "blocking": {"type": "boolean"},
                            },
                            "required": ["type", "tool", "blocking"],
                        },
                    },
                    "workload_identity": {
                        "type": "string",
                        "description": "Workload identity federation configuration for the pipeline.",
                    },
                    "secrets_management": {
                        "type": "string",
                        "description": "How secrets are managed (e.g. Azure Key Vault + OIDC, GitHub encrypted secrets).",
                    },
                },
                "required": ["platform", "branch_strategy", "stages", "security_scans", "workload_identity", "secrets_management"],
            },
        },
    },
    # ── 21 ── define_slo_framework ─────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "define_slo_framework",
            "description": (
                "Define SLOs, SLIs, error budgets, and multi-window burn rate alerts for an Azure workload. "
                "Returns per-service SLOs, composite SLA, burn rate alert definitions, and chaos experiment recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "services": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "azure_sla": {"type": "string", "description": "Microsoft's published SLA (e.g. 99.95%)"},
                                "customer_slo": {"type": "string", "description": "Customer-facing SLO (e.g. 99.9%)"},
                                "sli_definition": {"type": "string", "description": "How the SLI is measured (metric or KQL)"},
                                "error_budget_minutes": {"type": "number", "description": "Monthly error budget in minutes"},
                            },
                            "required": ["name", "azure_sla", "customer_slo", "sli_definition", "error_budget_minutes"],
                        },
                    },
                    "composite_sla": {
                        "type": "string",
                        "description": "End-to-end composite SLA calculation with formula.",
                    },
                    "error_budget_alerts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "window": {"type": "string", "description": "e.g. '1 hour (fast burn)' or '6 hours (slow burn)'"},
                                "burn_rate": {"type": "number", "description": "Burn rate multiplier (e.g. 14.4 for fast burn)"},
                                "description": {"type": "string"},
                            },
                            "required": ["window", "burn_rate", "description"],
                        },
                    },
                    "toil_inventory": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Identified toil items (repetitive manual operational tasks).",
                    },
                    "chaos_experiments": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Recommended Azure Chaos Studio experiments.",
                    },
                },
                "required": ["services", "composite_sla", "error_budget_alerts", "toil_inventory", "chaos_experiments"],
            },
        },
    },
    # ── 22 ── recommend_sku ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "recommend_sku",
            "description": (
                "Recommend Azure SKUs for each component of an architecture based on workload profile. "
                "Returns SKU recommendations with alternatives and autoscale configuration."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workload_profile": {
                        "type": "object",
                        "properties": {
                            "peak_users": {"type": "integer"},
                            "avg_rps": {"type": "number"},
                            "data_volume_gb": {"type": "number"},
                            "latency_p99_ms": {"type": "number"},
                            "availability_target": {"type": "string"},
                        },
                    },
                    "recommendations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "component": {"type": "string"},
                                "recommended_sku": {"type": "string"},
                                "vcpu": {"type": "number"},
                                "memory_gb": {"type": "number"},
                                "reasoning": {"type": "string"},
                                "utilization_target": {"type": "string"},
                                "alternatives": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "sku": {"type": "string"},
                                            "trade_off": {"type": "string"},
                                            "monthly_delta": {"type": "number", "description": "Cost delta vs recommended (negative=cheaper)"},
                                        },
                                        "required": ["sku", "trade_off", "monthly_delta"],
                                    },
                                },
                                "autoscale": {
                                    "type": "object",
                                    "properties": {
                                        "min": {"type": "integer"},
                                        "max": {"type": "integer"},
                                        "scale_trigger": {"type": "string"},
                                    },
                                },
                            },
                            "required": ["component", "recommended_sku", "reasoning", "alternatives"],
                        },
                    },
                    "sizing_assumptions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "warnings": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Any sizing concerns or caveats.",
                    },
                },
                "required": ["workload_profile", "recommendations", "sizing_assumptions", "warnings"],
            },
        },
    },
    # ── 23 ── compare_regions ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "compare_regions",
            "description": (
                "Output a structured comparison of 2-6 Azure regions for a given workload. "
                "Compare across key dimensions: AZ count, data residency, paired region, latency tier, "
                "compliance certifications, service availability, and cost delta. "
                "Call this for any multi-region selection or region recommendation request."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "regions": {
                        "type": "array",
                        "description": "Azure regions to compare.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "region_name": {"type": "string", "description": "Azure region display name, e.g. East US"},
                                "geography": {"type": "string", "description": "Geographic area, e.g. United States, Europe, Asia Pacific"},
                                "az_count": {"type": "integer", "description": "Number of Availability Zones (0 if none)"},
                                "data_residency": {"type": "string", "description": "Data residency boundary, e.g. United States, EU, Germany"},
                                "paired_region": {"type": "string", "description": "Azure paired region name"},
                                "latency_tier": {"type": "string", "description": "Relative latency tier for the workload, e.g. Low (<20ms), Medium (20-80ms), High (>80ms)"},
                                "cost_delta": {"type": "string", "description": "Cost relative to East US baseline, e.g. Baseline, +5%, -3%"},
                                "compliance_certs": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Key compliance certifications available in this region, e.g. FedRAMP High, HIPAA, PCI-DSS",
                                },
                                "key_services_available": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Workload-relevant Azure services confirmed available in this region",
                                },
                            },
                            "required": ["region_name", "geography", "az_count", "data_residency", "paired_region", "latency_tier", "cost_delta", "compliance_certs", "key_services_available"],
                        },
                    },
                    "recommendation": {
                        "type": "string",
                        "description": "Overall recommendation — which region(s) to use and why, with 'choose X when...' guidance.",
                    },
                    "notes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Additional notes on region selection trade-offs or constraints.",
                    },
                },
                "required": ["regions", "recommendation"],
            },
        },
    },
    # ── 24 ── generate_practice_exam ──────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "generate_practice_exam",
            "description": (
                "Generate a structured practice exam pack with multiple-choice questions in the style of the target Azure certification. "
                "Each question has 4 choices (A-D), the correct answer, a detailed explanation, and the exam domain. "
                "Call this INSTEAD of writing questions as plain text whenever the user asks for practice questions, a quiz, or exam prep material."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "exam": {
                        "type": "string",
                        "description": "Target exam code and name, e.g. AZ-305: Azure Solutions Architect Expert",
                    },
                    "questions": {
                        "type": "array",
                        "description": "Practice questions.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {"type": "string", "description": "Full scenario-based question text as it would appear on the exam."},
                                "choices": {
                                    "type": "object",
                                    "properties": {
                                        "A": {"type": "string"},
                                        "B": {"type": "string"},
                                        "C": {"type": "string"},
                                        "D": {"type": "string"},
                                    },
                                    "required": ["A", "B", "C", "D"],
                                },
                                "correct": {
                                    "type": "string",
                                    "enum": ["A", "B", "C", "D"],
                                    "description": "Letter of the correct answer.",
                                },
                                "explanation": {
                                    "type": "string",
                                    "description": "Detailed explanation of why the correct answer is right and why the distractors are wrong.",
                                },
                                "domain": {
                                    "type": "string",
                                    "description": "Exam domain/skill area this question tests, e.g. Design Data Storage Solutions",
                                },
                            },
                            "required": ["question", "choices", "correct", "explanation", "domain"],
                        },
                    },
                },
                "required": ["exam", "questions"],
            },
        },
    },
    # ── 25 ── create_stakeholder_plan ─────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_stakeholder_plan",
            "description": (
                "Create a structured stakeholder communication plan for a difficult architectural or organizational situation. "
                "Returns a situation summary, audience-specific talking points, objection handling scripts, and recommended actions. "
                "Call this when the user describes a challenging stakeholder situation, a difficult conversation, or needs help presenting a recommendation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "situation_summary": {
                        "type": "string",
                        "description": "1-2 sentence summary of the core challenge and what success looks like.",
                    },
                    "audiences": {
                        "type": "array",
                        "description": "Distinct stakeholder audiences, each with tailored guidance.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Audience name/role, e.g. CFO, Engineering Team, Security Compliance Officer"},
                                "talking_points": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "3-5 concrete talking points framed for this audience's priorities.",
                                },
                                "objections_and_responses": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "objection": {"type": "string"},
                                            "response": {"type": "string"},
                                        },
                                        "required": ["objection", "response"],
                                    },
                                    "description": "Anticipated objections with concrete response scripts.",
                                },
                            },
                            "required": ["name", "talking_points", "objections_and_responses"],
                        },
                    },
                    "recommended_actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concrete next actions to move the situation forward.",
                    },
                    "timeline": {
                        "type": "string",
                        "description": "Recommended timeline or sequencing for stakeholder conversations.",
                    },
                },
                "required": ["situation_summary", "audiences", "recommended_actions"],
            },
        },
    },
    # ── 26 ── recommend_service ────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "recommend_service",
            "description": (
                "Output a structured service or approach recommendation when the user asks which Azure service to use, "
                "which approach to take, or 'what do you recommend?' "
                "Call this INSTEAD of a text recommendation to produce a scannable decision card with rationale, trade-offs, and guardrails."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recommendation": {
                        "type": "string",
                        "description": "The primary recommendation in one sentence.",
                    },
                    "rationale": {
                        "type": "string",
                        "description": "2-3 sentence rationale explaining why this is the right choice for the stated requirements.",
                    },
                    "tradeoffs": {
                        "type": "array",
                        "description": "Key trade-offs to be aware of.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "aspect": {"type": "string", "description": "Trade-off dimension, e.g. Cost, Operational complexity, Scalability"},
                                "detail": {"type": "string", "description": "1-2 sentence description of the trade-off."},
                            },
                            "required": ["aspect", "detail"],
                        },
                    },
                    "when_to_reconsider": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Conditions under which this recommendation no longer applies.",
                    },
                },
                "required": ["recommendation", "rationale", "tradeoffs", "when_to_reconsider"],
            },
        },
    },
]

# ── Project planning ────────────────────────────────────────────────────────
TOOLS.extend([
    {
        "type": "function",
        "function": {
            "name": "generate_project_timeline",
            "description": (
                "Produce a realistic phased implementation timeline (Gantt) for an Azure project. "
                "Use for architecture, migration, DR, and landing-zone planning."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "phases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Phase name, e.g. 'Network Foundation'"},
                                "start_week": {"type": "integer", "minimum": 0},
                                "duration_weeks": {"type": "integer", "minimum": 1},
                                "dependencies": {"type": "array", "items": {"type": "string"}},
                                "deliverables": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["name", "start_week", "duration_weeks"],
                        },
                    },
                    "total_weeks": {"type": "integer", "minimum": 1},
                    "critical_path": {"type": "array", "items": {"type": "string"}},
                    "notes": {"type": "string"},
                },
                "required": ["phases", "total_weeks"],
            },
        },
    },
])

# ── Troubleshooting ─────────────────────────────────────────────────────────
TOOLS.extend([
    {
        "type": "function",
        "function": {
            "name": "diagnose_issue",
            "description": (
                "Rank likely root causes for an Azure infrastructure issue with severity, "
                "blast radius, and affected services."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symptom": {"type": "string", "description": "What the user is observing."},
                    "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "blast_radius": {"type": "string", "description": "Scope of impact (single tenant, region, global)."},
                    "affected_services": {"type": "array", "items": {"type": "string"}},
                    "hypotheses": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "cause": {"type": "string"},
                                "likelihood": {"type": "string", "enum": ["high", "medium", "low"]},
                                "evidence_needed": {"type": "string"},
                                "rule_out_check": {"type": "string"},
                            },
                            "required": ["cause", "likelihood"],
                        },
                    },
                },
                "required": ["symptom", "severity", "hypotheses"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_kql_queries",
            "description": (
                "Emit targeted Azure Monitor / Log Analytics KQL queries for evidence gathering. "
                "Be specific about table names, time windows, and key columns."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Short descriptive name, e.g. 'API Gateway 5xx Errors'"},
                                "purpose": {"type": "string"},
                                "table": {"type": "string", "description": "AzureDiagnostics, ContainerLog, AppTraces, etc."},
                                "kql": {"type": "string"},
                                "time_window": {"type": "string", "description": "e.g. 'last 1h', 'last 24h'"},
                            },
                            "required": ["name", "kql"],
                        },
                    },
                },
                "required": ["queries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_remediation_runbook",
            "description": (
                "Step-by-step fix procedure with exact commands, expected outputs, and fallbacks. "
                "Include service-restart and downtime notes per step."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "order": {"type": "integer"},
                                "action": {"type": "string"},
                                "command": {"type": "string", "description": "az / pwsh / kubectl invocation."},
                                "expected_output": {"type": "string"},
                                "fallback": {"type": "string"},
                                "causes_downtime": {"type": "boolean"},
                            },
                            "required": ["order", "action"],
                        },
                    },
                    "escalation_path": {"type": "string"},
                    "estimated_resolution_minutes": {"type": "integer"},
                },
                "required": ["steps"],
            },
        },
    },
])

# ── Governance / naming ─────────────────────────────────────────────────────
TOOLS.extend([
    {
        "type": "function",
        "function": {
            "name": "validate_resource_naming",
            "description": (
                "Validate proposed Azure resource names against the Cloud Adoption Framework "
                "(abbreviation + workload + env + region) plus per-type length/character rules. "
                "Returns per-name pass/fail, errors, warnings, and a suggested fix."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "resource_type": {"type": "string", "description": "CAF key, e.g. 'storageAccount', 'keyVault'."},
                                "name": {"type": "string"},
                            },
                            "required": ["resource_type", "name"],
                        },
                    },
                },
                "required": ["items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_resource_name",
            "description": (
                "Produce a CAF-conformant Azure resource name from workload + env + region inputs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_type": {"type": "string"},
                    "workload": {"type": "string"},
                    "env": {"type": "string", "default": "dev"},
                    "region": {"type": "string", "default": "eastus2"},
                    "suffix": {"type": "string"},
                },
                "required": ["resource_type", "workload"],
            },
        },
    },
])

_BY_NAME = {t["function"]["name"]: t for t in TOOLS}

def get_tools(*names: str) -> list:
    return [_BY_NAME[n] for n in names if n in _BY_NAME]


TOOLS_BY_MODE: dict[str, list] = {
    "qa":           get_tools("search_azure_docs", "compare_services", "recommend_service"),
    "architecture": get_tools("search_azure_docs", "design_architecture", "assess_waf_pillar",
                              "generate_bicep", "estimate_costs", "generate_adr",
                              "generate_project_timeline", "validate_resource_naming",
                              "suggest_resource_name"),
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
                                "estimate_costs"),
    "aiarchitecture": get_tools("search_azure_docs", "design_architecture", "estimate_costs",
                                "generate_bicep", "generate_project_timeline"),
    "dataplatform":   get_tools("search_azure_docs", "design_architecture", "estimate_costs",
                                "generate_bicep"),
    "apim":           get_tools("search_azure_docs", "design_architecture", "generate_bicep",
                                "estimate_costs"),
    "network":        get_tools("search_azure_docs", "design_network_topology", "generate_bicep",
                                "estimate_costs"),
    "landingzone":    get_tools("search_azure_docs", "design_landing_zone", "generate_bicep",
                                "map_compliance", "validate_resource_naming", "suggest_resource_name"),
    "identity":       get_tools("search_azure_docs", "design_rbac_model", "map_compliance",
                                "generate_bicep", "validate_resource_naming"),
    "threatmodel":    get_tools("search_azure_docs", "generate_threat_register", "assess_waf_pillar",
                                "map_compliance"),
    "devsecops":      get_tools("search_azure_docs", "design_pipeline", "generate_bicep"),
    "reliability":    get_tools("search_azure_docs", "define_slo_framework", "assess_waf_pillar",
                                "generate_monitoring_config"),
    "sizing":         get_tools("search_azure_docs", "recommend_sku", "estimate_costs"),
    "troubleshoot":   get_tools("search_azure_docs", "diagnose_issue", "generate_kql_queries",
                                "generate_remediation_runbook"),
}

# Modes that benefit from MCP tools (informational/guidance, not subscription-bound actions)
_MCP_ENABLED_MODES = {
    "qa", "architecture", "waf", "review", "compliance", "migration",
    "regional", "cost", "drbc", "monitoring", "compare", "certprep", "reference",
    "aiarchitecture", "dataplatform", "apim", "network", "landingzone", "identity",
    "threatmodel", "devsecops", "reliability", "sizing", "troubleshoot",
}


def get_tools_for_mode(mode: str) -> list:
    """Return built-in tools for mode, merged with relevant MCP tools."""
    from services.mcp_service import get_mcp_tools
    base = TOOLS_BY_MODE.get(mode, [])
    if mode not in _MCP_ENABLED_MODES:
        return base
    mcp_tools = get_mcp_tools()
    return base + mcp_tools
