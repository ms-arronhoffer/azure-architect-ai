"""Tool schemas for ops/finops/secposture/multicloud workflows (Phase 4)."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_cicd_pipeline",
            "description": (
                "Emit CI/CD pipeline files (GitHub Actions or Azure DevOps) for a target pattern. "
                "Uses OIDC federated credentials, what-if before deploy, manual approval on prod, "
                "and rollback on failure. Returns a dict of {path: yaml_content}."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "platform": {
                        "type": "string",
                        "enum": ["github_actions", "azure_devops"],
                        "description": "Target CI/CD platform.",
                    },
                    "pattern_name": {
                        "type": "string",
                        "description": "Reference architecture id the pipeline will deploy.",
                    },
                    "environment": {
                        "type": "string",
                        "description": "Deployment environment label (dev | staging | prod).",
                        "default": "dev",
                    },
                    "deploy_method": {
                        "type": "string",
                        "enum": ["bicep", "terraform", "containerapp"],
                        "description": "Which deployment toolchain the pipeline should drive.",
                        "default": "bicep",
                    },
                },
                "required": ["platform", "pattern_name", "environment"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "design_cost_alerts",
            "description": (
                "Design Azure budget + action group alerts as Bicep. Defaults to thresholds "
                "[50, 80, 100, 110]% of monthly_budget_usd."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscription_id": {"type": "string", "description": "Target subscription id."},
                    "monthly_budget_usd": {
                        "type": "number",
                        "description": "Monthly budget cap in USD.",
                    },
                    "alert_thresholds": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Percentage-of-budget thresholds to alert on.",
                        "default": [50, 80, 100, 110],
                    },
                },
                "required": ["subscription_id", "monthly_budget_usd"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_security_posture",
            "description": (
                "Score security posture for a subscription using Defender secure score + "
                "policy compliance. Optionally pulls Defender recommendations and Sentinel incidents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subscription_id": {"type": "string", "description": "Target subscription id."},
                    "include_recommendations": {
                        "type": "boolean",
                        "description": "Include Defender recommendations (Medium+).",
                        "default": True,
                    },
                    "include_incidents": {
                        "type": "boolean",
                        "description": "Include Sentinel incidents from the last 24h.",
                        "default": False,
                    },
                    "workspace_resource_id": {
                        "type": "string",
                        "description": (
                            "Log Analytics workspace resource id (required if include_incidents=true). "
                            "Format: /subscriptions/.../providers/Microsoft.OperationalInsights/workspaces/{name}"
                        ),
                    },
                },
                "required": ["subscription_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_clouds",
            "description": (
                "Multi-cloud decision support. Either map a specific Azure service to AWS/GCP "
                "equivalents (azure_service + target_clouds), or generate a workload decision "
                "matrix (workload_type + criteria)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "azure_service": {
                        "type": "string",
                        "description": "Canonical Azure service name (e.g. 'AKS', 'Cosmos DB').",
                    },
                    "target_clouds": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["aws", "gcp"]},
                        "description": "Clouds to compare against.",
                    },
                    "workload_type": {
                        "type": "string",
                        "enum": ["web_app", "data_lake", "ml_training", "global_cdn"],
                        "description": "Workload archetype for the decision matrix mode.",
                    },
                    "criteria": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["price", "performance", "vendor_lock", "compliance"],
                        },
                        "description": "Scoring criteria for the decision matrix mode.",
                    },
                },
            },
        },
    },
]
