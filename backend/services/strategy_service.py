import asyncio
import json
import re
from typing import Any, AsyncGenerator

_BASE_FRAMEWORK = """
## Foundational IT Strategy Framework
A robust IT strategy is a bridge between business goals and the technology needed to achieve them — not just a list of hardware or software requirements. It must be dynamic, repeatable, and aligned with organizational culture. This strategy must be grounded in all five of the following foundational pillars:

**1. Business Alignment & Governance** — Define strategic objectives (scalability, cost reduction, customer experience, digital transformation). Establish decision-making governance: who decides the tech stack, how projects are prioritized. Set compliance and security guardrails (SOC 2, HIPAA, GDPR, etc.) that all workloads must satisfy. Determine the investment model (OpEx vs. CapEx) and how ROI is measured.

**2. Infrastructure & Cloud Strategy** — Define the cloud philosophy (Cloud-First, Hybrid, or Multi-Cloud) and criteria for PaaS vs. IaaS vs. SaaS. Build Internal Developer Platforms (IDPs) as the "paved road": standardized environments (Kubernetes clusters, managed databases, CI/CD pipelines) so teams deploy safely without reinventing the wheel. Establish network and connectivity standards (VPNs, BGP routing, cross-environment secure data flow).

**3. Data & Application Architecture** — Enforce API-First design: every internal service is a product with an OpenAPI contract. Define data lifecycle management (Single Source of Truth, data mastering, protection patterns). Adopt event-driven architecture where appropriate (Azure Event Hubs, Service Bus, Kafka). Ensure AI/ML readiness: clean, tagged, authenticated data accessible to AI agents via secure APIs.

**4. Operational Excellence (DevOps & Security)** — Mandate unified observability (monitoring, logging, distributed tracing via OpenTelemetry). Embed security-by-design (DevSecOps): automated scanning, vulnerability management, and IAM integrated directly into CI/CD pipelines. Automate every repeated operational task via Infrastructure-as-Code (Terraform, Bicep, Pulumi).

**5. Talent & Culture** — Conduct a skill gap analysis to identify training needs (AI/ML, cloud architecture, security compliance). Build a documentation culture: a living internal wiki or developer portal where standards are discoverable. Apply the 70/20/10 model: 70% maintaining current systems, 20% improving existing processes, 10% experimenting with new technologies.

## Executive-Level Strategic Requirements
A complete, CIO/CTO-grade strategy must address all ten of the following dimensions. Weave these throughout the pillars, capability map, WAF alignment, risk register, and roadmap — they are not optional extras but mandatory elements of a complete strategy:

**FinOps & Financial Model** — Define unit economics (cost per transaction, per user, per deployment). Establish a chargeback/showback model for team accountability. Build a 3-year TCO model comparing baseline vs. target state. Set FinOps KPIs: cloud cost as % of revenue, Reserved Instance/Savings Plan coverage %, cost per deployment. Use Azure Cost Management + Billing, Azure Advisor cost recommendations, and enforce tagging policies for allocation.

**Measurable Outcomes — OKRs, KPIs & DORA Metrics** — Every initiative must have a measurable objective with key results. Define platform KPIs: deployment frequency, lead time for changes, MTTR, change failure rate (DORA four key metrics). Set SLO targets (availability %, P99 latency, error budget). Link business outcomes to technical metrics — what is the revenue impact of each 9 of availability? Use Azure Monitor, Application Insights, and integrate DORA dashboards into engineering scorecards.

**Regulatory & Compliance Roadmap** — Document current compliance posture vs. target posture with a gap-remediation timeline. Address data sovereignty requirements (which data can leave which regions, data residency controls). Establish an audit readiness cadence: quarterly internal reviews, annual external audits. Plan for regulatory change management — how the org absorbs new requirements (EU AI Act, DORA financial regulation, state privacy laws). Use Microsoft Purview, Azure Policy, and Defender for Cloud regulatory compliance dashboards.

**Stakeholder & Change Management** — Identify executive sponsors for each strategic pillar by name and role. Map organizational resistance: who will resist change, why, and define specific mitigation strategies. Define adoption metrics: training completion %, feature flag rollout %, ticket deflection rates, time-to-value for new capabilities. Establish a communication cadence: monthly steering committee, quarterly business reviews, annual strategy refresh. Change management failure is as likely a delivery risk as technical failure.

**Vendor & Third-Party Risk Management** — Assess lock-in risk for every proprietary service in the capability map (score H/M/L). Maintain a Software Bill of Materials (SBOM) for all open-source and third-party components with CVE monitoring. Define exit strategies and minimum contractual escape clauses for top three vendors. Evaluate vendor financial health and roadmap alignment annually. Use Azure Policy to enforce approved service lists and Microsoft Defender for supply chain risk.

**Application Portfolio & Technical Debt Management** — Rationalize the existing application portfolio against the new strategy: retain, retire, replatform, or rearchitect each workload. Quantify technical debt in effort-weeks and risk exposure. Build a debt remediation roadmap integrated with the release calendar with explicit quarterly targets. Establish debt budgets per team: no sprint ends with net-positive debt growth. Use Azure Migrate for portfolio assessment and define modernization waves.

**Business Continuity & Resilience** — Define explicit RTO and RPO targets per workload criticality tier (mission-critical, important, standard). Document failover runbooks and require quarterly live DR testing — not just tabletop exercises, but live cutover tests. Establish a crisis communication protocol for major incidents. Plan for cascading failure scenarios: what happens if the primary region fails during peak load? Use Azure Site Recovery, Traffic Manager, Front Door, and availability zones as the default resilience stack.

**AI & GenAI Governance** — Define a Responsible AI framework: fairness, reliability, privacy, transparency, and accountability controls. Establish model risk management: versioning, drift detection, bias audits, and rollback procedures. Set LLM data handling policies: no PII in prompts, no training on customer data without consent, prompt injection defenses. Create an AI center of excellence to govern GenAI adoption and prevent uncontrolled shadow AI. Use Azure AI Foundry, Responsible AI dashboards, and Azure OpenAI content filtering policies.

**Innovation Portfolio & Technology Horizon Scanning** — Apply a formal POC governance model: every experiment has a defined hypothesis, success criteria, budget cap, and sunset date. Maintain a technology radar (adopt/trial/assess/hold) updated semi-annually with input from engineering leads. Reserve 10% of engineering capacity for innovation. Align innovation investments to business strategy — AI experiments must map to measurable business outcomes within 90 days. Use Azure Innovation programs and Microsoft Garage principles.

**Sustainability & ESG** — Measure and report cloud carbon footprint using the Microsoft Emissions Impact Dashboard integrated into executive reporting. Set targets for carbon intensity reduction aligned to organizational ESG commitments. Prefer renewable-energy-powered Azure regions (Sweden Central, West US 2, North Europe). Optimize for energy efficiency: right-size workloads, use spot/preemptible compute for batch, implement auto-shutdown policies for dev/test environments. Align with Green Software Foundation Sustainable Web Design principles.
"""

_SCHEMA = """{
  "executive_summary": "3-paragraph markdown narrative here",
  "strategic_pillars": [
    {"name": "Example Pillar", "description": "1-2 sentence description.", "rationale": "Azure-specific rationale referencing real services."}
  ],
  "capability_map": [
    {"capability_area": "Compute", "azure_services": ["Azure Kubernetes Service", "Azure Container Apps"], "justification": "Why these services.", "alternatives": ["Azure App Service"]}
  ],
  "waf_alignment": {
    "reliability": {"status": "Strong", "score": 4, "recommendations": ["Recommendation 1.", "Recommendation 2."]},
    "security": {"status": "Adequate", "score": 3, "recommendations": ["Recommendation 1.", "Recommendation 2."]},
    "cost_optimization": {"status": "Gap", "score": 2, "recommendations": ["Recommendation 1.", "Recommendation 2."]},
    "operational_excellence": {"status": "Strong", "score": 4, "recommendations": ["Recommendation 1.", "Recommendation 2."]},
    "performance_efficiency": {"status": "Adequate", "score": 3, "recommendations": ["Recommendation 1.", "Recommendation 2."]},
    "overall_score": 3
  },
  "risk_register": [
    {"risk": "Example risk description.", "category": "Technical", "impact": "H", "likelihood": "M", "mitigation": "Specific mitigation action."}
  ],
  "strategic_roadmap": [
    {
      "phase": "Phase 1 – Foundation (Months 1–6)",
      "focus": "One-sentence description of this phase's primary objective.",
      "key_initiatives": ["Initiative 1", "Initiative 2", "Initiative 3", "Initiative 4"],
      "success_metrics": ["Measurable metric 1", "Measurable metric 2", "Measurable metric 3"]
    }
  ],
  "references": [
    {"title": "Azure Well-Architected Framework Overview", "url": "https://learn.microsoft.com/en-us/azure/well-architected/"}
  ]
}"""


def _get_workload_supplement(workload_type: str) -> str:
    wt = workload_type.lower()
    if "api" not in wt:
        return ""
    return """
## API Governance Framework
This strategy is for an API Platform. Structure ALL sections (pillars, capability map, WAF, risks) around these four governance pillars and the phased maturity model below.

### Four Governance Pillars
**1. Design & Standardization** — API-First mandate (OpenAPI/AsyncAPI spec before code), centralized Schema Registry (versioning, discoverability, strict typing), style guides enforced via Spectral linting (naming conventions, RFC 7807 error handling, URI vs. header versioning strategy).

**2. Operational Lifecycle Management** — Service Catalog as single source of truth (owner, version, lifecycle status: Alpha/Beta/GA/Deprecated), CI/CD gates with contract testing (Pact) and DAST/SAST scanning, standardized observability (OpenTelemetry traces, uniform logging and metrics across all APIs).

**3. Security & Access Control** — Centralized IAM using OIDC/OAuth 2.0 (no home-grown auth), API Gateway layer (Azure API Management) for rate limiting, IP allow-listing, JWT validation and scope enforcement, threat protection at the edge (injection, credential stuffing, scraping detection).

**4. Developer Experience (DX) & Adoption** — Self-service developer portal for key provisioning, documentation, and API discovery (prevents shadow IT), "Paved Road" model providing boilerplate, SDKs, and Terraform modules pre-configured with security/logging standards, federated governance (domain leads own compliance, central office sets vision and tooling).

### Phased Maturity Model
- **Phase 1 – Visibility:** Service catalog + design standards
- **Phase 2 – Security:** Centralized auth + API Gateway (APIM)
- **Phase 3 – Automation:** CI/CD gates, Spectral linting, contract testing (Pact)
- **Phase 4 – Optimization:** Developer portal + federated governance

### Required Output Mapping
- **Strategic Pillars (5):** Map to the 4 governance pillars + 1 unifying "Platform Vision & Federated Governance" pillar.
- **Capability Areas (6):** API Design & Specification, Schema Registry & Versioning, API Gateway & Policy Enforcement (APIM), Identity & Access Management, Developer Portal & Adoption, Observability & Operations.
- **WAF Alignment:** Frame reliability around contract testing and versioning; security around OAuth 2.0 + APIM policies; cost optimization around APIM tier selection and consumption models; operational excellence around CI/CD gates and the service catalog; performance efficiency around caching policies and backend pooling.
- **Risk Register:** Cover API sprawl/shadow IT, versioning breaking changes, credential leakage, governance adoption resistance, and observability gaps.
- **References:** Include links to Azure APIM documentation, OpenTelemetry on Azure, Entra ID OAuth 2.0, Azure API Center, and the WAF for API Management.
"""


def _build_prompt(inputs: dict) -> str:
    ctx_parts = []
    if inputs.get("region"):
        ctx_parts.append(f"Primary Azure Region: {inputs['region']}")
    if inputs.get("compliance"):
        ctx_parts.append(f"Compliance Framework: {inputs['compliance']}")
    if inputs.get("budget"):
        ctx_parts.append(f"Monthly Budget: {inputs['budget']}")
    if inputs.get("team_size"):
        ctx_parts.append(f"Team Size: {inputs['team_size']}")
    context_block = "\n".join(ctx_parts) if ctx_parts else "No global context provided."

    drivers_list = ", ".join(inputs.get("business_drivers", [])) or "Not specified"
    supplement = _get_workload_supplement(inputs.get("workload_type", ""))
    supplement_block = f"\n{supplement}" if supplement else ""

    return f"""You are a Principal Azure Solutions Architect with deep expertise in enterprise cloud strategy.
A customer has requested a comprehensive Azure strategy document. Produce world-class, specific, actionable guidance.

## Workload Profile
- Name: {inputs.get("workload_name", "Not specified")}
- Type: {inputs.get("workload_type", "Not specified")}
- Description: {inputs.get("description", "Not specified")}

## Strategic Context
- Business Drivers: {drivers_list}
- Success Criteria: {inputs.get("success_criteria", "Not specified")}
- Timeline Horizon: {inputs.get("timeline", "Not specified")}

## Constraints
- Current Maturity: {inputs.get("maturity", "Not specified")}
- Key Constraints: {inputs.get("constraints", "None stated")}

## Organizational Context
{context_block}
{_BASE_FRAMEWORK}{supplement_block}

## Instructions
Generate a complete Azure strategy document with:
1. **Executive Summary**: 3 paragraphs covering: (a) strategic approach and business alignment with organizational objectives, (b) key architectural decisions and recommended Azure services, and (c) expected outcomes including measurable KPIs, FinOps model, and compliance posture. Use markdown (bold for emphasis, bullet points where appropriate).
2. **Strategic Pillars**: Exactly 5 pillars mapped to the Foundational IT Strategy Framework above — Business Alignment & Governance, Infrastructure & Cloud Strategy, Data & Application Architecture, Operational Excellence, and Talent & Culture — adapted to this specific workload type and Azure context. Each must include Azure-specific rationale referencing real services or patterns. Weave in the 10 Executive-Level Strategic Requirements where appropriate.
3. **Capability Map**: Exactly 6 capability areas covering the workload lifecycle. Each must list specific Azure service names (e.g., "Azure Kubernetes Service", not "containers"), a concise justification aligned to the business drivers, and 1-2 realistic alternatives.
4. **WAF Alignment**: For each of the 5 Azure Well-Architected Framework pillars, assess the strategy coverage. Score 1-5 (1=major gaps, 5=fully addressed). Provide exactly 2 specific, actionable recommendations per pillar. Set "overall_score" as the integer average.
5. **Risk Register**: Exactly 5 risks specific to this workload type and maturity level. Include a mix of technical, organizational, and compliance categories. Mitigations must be concrete Azure patterns or actions. Use "H", "M", or "L" for impact and likelihood.
6. **Strategic Roadmap**: Exactly 4 implementation phases sequenced by dependency and risk (e.g., Foundation → Security & Compliance → Automation & Scale → Optimization & Innovation). Each phase must include: a phase name with timeframe (e.g., "Phase 1 – Foundation (Months 1–6)"), a single-sentence focus statement, 4–6 key initiatives drawn directly from the pillars and capability map, and 3–4 measurable success metrics tied to the KPI/OKR and FinOps frameworks. Phases must build on each other — each phase assumes the prior is complete.
7. **Reference Links**: Include exactly 8-10 real, valid learn.microsoft.com URLs that directly support the recommendations in this strategy. Each entry must have a descriptive title and a URL beginning with https://learn.microsoft.com/. Choose URLs relevant to the specific Azure services, WAF pillars, and risk mitigations in this response.

Calibrate guidance to the stated maturity level — greenfield gets foundational guidance, cloud-optimizing gets advanced patterns.
Align all service recommendations to the stated region and compliance framework.

IMPORTANT: Return ONLY valid JSON. No markdown code fences, no preamble, no text before or after the JSON object.
Follow the structure of this example exactly (replace all example values with real content):
{_SCHEMA}"""


def _draft_sync(inputs: dict, client: Any, deployment: str) -> dict:
    prompt = _build_prompt(inputs)
    response = client.chat.completions.create(
        model=deployment,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        stream=True,
    )

    accumulated = ""
    for chunk in response:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content or ""
        accumulated += delta

    raw = accumulated.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Model did not return valid JSON. Raw response starts with: {raw[:300]}")


async def stream_strategy(inputs: dict, client: Any, deployment: str) -> AsyncGenerator[str, None]:
    try:
        result = await asyncio.to_thread(_draft_sync, inputs, client, deployment)
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"
        return
    yield f"data: {json.dumps({'type': 'strategy_result', 'result': result})}\n\n"
    yield "data: [DONE]\n\n"
