"""Curated catalog of Azure reference architectures."""

REFERENCE_ARCHS: list[dict] = [
    {
        "id": "web-app-zone-redundant",
        "title": "Zone-Redundant Web Application",
        "category": "web",
        "tags": ["web", "availability zones", "app service", "sql"],
        "description": (
            "Highly available web application using Azure App Service with zone redundancy, "
            "Azure SQL Database with zone-redundant configuration, Azure Cache for Redis, "
            "and Application Gateway with WAF. Achieves 99.99% SLA."
        ),
        "services": ["Application Gateway", "App Service", "Azure SQL Database", "Azure Cache for Redis",
                     "Key Vault", "Log Analytics"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 3, "operations": 4, "performance": 4},
        "patterns": ["web-app"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant",
        "complexity": "Medium",
        "estimated_monthly": "$400-800",
    },
    {
        "id": "microservices-aks",
        "title": "Microservices on AKS",
        "category": "microservices",
        "tags": ["microservices", "aks", "kubernetes", "dapr", "service mesh"],
        "description": (
            "Production-grade microservices platform using Azure Kubernetes Service with Dapr, "
            "Azure Service Bus for async messaging, Azure Container Registry, and a full "
            "observability stack with Azure Monitor and Application Insights."
        ),
        "services": ["AKS", "Azure Container Registry", "Service Bus", "Application Insights",
                     "Key Vault", "Azure Monitor", "Log Analytics"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 3, "operations": 5, "performance": 5},
        "patterns": ["microservices"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-microservices/aks-microservices",
        "complexity": "High",
        "estimated_monthly": "$1,500-4,000",
    },
    {
        "id": "hub-spoke-enterprise",
        "title": "Hub-Spoke Enterprise Networking",
        "category": "networking",
        "tags": ["hub-spoke", "networking", "azure firewall", "vpn", "expressroute"],
        "description": (
            "Enterprise hub-spoke network topology with Azure Firewall Premium in the hub, "
            "ExpressRoute and VPN Gateway for hybrid connectivity, Azure Bastion for secure "
            "VM access, and DDoS Protection Standard. Foundation for landing zones."
        ),
        "services": ["Virtual Network", "Azure Firewall", "ExpressRoute", "VPN Gateway",
                     "Azure Bastion", "DDoS Protection", "Network Watcher"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "patterns": ["hub-spoke"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke",
        "complexity": "High",
        "estimated_monthly": "$800-2,500",
    },
    {
        "id": "event-driven-serverless",
        "title": "Event-Driven Serverless Architecture",
        "category": "integration",
        "tags": ["event-driven", "functions", "event grid", "service bus", "serverless"],
        "description": (
            "Fully serverless event-driven system using Azure Functions with Event Grid for "
            "event routing, Service Bus for reliable messaging, Cosmos DB for state storage, "
            "and API Management as the entry point. Scales to zero, pay per execution."
        ),
        "services": ["Azure Functions", "Event Grid", "Service Bus", "Cosmos DB",
                     "API Management", "Application Insights"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 5, "operations": 3, "performance": 4},
        "patterns": ["event-driven"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/serverless/event-hubs-functions/event-hubs-functions",
        "complexity": "Medium",
        "estimated_monthly": "$50-500",
    },
    {
        "id": "saas-multitenant",
        "title": "SaaS Multi-Tenant Application",
        "category": "saas",
        "tags": ["saas", "multi-tenant", "entra id", "b2c", "cosmos db"],
        "description": (
            "Multi-tenant SaaS platform with per-tenant Entra ID isolation, Azure Container Apps "
            "for the application tier, Cosmos DB with tenant-scoped partitioning, and a billing "
            "integration layer. Supports both pool and silo tenancy models."
        ),
        "services": ["Azure Container Apps", "Cosmos DB", "Entra ID", "API Management",
                     "Service Bus", "Key Vault", "Application Insights"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 4, "operations": 4, "performance": 4},
        "patterns": ["saas-multitenant"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/guide/multitenant/overview",
        "complexity": "High",
        "estimated_monthly": "$300-2,000",
    },
    {
        "id": "data-analytics-lakehouse",
        "title": "Modern Data Lakehouse",
        "category": "data",
        "tags": ["analytics", "data lake", "synapse", "databricks", "delta lake"],
        "description": (
            "Enterprise analytics platform using Azure Data Lake Storage Gen2, Azure Synapse "
            "Analytics or Databricks for processing, Azure Purview for data governance, "
            "and Power BI for visualization. Supports batch and near-real-time analytics."
        ),
        "services": ["Azure Data Lake Storage Gen2", "Azure Synapse Analytics", "Azure Databricks",
                     "Microsoft Purview", "Power BI", "Azure Data Factory", "Key Vault"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 5},
        "patterns": ["batch"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/example-scenario/data/azure-synapse-analytics-landing-zone",
        "complexity": "High",
        "estimated_monthly": "$2,000-10,000",
    },
    {
        "id": "iot-edge-cloud",
        "title": "IoT Edge-to-Cloud",
        "category": "iot",
        "tags": ["iot", "iot hub", "event hubs", "stream analytics", "edge"],
        "description": (
            "End-to-end IoT solution with Azure IoT Hub for device management, IoT Edge for "
            "local processing, Event Hubs for high-throughput ingestion, Stream Analytics for "
            "real-time processing, and Cosmos DB or Azure Digital Twins for state management."
        ),
        "services": ["Azure IoT Hub", "Azure IoT Edge", "Event Hubs", "Stream Analytics",
                     "Cosmos DB", "Azure Digital Twins", "Time Series Insights"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 4, "operations": 3, "performance": 5},
        "patterns": ["event-driven"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/iot",
        "complexity": "High",
        "estimated_monthly": "$500-3,000",
    },
    {
        "id": "ai-rag-chatbot",
        "title": "AI-Powered RAG Chatbot",
        "category": "ai",
        "tags": ["ai", "openai", "rag", "cognitive search", "chatbot"],
        "description": (
            "Enterprise RAG (Retrieval-Augmented Generation) chatbot using Azure OpenAI Service, "
            "Azure AI Search for vector similarity, Azure Blob Storage for document ingestion, "
            "and Azure Container Apps for the application layer with Entra ID authentication."
        ),
        "services": ["Azure OpenAI Service", "Azure AI Search", "Azure Container Apps",
                     "Blob Storage", "Entra ID", "Application Insights", "Key Vault"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "patterns": ["web-app"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/ai-ml/architecture/conversational-bot",
        "complexity": "Medium",
        "estimated_monthly": "$200-1,500",
    },
    {
        "id": "hipaa-compliant-healthcare",
        "title": "HIPAA-Compliant Healthcare Platform",
        "category": "compliance",
        "tags": ["hipaa", "healthcare", "phi", "fhir", "compliance"],
        "description": (
            "HIPAA-compliant healthcare data platform using Azure Health Data Services (FHIR), "
            "private endpoints throughout, Azure Key Vault for PHI encryption keys, Defender for "
            "Cloud with HIPAA policy initiative, and full audit logging to Log Analytics."
        ),
        "services": ["Azure Health Data Services", "Azure SQL Database", "Key Vault",
                     "Private Endpoints", "Defender for Cloud", "Log Analytics", "Entra ID"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 4, "performance": 3},
        "patterns": ["web-app"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/industries/healthcare/health-data-services-architectures",
        "complexity": "High",
        "estimated_monthly": "$1,000-4,000",
    },
    {
        "id": "devops-ci-cd",
        "title": "Enterprise CI/CD Pipeline",
        "category": "devops",
        "tags": ["devops", "ci/cd", "github actions", "azure devops", "pipelines"],
        "description": (
            "Production CI/CD pipeline with Azure DevOps or GitHub Actions, Azure Container "
            "Registry for image storage, deployment to AKS or Container Apps with blue-green "
            "deployment, Defender for DevOps for supply chain security, and automated testing."
        ),
        "services": ["Azure DevOps", "Azure Container Registry", "AKS", "Defender for DevOps",
                     "Key Vault", "Log Analytics", "Azure Monitor"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 4, "operations": 5, "performance": 4},
        "patterns": ["custom"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/guide/aks/aks-cicd-github-actions-and-gitops",
        "complexity": "Medium",
        "estimated_monthly": "$200-800",
    },
    {
        "id": "azure-landing-zone",
        "title": "Azure Landing Zone (CAF)",
        "category": "governance",
        "tags": ["landing zone", "caf", "governance", "management groups", "policy"],
        "description": (
            "Cloud Adoption Framework landing zone foundation with management group hierarchy, "
            "Azure Policy for guardrails, Microsoft Defender for Cloud for security posture, "
            "central hub networking, and subscription vending for workload teams."
        ),
        "services": ["Management Groups", "Azure Policy", "Defender for Cloud", "Azure Firewall",
                     "Log Analytics", "Azure Monitor", "Microsoft Sentinel"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 4, "operations": 5, "performance": 4},
        "patterns": ["hub-spoke"],
        "learn_url": "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/",
        "complexity": "High",
        "estimated_monthly": "$1,500-5,000",
    },
    {
        "id": "batch-processing",
        "title": "Large-Scale Batch Processing",
        "category": "compute",
        "tags": ["batch", "hpc", "azure batch", "spot vms", "data factory"],
        "description": (
            "High-throughput batch processing using Azure Batch with Spot VMs (up to 90% savings), "
            "Azure Data Factory for orchestration, Blob Storage for input/output, and Application "
            "Insights for job monitoring. Scales from 0 to thousands of cores."
        ),
        "services": ["Azure Batch", "Azure Data Factory", "Blob Storage", "Application Insights",
                     "Key Vault", "Azure Monitor"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 5, "operations": 4, "performance": 5},
        "patterns": ["batch"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/app-service-web-app/scalable-apps-performance",
        "complexity": "Medium",
        "estimated_monthly": "$100-5,000",
    },
    {
        "id": "api-backend",
        "title": "Scalable API Backend",
        "category": "web",
        "tags": ["api", "rest", "container apps", "api management", "cosmos db"],
        "description": (
            "Production API backend with Azure API Management as gateway, Azure Container Apps "
            "for compute (auto-scales to zero), Cosmos DB for the data layer, Redis Cache for "
            "hot data, and Application Insights for distributed tracing."
        ),
        "services": ["API Management", "Azure Container Apps", "Cosmos DB", "Azure Cache for Redis",
                     "Application Insights", "Key Vault", "Entra ID"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 4, "operations": 4, "performance": 5},
        "patterns": ["web-app"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/microservices/api-gateway",
        "complexity": "Medium",
        "estimated_monthly": "$200-1,000",
    },
    {
        "id": "dr-paired-regions",
        "title": "Multi-Region DR with Paired Regions",
        "category": "resiliency",
        "tags": ["disaster recovery", "multi-region", "paired regions", "site recovery", "failover"],
        "description": (
            "Active-passive disaster recovery using Azure paired regions, Azure Site Recovery "
            "for VM/workload replication, geo-redundant SQL with auto-failover groups, "
            "Traffic Manager for DNS-level failover, and Azure Backup with GRS."
        ),
        "services": ["Azure Site Recovery", "Azure SQL Database", "Traffic Manager",
                     "Azure Backup", "Azure Monitor", "Key Vault"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 3, "operations": 4, "performance": 3},
        "patterns": ["custom"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/resiliency/recovery-loss-azure-region",
        "complexity": "High",
        "estimated_monthly": "$500-3,000",
    },
    {
        "id": "zero-trust-network",
        "title": "Zero Trust Network Architecture",
        "category": "security",
        "tags": ["zero trust", "security", "private endpoints", "entra id", "defender"],
        "description": (
            "Zero Trust network architecture eliminating implicit trust: Entra ID with Conditional "
            "Access, private endpoints for all PaaS services, Azure Firewall Premium for traffic "
            "inspection, Defender for Cloud for posture management, and Sentinel for SIEM/SOAR."
        ),
        "services": ["Entra ID", "Azure Firewall Premium", "Private Endpoints", "Defender for Cloud",
                     "Microsoft Sentinel", "Key Vault", "Log Analytics"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 3},
        "patterns": ["hub-spoke"],
        "learn_url": "https://learn.microsoft.com/azure/architecture/guide/security/security-start-here",
        "complexity": "High",
        "estimated_monthly": "$1,000-3,500",
    },
]

CATEGORIES = sorted({a["category"] for a in REFERENCE_ARCHS})
ALL_TAGS = sorted({tag for a in REFERENCE_ARCHS for tag in a["tags"]})


def search_reference_archs(query: str = "", category: str = "", tag: str = "") -> list[dict]:
    """Filter reference architectures by query text, category, or tag."""
    results = REFERENCE_ARCHS
    if category:
        results = [a for a in results if a["category"] == category]
    if tag:
        results = [a for a in results if tag in a["tags"]]
    if query:
        q = query.lower()
        results = [
            a for a in results
            if q in a["title"].lower()
            or q in a["description"].lower()
            or any(q in t for t in a["tags"])
            or any(q in s.lower() for s in a["services"])
        ]
    return results
