# User Guide

Azure Architect AI is a chat-driven assistant for Azure architects. This guide walks through the UI, every mode, and worked example prompts.

## The UI

Open `http://localhost:5173` (dev) or the deployed Front Door URL.

- **Mode picker** (top of sidebar) — switch between the LLM-driven chat modes (defined in `backend/tools/tool_definitions.py:TOOLS_BY_MODE`)
- **Conversation list** — persisted in the DB (`Conversation` model in `backend/db.py`)
- **Chat pane** — streams typed SSE events; structured payloads render as cards (`frontend/src/components/chat/StructuredResultCard.tsx`)
- **Settings panel** — provider + model picker, GitHub token entry, RAG toggle (`frontend/src/hooks/useSettings.ts`)
- **Export menu** — Markdown, JSON, PPTX (`frontend/src/utils/`)

## Modes

Chat modes are defined in `backend/tools/tool_definitions.py:TOOLS_BY_MODE`. Each one binds a tool catalog (and most a system-prompt template) for that workflow. The tables below cover the most-used modes; the canonical list lives in code.

### General / reference

| Mode | Use case |
| --- | --- |
| `qa` | Open-ended Q&A about Azure, grounded by Learn docs |
| `reference` | Doc-anchored lookups (cites Learn URLs) |
| `compare` | Side-by-side service comparison |
| `certprep` | Practice exam generation for AZ-XXX certs |
| `learningplan` | N-week learning roadmap with milestones |

### Architecture and design

| Mode | Use case |
| --- | --- |
| `architecture` | Full architecture: design, Bicep + Terraform + ARM, cost, ADR, diagram |
| `aiarchitecture` | AI/ML reference architecture (Foundry, vector stores, RAG) |
| `dataplatform` | Lakehouse / Synapse / Fabric data platform |
| `apim` | API Management front-end designs |
| `network` | VNet topology / hub-spoke / Virtual WAN |
| `landingzone` | CAF landing zone (uses doc pre-fetch) |
| `identity` | RBAC + Entra ID design |
| `bootstrap` | Minimal greenfield bootstrap stack |

### Review and assessments

| Mode | Use case |
| --- | --- |
| `waf` | Well-Architected pillar assessment (uses doc pre-fetch) |
| `review` | Architecture review |
| `compliance` | Map design to NIST / CIS / PCI / HIPAA |
| `migration` | Lift-shift / replatform / refactor assessment |
| `regional` | Region selection + comparison |
| `threatmodel` | STRIDE threat register (uses doc pre-fetch) |
| `securityposture` | Defender + policy compliance roll-up |

### Operations

| Mode | Use case |
| --- | --- |
| `cost` | Cost estimate from architecture description |
| `finops` | TCO + cost alert emitter |
| `tco` | Detailed TCO report (3-year) |
| `drbc` | DR/BC strategy (uses doc pre-fetch) |
| `reliability` | SLO framework + monitoring (uses doc pre-fetch) |
| `monitoring` | Monitoring config (Log Analytics, App Insights, Action Groups) |
| `sizing` | SKU recommendations (uses doc pre-fetch) |
| `troubleshoot` | Diagnose issue + KQL queries + remediation runbook |
| `devops` | CI/CD pipeline design |
| `devsecops` | Pipeline + IaC + security gates |
| `multicloud` | AWS / GCP equivalents |

### Workflow helpers

| Mode | Use case |
| --- | --- |
| `situation` | Stakeholder situation analysis + plan |
| `presentation` | Slide deck outline + review |
| `codegen` | Generate boilerplate code files |
| `intake` / `intakechat` | Pre-chat workload intake to capture requirements before designing |
| `strategy` | High-level cloud strategy / roadmap |
| `whatsnew` | Recent Azure release notes summary |
| `rfpproposal` | Draft RFP / proposal sections |
| `runbookstudio` | Operational runbook authoring |

### Data + AI authoring

| Mode | Use case |
| --- | --- |
| `fabricplanner` | Microsoft Fabric workload plan |
| `adfpipeline` | Azure Data Factory pipeline design |
| `medalliondesigner` | Bronze / silver / gold medallion lakehouse design |
| `pipelineforge` | General data pipeline scaffolding |
| `modellifecycle` | LLM model lifecycle / governance |
| `modelmigration` | Model migration plan (e.g. v1 → v2 deployment) |
| `namingstandards` | CAF naming standard authoring + validation |
| `servicehealth` | Live Service Health + Resource Health roll-up |

## Curated libraries

Two side panels surface a curated catalog of Microsoft-authored content. Both panels are non-LLM — they read directly from local DB tables refreshed weekly by the ingest jobs.

### Reference Architecture library (`refarch` panel)

Sources entries from the Microsoft Learn ContentBrowser API. ~220 entries on a fresh ingest. Filter by category, tag, "featured", or free-text query. Toggle the **Featured** star to pin an entry; the toggle persists across weekly refreshes.

### Demo Showcase (`showcase` panel)

Sources entries from `Azure/awesome-azd` (msft-tagged templates only). ~214 entries on a fresh ingest. Same filter + featured-toggle UX as the refarch library.

### Source-aware editing

Both libraries enforce the same mutation rules at the API layer:

- **`microsoft_official`** rows (ingested from Microsoft Learn / awesome-azd) — read-only except for the user-toggled `featured` flag. Edit and Delete buttons are hidden in the UI.
- **`community`** rows — same read-only treatment as `microsoft_official`.
- **`custom`** rows — fully editable / deletable. Use these to author your own entries.

Operators with the `Metrics.Read` Entra app role can trigger an immediate refresh via `POST /api/refarch/ingest` or `POST /api/demos/ingest` (see [docs/API.md](API.md#reference-architecture-library)).

## Worked examples

### 1. End-to-end architecture (mode: `architecture`)

Prompt:

> Design a multi-region, zone-redundant web API for a fintech. Backend in Container Apps, Postgres Flex Server with HA, Azure OpenAI for fraud-scoring, Key Vault, Front Door + WAF. Target 99.95% SLO, PCI DSS in scope.

Expected SSE stream (`backend/routes/architecture.py`):

```
status     -> "Designing architecture..."
token      -> incremental LLM tokens
diagram    -> draw.io XML for embedded diagram
bicep      -> { files: [{name, content}, ...] }
terraform_files -> [{name, content}, ...]
arm_files  -> [{name, content}, ...]
cost_estimate -> table + monthly total
adr        -> Architecture Decision Record markdown
project_timeline -> phased milestones
citations  -> [{title, url}, ...]
```

### 2. Threat model (mode: `threatmodel`)

Prompt:

> Generate a STRIDE threat register for an Azure-hosted patient portal: APIM front, Functions backend, Cosmos DB, Entra ID auth, Storage for blob uploads, App Insights.

Output cards: `threat_register` (per-component STRIDE entries with mitigation references), `waf_pillar` (Security pillar score), `citations`.

### 3. Cost estimate from description (mode: `cost`)

Prompt:

> Estimate monthly cost: AKS Standard with 5x D4s_v5 nodes, Azure SQL GP_S_Gen5_4, 1 TB premium blob, 2x P1v3 App Service plans, Azure Front Door Standard, Log Analytics 50 GB/day.

Output cards: `cost_estimate` (SKU table + monthly subtotals + grand total), `citations`. The pricing data lookup lives in `backend/services/pricing_service.py`.

### 4. Landing zone (mode: `landingzone`)

Prompt:

> Design a CAF-aligned platform landing zone for a 3-business-unit enterprise. Hub-spoke, Azure Firewall Premium, ExpressRoute, central log analytics, Entra ID + PIM, Azure Policy denying public IPs.

The mode is in `PREFETCH_MODES`, so Learn docs on CAF / management groups are pulled before the LLM call. Output cards: `landing_zone_design` (mgmt group hierarchy, subscription pattern, policy assignments), `naming_validation`, `bicep` files (optional), `citations`.

### 5. Troubleshoot + KQL (mode: `troubleshoot`)

Prompt:

> AKS workload `payments-api` is throwing 502s after the last deploy. Pods restart every 5 min. Help me diagnose and give me KQL.

Output cards: `diagnosis` (probable causes ranked), `kql_queries` (ContainerLog, ContainerInventory, AppRequests), `remediation_runbook` (step-by-step), `citations`.

### 6. SLO framework (mode: `reliability`)

Prompt:

> Define SLOs for a Container Apps + Postgres + Service Bus order-processing pipeline. Customer expects 99.9% checkout availability, p95 latency under 800ms, error budget policy that triggers a freeze at 50% burn.

Output cards: `slo_framework` (SLIs, SLOs, error budget policy, alert thresholds), `monitoring_config`, `citations`.

### 7. CI/CD pipeline (mode: `devops`)

Prompt:

> Generate a GitHub Actions workflow that: lints, runs Python + Vitest tests, builds two container images, runs Trivy scan, deploys to a Container Apps `staging` revision with a manual approval gate before promoting to `prod`.

Output cards: `pipeline_design` (stages + gates), `cicd_files` (YAML), `citations`. CI/CD emission is implemented in `backend/services/cicd_emitter.py`.

### 8. Multicloud equivalents (mode: `multicloud`)

Prompt:

> Map this Azure stack to AWS and GCP: AKS, Azure SQL, Key Vault, Front Door, Service Bus, Cosmos DB, Application Insights, Azure Files.

Output card: `multicloud_comparison` (3-column equivalents table with key differences). Implementation in `backend/services/multicloud_service.py`.

## Tips

- **Mode selection matters**: a `cost` mode prompt sent in `qa` mode skips the cost tool entirely.
- **Doc pre-fetch modes** (landingzone, threatmodel, reliability, sizing, drbc, waf) anchor every answer to Microsoft Learn citations — use them when accuracy matters.
- **Conversations persist**: switch modes within the same conversation to chain (e.g. design → threat-model → cost).
- **Export** any reply to Markdown (clipboard / file) or to a `.pptx` slide deck via the menu.
- **Live scan**: the resource picker (`/api/scan/resources`) is non-LLM — it reads your subscription via Azure Resource Graph (`backend/services/azure_scan_service.py`).
- **Settings → provider** lets you switch to GitHub Copilot or GitHub Models (requires a stored PAT — set via `/api/auth/github-token`).

## Limitations

- The `multicloud` comparison is heuristic mappings; verify against vendor docs.
- Cost estimates use cached SKU pricing — re-confirm with the Azure Pricing Calculator before contractual commitments.
- The deterministic IaC emitters cover the bundled reference archs (`backend/data/reference_archs.py`); arbitrary user descriptions go through the LLM and may need manual fix-up. The ingested Reference Architecture library is browsing-only and does not feed the IR pipeline.
- Some modes (`qa`, `codegen`, `devops`, `finops`, `securityposture`, `multicloud`) currently have no dedicated system-prompt template — they fall through to the default (`backend/prompts/system_prompt.py`).
