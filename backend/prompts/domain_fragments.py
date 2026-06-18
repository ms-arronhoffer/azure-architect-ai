"""Short domain-knowledge fragments selected by the agent router.

Each fragment is a self-contained paragraph that adds depth on one
topic without bloating the base agent prompt. The router picks 0–3
fragments per request based on the user's question.

Keep fragments under ~150 tokens each — at most one tight paragraph
plus a short bullet list. Anything longer belongs in RAG.
"""
from __future__ import annotations

FRAGMENTS: dict[str, str] = {
    # --- Network ---
    "network_vnet": (
        "**VNet design.** Default to hub-and-spoke with Azure Firewall in the hub for east-west "
        "and forced-tunnel egress. Use private endpoints over service endpoints when the PaaS "
        "service supports them. Address space: plan /16 hubs and /20-/22 spokes; avoid 10.0.0.0/8 "
        "collision with on-prem. ExpressRoute for >1 Gbps or SLA-bound; VPN otherwise."
    ),
    "network_dns": (
        "**Private DNS.** Use Azure Private DNS zones linked to the hub VNet; auto-register from "
        "spokes. For private endpoints, use the canonical zone names from Microsoft Learn "
        "(privatelink.blob.core.windows.net etc.) — never invent them."
    ),
    "network_firewall": (
        "**Azure Firewall.** Premium tier for TLS inspection / IDPS; Standard sufficient for "
        "L3/L4 + threat-intel deny. Always pair with Firewall Policy. UDRs in every spoke route "
        "0.0.0.0/0 to the hub firewall private IP."
    ),
    # --- Compute ---
    "compute_aks": (
        "**AKS.** Use System + User node pools; never run workloads on the System pool. Cluster "
        "autoscaler + KEDA for event-driven scale. AKS Automatic (GA) for greenfield when feature "
        "set fits. Workload Identity over pod-identity. Cilium dataplane for new clusters."
    ),
    "compute_vm": (
        "**VM SKU selection.** D-series for general-purpose; E-series for memory-heavy; F-series "
        "for compute-heavy / low memory. Always prefer v5+ generations. Use Trusted Launch for new "
        "deploys; required for Confidential Computing. Spot for stateless batch only."
    ),
    "compute_containerapps": (
        "**Container Apps.** Right surface for HTTP services and event-driven jobs that don't "
        "need cluster-level control. Dapr sidecars for service-to-service. Use workload profiles "
        "(D4/D8/D16) when you need dedicated compute or VNET integration."
    ),
    "compute_appservice": (
        "**App Service.** P1v3/P2v3/P3v3 are the modern SKUs (Av2 deprecated path). Always pair "
        "with VNET integration + private endpoint. Slots for zero-downtime deploys. "
        "App Service Environment v3 only when isolation regulatory-required."
    ),
    # --- Data ---
    "data_sql": (
        "**Azure SQL.** Hyperscale for >4 TB or read-scale; Business Critical for "
        "lowest-latency OLTP; General Purpose for cost-balanced. Always enable TDE with "
        "customer-managed key when regulated. Failover groups for region pairs."
    ),
    "data_cosmos": (
        "**Cosmos DB.** Choose API by access pattern: NoSQL for new builds, Mongo / Cassandra / "
        "Gremlin only for compatibility. Pick the right partition key day one — repartitioning is "
        "data migration. Multi-region writes only when conflict resolution is designed up front."
    ),
    "data_fabric": (
        "**Fabric.** OneLake is the durable substrate; Lakehouse > Warehouse for new "
        "lakehouse-pattern builds. Direct Lake mode in Power BI avoids import refreshes. "
        "Capacity SKUs (F2-F2048) are dial-able at minute granularity — autoscale with care."
    ),
    "data_synapse": (
        "**Synapse vs Fabric.** New greenfield → Fabric. Existing Synapse → migrate by workload "
        "(Pipelines → Data Factory in Fabric; Spark pools → Fabric Spark; Dedicated SQL pool → "
        "Fabric Warehouse or stay on Synapse for now)."
    ),
    "data_postgres": (
        "**Azure Database for PostgreSQL Flexible Server.** Default for new Postgres workloads. "
        "Use Citus extension (Cosmos for Postgres) for horizontal scale. Read replicas same-region "
        "or cross-region; HA via zone-redundant zones in supported regions."
    ),
    # --- AI ---
    "ai_openai": (
        "**Azure OpenAI.** PTU (provisioned throughput) for production with predictable load; "
        "PAYG/standard for dev and burst. Always check region availability by model — gpt-4o vs "
        "gpt-4.1-mini differ. Content filters: configure per deployment, not per request."
    ),
    "ai_search": (
        "**AI Search (formerly Cognitive Search).** Vector + hybrid search for RAG; integrated "
        "vectorization removes the need to roll your own embedding pipeline. Skillsets for "
        "OCR/entity extraction at index time. Use Semantic Ranker for top-5 quality."
    ),
    "ai_foundry": (
        "**Foundry.** Agents Service for the new agent orchestration surface; Evaluations for "
        "continuous quality scoring; AI Hub project as the resource container. Connections "
        "(Azure OpenAI, Search, Blob) are project-scoped, not subscription-scoped."
    ),
    # --- Identity ---
    "identity_entra": (
        "**Entra ID.** Conditional Access with risk-based + device-compliance signals. PIM for "
        "all privileged roles. Workload Identities for service principals; federated credentials "
        "(GitHub Actions, Kubernetes) instead of secrets where possible."
    ),
    "identity_managed_id": (
        "**Managed Identity.** System-assigned for resources with no shared identity surface; "
        "user-assigned when multiple resources need the same identity (e.g. an AKS workload). "
        "Never use service principal secrets when a managed identity works."
    ),
    # --- Landing zone & governance ---
    "lz_caf": (
        "**Cloud Adoption Framework landing zone.** Use ALZ Terraform or ALZ Bicep accelerator; "
        "do not roll your own. Management group hierarchy: Tenant Root → Intermediate → "
        "Platform (connectivity, identity, management) + Landing Zones (corp, online, sandbox)."
    ),
    "lz_policy": (
        "**Azure Policy.** Assign at the management group scope, not subscription. Use Policy "
        "Initiatives for grouped controls (MCSB, regulatory). Audit-mode first; flip to Deny "
        "after a 30-day signal review."
    ),
    # --- Reliability ---
    "reliability_zones": (
        "**Availability Zones.** Use zonal services (zone-redundant or zonal-pinned) by default "
        "in regions that have AZs. Cross-zone is the new minimum for production; cross-region "
        "only for DR (RPO > 0) unless the SLO requires active-active."
    ),
    "reliability_dr": (
        "**DR patterns.** Active-passive with cross-region failover is the default — cheaper "
        "and simpler than active-active. ASR for IaaS, native PaaS geo-replication where "
        "available (SQL failover group, Cosmos multi-region, Storage GRS)."
    ),
    # --- Cost ---
    "cost_reservations": (
        "**Reservations & Savings Plans.** 1y reserved for variable workloads; 3y for "
        "stable. Savings Plan for compute when SKU mix changes. Use `analyze_reservations` "
        "tool to pull live recommendations from the engagement subscription."
    ),
    "cost_rightsizing": (
        "**Right-sizing.** P95 < 40% sustained CPU over 14 days is the threshold to "
        "downsize. Use `recommend_rightsizing` to pull live Monitor metrics; never recommend "
        "from memory."
    ),
    # --- Security ---
    "security_defender": (
        "**Defender for Cloud.** Plan 2 for Servers, Plan 1 for most PaaS. Always enable "
        "Foundational CSPM for free; pay for Defender CSPM only when attack-path analysis "
        "and agentless scanning are required."
    ),
    "security_keyvault": (
        "**Key Vault.** Purge protection on for regulated workloads (irreversible). RBAC over "
        "access policies. Premium SKU only when HSM-backed keys are mandated. Always pair "
        "with private endpoint."
    ),
    # --- IaC ---
    "iac_bicep": (
        "**Bicep.** Default to AVM modules; only write raw resources when no AVM exists. "
        "What-if before deploy. Use deployment stacks for managed resource sets. Compile to "
        "JSON for review in pipelines."
    ),
    "iac_terraform": (
        "**Terraform.** AzureRM provider 4.x. Use AzureRM AVM modules where parity exists. "
        "Backend in Azure Storage with state locking. azapi for resources not yet in azurerm."
    ),
    # --- Migration ---
    "migration_assess": (
        "**Migration assessment.** Azure Migrate Discovery & Assessment for VM rightsizing. "
        "Database Migration Assistant (or DMS) for SQL/Postgres/MySQL. Always pair an "
        "assessment with a business-case dependency map before sizing."
    ),
    # --- Compliance frameworks ---
    "compliance_pci": (
        "**PCI-DSS.** Defender for Cloud regulatory compliance dashboard maps controls. "
        "Network segmentation must isolate the CDE. Logs must retain 1 year, 3 months online. "
        "Quarterly internal + annual external scans."
    ),
    "compliance_hipaa": (
        "**HIPAA / HITRUST.** BAA required (Azure has one). Always encrypt at rest + in "
        "transit with customer-managed keys. Audit logs retained 6 years. Use Defender "
        "regulatory compliance overlay for HIPAA HITRUST."
    ),
    "compliance_fedramp": (
        "**FedRAMP / Gov.** Use Azure Government cloud, not commercial, for High baseline. "
        "Moderate baseline can run in commercial with appropriate controls. ATO inheritance "
        "from Microsoft's authorization where applicable."
    ),
    # --- Observability ---
    "observability_monitor": (
        "**Monitor + Log Analytics.** One LA workspace per environment + region pair; "
        "centralize via cross-workspace queries. DCRs (data collection rules) over legacy "
        "MMA. Workbooks for shared dashboards."
    ),
    "observability_appinsights": (
        "**Application Insights.** Workspace-based, never classic. Use auto-instrumentation "
        "on App Service / Functions / AKS where supported. Sampling at 5-10% in high-volume "
        "production to keep ingestion cost predictable."
    ),
}


def get_fragments(names: list[str]) -> str:
    """Return the concatenated bodies of the named fragments. Unknown
    names are silently skipped — the router is allowed to be loose."""
    parts: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        body = FRAGMENTS.get(name)
        if body:
            parts.append(body)
    if not parts:
        return ""
    return "## Relevant Domain Notes\n\n" + "\n\n".join(parts) + "\n"


def fragment_names() -> list[str]:
    return sorted(FRAGMENTS.keys())


__all__ = ["FRAGMENTS", "fragment_names", "get_fragments"]
