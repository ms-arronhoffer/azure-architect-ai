"""Multi-cloud service equivalence + decision matrix.

Hardcoded mappings — this is decision support, not benchmarking. Scores reflect
common architect intuition and AVM/CAF guidance, not synthetic benchmarks.
"""
from __future__ import annotations


SERVICE_MAP: dict[str, dict[str, str | None]] = {
    # Compute
    "compute_vm": {"azure": "Virtual Machines", "aws": "EC2", "gcp": "Compute Engine"},
    "compute_serverless": {"azure": "Functions", "aws": "Lambda", "gcp": "Cloud Functions"},
    "container_orchestration": {"azure": "AKS", "aws": "EKS", "gcp": "GKE"},
    "container_serverless": {"azure": "Container Apps", "aws": "Fargate", "gcp": "Cloud Run"},
    "container_registry": {"azure": "Container Registry", "aws": "ECR", "gcp": "Artifact Registry"},
    "batch_compute": {"azure": "Batch", "aws": "Batch", "gcp": "Batch"},
    "app_platform": {"azure": "App Service", "aws": "Elastic Beanstalk", "gcp": "App Engine"},
    # Storage
    "object_storage": {"azure": "Blob Storage", "aws": "S3", "gcp": "Cloud Storage"},
    "file_storage": {"azure": "Files", "aws": "EFS", "gcp": "Filestore"},
    "block_storage": {"azure": "Managed Disks", "aws": "EBS", "gcp": "Persistent Disk"},
    "archive_storage": {"azure": "Blob Archive", "aws": "S3 Glacier", "gcp": "Coldline"},
    # Networking
    "vnet": {"azure": "Virtual Network", "aws": "VPC", "gcp": "VPC"},
    "load_balancer": {"azure": "Load Balancer", "aws": "ELB/ALB", "gcp": "Cloud Load Balancing"},
    "cdn": {"azure": "Front Door / CDN", "aws": "CloudFront", "gcp": "Cloud CDN"},
    "dns": {"azure": "DNS", "aws": "Route 53", "gcp": "Cloud DNS"},
    "api_gateway": {"azure": "API Management", "aws": "API Gateway", "gcp": "Apigee"},
    "firewall": {"azure": "Azure Firewall", "aws": "Network Firewall", "gcp": "Cloud Armor"},
    # Identity
    "identity": {"azure": "Entra ID", "aws": "IAM Identity Center", "gcp": "Cloud Identity"},
    "secrets": {"azure": "Key Vault", "aws": "Secrets Manager", "gcp": "Secret Manager"},
    # AI/ML
    "ai_platform": {"azure": "Azure OpenAI / AI Foundry", "aws": "Bedrock", "gcp": "Vertex AI"},
    "ml_training": {"azure": "Machine Learning", "aws": "SageMaker", "gcp": "Vertex AI Training"},
    "ai_search": {"azure": "AI Search", "aws": "Kendra", "gcp": "Vertex AI Search"},
    "speech": {"azure": "AI Speech", "aws": "Transcribe/Polly", "gcp": "Speech-to-Text"},
    # Data
    "relational_db": {"azure": "Azure SQL", "aws": "RDS", "gcp": "Cloud SQL"},
    "nosql_db": {"azure": "Cosmos DB", "aws": "DynamoDB", "gcp": "Firestore"},
    "data_warehouse": {"azure": "Synapse / Fabric", "aws": "Redshift", "gcp": "BigQuery"},
    "data_lake": {"azure": "ADLS Gen2", "aws": "S3 + Lake Formation", "gcp": "Cloud Storage + BigLake"},
    "stream_processing": {"azure": "Event Hubs / Stream Analytics", "aws": "Kinesis", "gcp": "Pub/Sub + Dataflow"},
    # DevOps
    "ci_cd": {"azure": "Azure DevOps / GitHub Actions", "aws": "CodePipeline", "gcp": "Cloud Build"},
    # Monitoring / Security
    "monitoring": {"azure": "Azure Monitor / App Insights", "aws": "CloudWatch", "gcp": "Cloud Monitoring"},
    "siem": {"azure": "Sentinel", "aws": "Security Lake", "gcp": "Chronicle"},
}


_AZURE_REASONS: dict[str, str] = {
    "AKS": "Tight Entra ID integration, AGIC ingress, and Azure Policy add-on for org-wide compliance.",
    "Virtual Machines": "Hybrid story via Arc; spot pricing; reserved instances combine with savings plans.",
    "Functions": "Native Durable Functions for stateful orchestrations; flex consumption pricing.",
    "App Service": "Built-in Easy Auth (Entra), VNet integration, and slot-based blue/green out of the box.",
    "Cosmos DB": "Multi-region multi-write with 99.999% SLA and synchronous strong consistency option.",
    "Azure SQL": "Always Encrypted, Hyperscale tier, and serverless auto-pause for dev/test.",
    "Synapse / Fabric": "Unified analytics + Power BI integration; OneLake reduces data movement.",
    "Azure OpenAI / AI Foundry": "Enterprise data residency, PTUs for predictable latency, on-your-data RAG.",
    "Container Apps": "Dapr-native sidecar, KEDA scaling, and revision-based zero-downtime rollouts.",
    "Front Door / CDN": "Global anycast network with WAF, private link origin, and rules engine.",
    "Entra ID": "Conditional Access, B2B/B2C, and seamless integration with M365 estate.",
    "Key Vault": "HSM-backed keys, managed identity integration, certificate auto-rotation.",
}

_DEFAULT_REASON = "Strong Entra ID integration and hybrid story via Azure Arc."


def _find_key(azure_service: str) -> str | None:
    target = azure_service.strip().lower()
    for key, mapping in SERVICE_MAP.items():
        az = (mapping.get("azure") or "").lower()
        if az == target or target in az:
            return key
    return None


def compare_services(azure_service: str, target_clouds: list[str]) -> dict:
    """Return AWS/GCP equivalents and a 'why Azure' reason."""
    key = _find_key(azure_service)
    if key is None:
        return {
            "azure_service": azure_service,
            "matches": {},
            "why_azure": _DEFAULT_REASON,
            "note": "No exact match in SERVICE_MAP; supply a canonical Azure service name.",
        }
    mapping = SERVICE_MAP[key]
    out_matches = {c: mapping.get(c) for c in target_clouds if c in ("aws", "gcp")}
    canonical = mapping.get("azure") or azure_service
    return {
        "azure_service": canonical,
        "category": key,
        "matches": out_matches,
        "why_azure": _AZURE_REASONS.get(canonical, _DEFAULT_REASON),
    }


_MATRIX: dict[str, dict[str, dict[str, int]]] = {
    "web_app": {
        "azure": {"price": 4, "performance": 4, "vendor_lock": 3, "compliance": 5},
        "aws": {"price": 3, "performance": 5, "vendor_lock": 2, "compliance": 4},
        "gcp": {"price": 4, "performance": 4, "vendor_lock": 3, "compliance": 4},
    },
    "data_lake": {
        "azure": {"price": 4, "performance": 4, "vendor_lock": 3, "compliance": 5},
        "aws": {"price": 4, "performance": 5, "vendor_lock": 3, "compliance": 4},
        "gcp": {"price": 4, "performance": 5, "vendor_lock": 2, "compliance": 4},
    },
    "ml_training": {
        "azure": {"price": 3, "performance": 4, "vendor_lock": 3, "compliance": 5},
        "aws": {"price": 3, "performance": 5, "vendor_lock": 3, "compliance": 4},
        "gcp": {"price": 4, "performance": 5, "vendor_lock": 3, "compliance": 4},
    },
    "global_cdn": {
        "azure": {"price": 3, "performance": 4, "vendor_lock": 3, "compliance": 5},
        "aws": {"price": 4, "performance": 5, "vendor_lock": 2, "compliance": 4},
        "gcp": {"price": 4, "performance": 4, "vendor_lock": 2, "compliance": 4},
    },
}

_MATRIX_NOTES: dict[str, str] = {
    "web_app": (
        "Azure App Service ties cleanly into Entra ID and enterprise SSO, edging out on compliance "
        "for regulated industries. AWS edges performance via more granular Fargate/Lambda tuning."
    ),
    "data_lake": (
        "BigQuery wins on serverless query performance; ADLS Gen2 with Fabric/OneLake reduces data "
        "movement for shops already on M365/Power BI. S3 + Lake Formation has the broadest tooling."
    ),
    "ml_training": (
        "Vertex AI and SageMaker lead on raw training throughput; Azure ML wins on Entra-governed "
        "MLOps and Azure OpenAI integration for hybrid generative + classical pipelines."
    ),
    "global_cdn": (
        "CloudFront still leads on cache fill performance and POP count. Front Door wins on WAF + "
        "private link origin patterns and pairs naturally with APIM."
    ),
}


def decision_matrix(workload_type: str, criteria: list[str]) -> dict:
    """Score Azure/AWS/GCP on the requested criteria for a workload type."""
    if workload_type not in _MATRIX:
        return {
            "error": f"Unknown workload_type '{workload_type}'. Choose from: {sorted(_MATRIX)}"
        }
    full = _MATRIX[workload_type]
    out: dict[str, dict[str, int]] = {}
    for cloud, scores in full.items():
        out[cloud] = {c: scores.get(c, 0) for c in criteria if c in scores}
    return {
        "workload_type": workload_type,
        "criteria": criteria,
        "azure": out.get("azure", {}),
        "aws": out.get("aws", {}),
        "gcp": out.get("gcp", {}),
        "notes": _MATRIX_NOTES.get(workload_type, ""),
    }


__all__ = ["SERVICE_MAP", "compare_services", "decision_matrix"]
