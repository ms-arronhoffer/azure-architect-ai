def build_runbook(
    arch_name: str,
    overview: str,
    components: list[dict],
    deployment_steps: list[dict] | None = None,
) -> str:
    """Return a markdown runbook for the architecture, using LLM-supplied deployment steps when available."""
    services = "\n".join(f"- {c['label']}" for c in components)

    if deployment_steps:
        steps_md = _render_deployment_steps(deployment_steps)
    else:
        steps_md = _generic_deployment_steps()

    return f"""# Runbook: {arch_name}

## Overview
{overview}

## Services Involved
{services}

## Prerequisites
- Azure subscription with Contributor or Owner role on the target resource group
- Azure CLI >= 2.60 installed and authenticated (`az login`)
- Bicep CLI >= 0.28 (installed automatically with Azure CLI)
- Tooling specific to workload (e.g., `kubectl` for AKS, `func` for Azure Functions)

## Deployment Steps
{steps_md}

## Operational Procedures

### Scaling
- Review autoscale metrics weekly for the first month post-launch.
- Set scale-out rules at 70% CPU/memory; scale-in at 30% with a 5-minute cooldown.

### Backup & Recovery
- Enable soft-delete and geo-redundant backups for all data services.
- Test restore procedure monthly; document RTO/RPO targets.

### Incident Response
1. Check Azure Service Health for platform incidents.
2. Review Application Insights alerts and Log Analytics queries.
3. Escalate to on-call rotation if SLA breach imminent.

## Monitoring & Alerting
| Signal | Threshold | Action |
|--------|-----------|--------|
| Availability | < 99.5% | Page on-call |
| Error rate | > 1% over 5 min | Alert team |
| CPU | > 80% sustained | Trigger scale-out |
| Cost | > 110% of budget | Alert FinOps |

## Cost Optimization
- Purchase Reserved Instances for predictable baseline compute (1-year minimum).
- Enable Azure Advisor recommendations and review monthly.
- Tag all resources with `env`, `owner`, `costcenter` for chargeback.

## Well-Architected Review Checklist
- [ ] **Reliability**: geo-redundancy configured, health probes active, backup tested
- [ ] **Security**: private endpoints, no public IPs on data services, secrets in Key Vault
- [ ] **Cost**: budgets and alerts set, reserved instances evaluated, right-sizing reviewed
- [ ] **Operations**: diagnostics enabled, deployment pipeline automated, runbook tested
- [ ] **Performance**: caching layer in place, CDN for static assets, autoscale configured
"""


def _render_deployment_steps(steps: list[dict]) -> str:
    sections: list[str] = []
    current_phase = None
    for step in steps:
        phase = step.get("phase", "")
        service = step.get("service", "")
        description = step.get("description", "")
        commands = step.get("commands", [])

        if phase != current_phase:
            sections.append(f"\n### {phase}")
            current_phase = phase

        sections.append(f"\n**{service}**")
        if description:
            sections.append(description)
        if commands:
            sections.append("```bash")
            sections.extend(commands)
            sections.append("```")

    return "\n".join(sections)


def _generic_deployment_steps() -> str:
    return """
### Phase 1 — Foundation
1. Create resource group:
   ```bash
   az group create --name <rg-name> --location <region>
   ```
2. Assign managed identities and RBAC roles before deploying dependent services.
3. Deploy shared networking (VNet, subnets, NSGs, route tables).

### Phase 2 — Core Services
1. Deploy data layer resources (databases, storage, caches) first.
2. Configure private endpoints for all PaaS services.
3. Store connection strings and secrets in Key Vault.

### Phase 3 — Application Layer
1. Deploy application services referencing Key Vault secrets via managed identity.
2. Configure health probes, autoscale rules, and diagnostic settings.
3. Wire load balancing and API routing.

### Phase 4 — Security Hardening
1. Enable Microsoft Defender for Cloud on the subscription.
2. Enforce TLS 1.2+ and disable public access on data services.
3. Configure Azure Policy assignments for compliance baseline.
4. Enable diagnostic logs → Log Analytics workspace.
"""
