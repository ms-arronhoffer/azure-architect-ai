"""Microsoft-official reference architectures sourced from learn.microsoft.com.

Seed catalog for the Reference Architecture Library. Each entry mirrors the
fields of the legacy `reference_archs.py` corpus and adds CRUD-shape fields
(`slug`, `source`, `bicep_avm_module`, `diagram_url`, `repo_url`). Manual
refresh — edit this file when the Architecture Center publishes new
canonical patterns.
"""

MS_REFERENCE_ARCHS: list[dict] = [
    {
        "slug": "baseline-aks",
        "title": "AKS Baseline Cluster",
        "summary": (
            "Production-grade AKS cluster with private API server, Azure CNI overlay, "
            "Azure Firewall egress, and Microsoft Entra Workload ID. The canonical "
            "starting point for any AKS workload."
        ),
        "category": "containers",
        "tags": ["aks", "kubernetes", "baseline", "regulated"],
        "services": ["AKS", "Azure Firewall", "Azure Container Registry", "Key Vault",
                     "Log Analytics", "Application Gateway", "Microsoft Entra ID"],
        "patterns": ["microservices"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 5, "performance": 4},
        "estimated_monthly": {"eastus": 2400, "westeurope": 2650},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks/baseline-aks",
        "repo_url": "https://github.com/mspnp/aks-baseline",
        "bicep_avm_module": "avm/res/container-service/managed-cluster",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "baseline-app-service",
        "title": "Baseline Highly-Available App Service",
        "summary": (
            "App Service Premium with zone redundancy, private endpoints to back-end "
            "PaaS, Front Door + WAF, Azure SQL with auto-failover groups."
        ),
        "category": "web",
        "tags": ["app service", "web", "zone-redundant", "baseline"],
        "services": ["App Service", "Azure Front Door", "WAF", "Azure SQL",
                     "Private Endpoints", "Key Vault", "Application Insights"],
        "patterns": ["web-app"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 1200, "westeurope": 1320},
        "complexity": "Medium",
        "learn_url": "https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant",
        "repo_url": None,
        "bicep_avm_module": "avm/res/web/site",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "azure-openai-baseline-landing-zone",
        "title": "Azure OpenAI Baseline Chat Reference",
        "summary": (
            "Reference implementation for a chat application powered by Azure OpenAI, "
            "deployed in an Azure Landing Zone subscription. Includes prompt flow, "
            "App Service, AI Search, and Azure AI Studio."
        ),
        "category": "ai",
        "tags": ["openai", "ai", "rag", "landing zone", "chat"],
        "services": ["Azure OpenAI", "Azure AI Search", "App Service",
                     "Azure AI Studio", "Key Vault", "Application Insights",
                     "Microsoft Entra ID"],
        "patterns": ["web-app"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 1800, "westeurope": 1950},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/ai-ml/architecture/baseline-openai-e2e-chat",
        "repo_url": "https://github.com/Azure-Samples/openai-end-to-end-baseline",
        "bicep_avm_module": "avm/res/cognitive-services/account",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "hub-spoke-network-topology",
        "title": "Hub-Spoke Network Topology",
        "summary": (
            "CAF-aligned hub-spoke topology with shared services in the hub (Azure "
            "Firewall, Bastion, DNS Private Resolver) and per-workload spokes."
        ),
        "category": "networking",
        "tags": ["hub-spoke", "networking", "landing zone", "firewall"],
        "services": ["Virtual Network", "Azure Firewall", "Azure Bastion",
                     "VPN Gateway", "ExpressRoute", "Private DNS"],
        "patterns": ["hub-spoke"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 1500, "westeurope": 1620},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke",
        "repo_url": None,
        "bicep_avm_module": "avm/ptn/network/hub-networking",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "vwan-network-topology",
        "title": "Virtual WAN Network Topology",
        "summary": (
            "Microsoft-managed transit network using Azure Virtual WAN with secured "
            "hubs and any-to-any branch/spoke routing."
        ),
        "category": "networking",
        "tags": ["vwan", "networking", "global", "branch"],
        "services": ["Virtual WAN", "Azure Firewall Manager", "ExpressRoute",
                     "VPN Gateway", "Azure Monitor"],
        "patterns": ["hub-spoke"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 3, "operations": 5, "performance": 5},
        "estimated_monthly": {"eastus": 2100, "westeurope": 2300},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/networking/architecture/vwan-network-topology",
        "repo_url": None,
        "bicep_avm_module": "avm/ptn/network/hub-networking",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "alz-conceptual-architecture",
        "title": "Azure Landing Zones — Conceptual Architecture",
        "summary": (
            "Cloud Adoption Framework landing zone with management group hierarchy, "
            "policy guardrails, identity, connectivity, and platform/application "
            "landing zones."
        ),
        "category": "governance",
        "tags": ["landing zone", "caf", "alz", "policy", "governance"],
        "services": ["Management Groups", "Azure Policy", "Defender for Cloud",
                     "Microsoft Sentinel", "Microsoft Entra ID", "Azure Monitor"],
        "patterns": ["hub-spoke"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 4, "operations": 5, "performance": 4},
        "estimated_monthly": {"eastus": 2800, "westeurope": 3000},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/",
        "repo_url": "https://github.com/Azure/Enterprise-Scale",
        "bicep_avm_module": "avm/ptn/lz/sub-vending",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "modern-data-warehouse",
        "title": "Modern Data Warehouse on Fabric",
        "summary": (
            "End-to-end analytics platform on Microsoft Fabric (OneLake, Lakehouse, "
            "Data Warehouse, Power BI Direct Lake) for streaming + batch."
        ),
        "category": "data",
        "tags": ["fabric", "onelake", "data warehouse", "analytics", "power bi"],
        "services": ["Microsoft Fabric", "OneLake", "Power BI",
                     "Azure Data Factory", "Microsoft Purview"],
        "patterns": ["batch"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 3, "operations": 4, "performance": 5},
        "estimated_monthly": {"eastus": 4500, "westeurope": 4800},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/fabric/onelake/onelake-overview",
        "repo_url": None,
        "bicep_avm_module": None,
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "event-driven-functions",
        "title": "Event-Driven Serverless with Functions",
        "summary": (
            "Functions + Event Grid + Service Bus + Cosmos DB serverless pipeline "
            "with API Management gateway."
        ),
        "category": "integration",
        "tags": ["serverless", "functions", "event grid", "event-driven"],
        "services": ["Azure Functions", "Event Grid", "Service Bus", "Cosmos DB",
                     "API Management", "Application Insights"],
        "patterns": ["event-driven"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 5, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 320, "westeurope": 360},
        "complexity": "Medium",
        "learn_url": "https://learn.microsoft.com/azure/architecture/serverless/event-hubs-functions/event-hubs-functions",
        "repo_url": None,
        "bicep_avm_module": "avm/res/web/site",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "multi-region-active-active",
        "title": "Multi-Region Active-Active Web App",
        "summary": (
            "Active-active web app across two paired regions using Front Door, "
            "geo-replicated Azure SQL, and globally-distributed Cosmos DB."
        ),
        "category": "resiliency",
        "tags": ["multi-region", "active-active", "front door", "dr"],
        "services": ["Azure Front Door", "App Service", "Azure SQL", "Cosmos DB",
                     "Storage GRS", "Traffic Manager"],
        "patterns": ["web-app"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 2, "operations": 4, "performance": 5},
        "estimated_monthly": {"eastus": 3500, "westeurope": 3700},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/multi-region",
        "repo_url": None,
        "bicep_avm_module": "avm/res/web/site",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "rag-pipeline-ai-search",
        "title": "Retrieval-Augmented Generation Pipeline",
        "summary": (
            "Document ingestion → embedding → indexing → query pipeline using Azure "
            "AI Search vector store, Document Intelligence, and Azure OpenAI."
        ),
        "category": "ai",
        "tags": ["rag", "openai", "ai search", "embeddings", "vector"],
        "services": ["Azure OpenAI", "Azure AI Search", "Document Intelligence",
                     "Blob Storage", "Container Apps"],
        "patterns": ["event-driven"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 950, "westeurope": 1050},
        "complexity": "Medium",
        "learn_url": "https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide",
        "repo_url": "https://github.com/Azure-Samples/azure-search-openai-demo",
        "bicep_avm_module": "avm/res/search/search-service",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
    {
        "slug": "iot-foundation",
        "title": "IoT Foundation",
        "summary": (
            "Reference IoT solution: devices → IoT Hub → Stream Analytics → "
            "Time Series Insights / Cosmos DB → dashboards."
        ),
        "category": "iot",
        "tags": ["iot", "iot hub", "edge", "telemetry"],
        "services": ["Azure IoT Hub", "Azure IoT Edge", "Stream Analytics",
                     "Time Series Insights", "Cosmos DB", "Power BI"],
        "patterns": ["event-driven"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 4, "operations": 3, "performance": 5},
        "estimated_monthly": {"eastus": 1100, "westeurope": 1200},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/iot",
        "repo_url": None,
        "bicep_avm_module": None,
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "sap-on-azure",
        "title": "SAP on Azure (S/4HANA)",
        "summary": (
            "Reference architecture for SAP S/4HANA on Azure VMs with M-series, "
            "Azure NetApp Files, ExpressRoute, and disaster recovery to a paired "
            "region."
        ),
        "category": "compute",
        "tags": ["sap", "hana", "vm", "expressroute", "enterprise"],
        "services": ["Azure VMs (M-series)", "Azure NetApp Files",
                     "ExpressRoute", "Azure Site Recovery",
                     "Azure Backup", "Azure Monitor for SAP"],
        "patterns": ["custom"],
        "waf_score": {"reliability": 5, "security": 4, "cost": 2, "operations": 4, "performance": 5},
        "estimated_monthly": {"eastus": 18000, "westeurope": 19500},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/architecture/reference-architectures/sap/sap-s4hana",
        "repo_url": None,
        "bicep_avm_module": None,
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "avd-baseline",
        "title": "Azure Virtual Desktop Baseline",
        "summary": (
            "AVD host pools with FSLogix profile containers, Entra ID join, "
            "Azure Files for storage, and Defender for Cloud."
        ),
        "category": "compute",
        "tags": ["avd", "virtual desktop", "fslogix", "vdi"],
        "services": ["Azure Virtual Desktop", "Azure Files", "Microsoft Entra ID",
                     "Defender for Cloud", "Log Analytics"],
        "patterns": ["custom"],
        "waf_score": {"reliability": 4, "security": 4, "cost": 3, "operations": 4, "performance": 4},
        "estimated_monthly": {"eastus": 4200, "westeurope": 4500},
        "complexity": "Medium",
        "learn_url": "https://learn.microsoft.com/azure/architecture/example-scenario/wvd/windows-virtual-desktop",
        "repo_url": None,
        "bicep_avm_module": "avm/res/desktop-virtualization/host-pool",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "api-management-landing-zone",
        "title": "API Management Landing Zone Accelerator",
        "summary": (
            "APIM Premium with internal VNet integration, Azure Front Door + WAF, "
            "Application Gateway, and CI/CD via GitHub Actions."
        ),
        "category": "integration",
        "tags": ["apim", "api management", "landing zone", "internal vnet"],
        "services": ["API Management", "Azure Front Door", "WAF",
                     "Application Gateway", "Key Vault", "Application Insights"],
        "patterns": ["web-app"],
        "waf_score": {"reliability": 5, "security": 5, "cost": 3, "operations": 5, "performance": 4},
        "estimated_monthly": {"eastus": 3200, "westeurope": 3400},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/app-platform/api-management/landing-zone-accelerator",
        "repo_url": "https://github.com/Azure/apim-landing-zone-accelerator",
        "bicep_avm_module": "avm/res/api-management/service",
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": False,
    },
    {
        "slug": "zero-trust-network",
        "title": "Zero Trust Network",
        "summary": (
            "Zero Trust topology with Conditional Access, private endpoints for all "
            "PaaS, Azure Firewall Premium TLS inspection, Defender for Cloud, "
            "and Microsoft Sentinel."
        ),
        "category": "security",
        "tags": ["zero trust", "private endpoints", "conditional access", "sentinel"],
        "services": ["Microsoft Entra ID", "Azure Firewall Premium", "Private Endpoints",
                     "Defender for Cloud", "Microsoft Sentinel", "Key Vault"],
        "patterns": ["hub-spoke"],
        "waf_score": {"reliability": 4, "security": 5, "cost": 3, "operations": 4, "performance": 3},
        "estimated_monthly": {"eastus": 2600, "westeurope": 2800},
        "complexity": "High",
        "learn_url": "https://learn.microsoft.com/security/zero-trust/deploy/networks",
        "repo_url": None,
        "bicep_avm_module": None,
        "diagram_url": None,
        "source": "microsoft_official",
        "featured": True,
    },
]
