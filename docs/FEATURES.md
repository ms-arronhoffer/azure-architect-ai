# Features

Azure Architect AI exposes 39 LLM-callable tools across 23 domain modules under `backend/tools/domains/`. Each tool is a JSON schema (OpenAI function-calling format) that the model decides to invoke; the dispatch happens in `backend/routes/chat.py` and `backend/routes/architecture.py`. Tools producing structured output emit a typed SSE event so the frontend can render them as cards.

## Tool catalog (39)

### Architecture (`architecture.py`)

| Tool | Purpose |
| --- | --- |
| `design_architecture` | Propose a full architecture given workload requirements |
| `generate_adr` | Produce an Architecture Decision Record markdown |

### Bicep / IaC bridge (`bicep.py`, `iac.py`)

| Tool | Purpose |
| --- | --- |
| `generate_bicep` | Emit Bicep files for a designed architecture |
| `generate_terraform` | Emit Terraform HCL files |
| `generate_arm` | Emit ARM JSON template |

### Code generation (`codegen.py`)

| Tool | Purpose |
| --- | --- |
| `generate_code_files` | Boilerplate code (handlers, clients, manifests) |
| `generate_cicd_pipeline` | GitHub Actions / Azure DevOps YAML |

### Service comparison (`comparison.py`)

| Tool | Purpose |
| --- | --- |
| `compare_services` | Side-by-side Azure service comparison |
| `compare_regions` | Region capability + latency comparison |
| `recommend_service` | Recommend the best service for a stated need |

### Compliance (`compliance.py`)

| Tool | Purpose |
| --- | --- |
| `map_compliance` | Map architecture controls to NIST / CIS / PCI / HIPAA |

### Cost (`cost.py`)

| Tool | Purpose |
| --- | --- |
| `estimate_costs` | Estimate monthly Azure cost from an architecture |
| `generate_tco_report` | 3-year TCO with on-prem vs. Azure comparison |

### DevSecOps (`devsecops.py`)

| Tool | Purpose |
| --- | --- |
| `design_pipeline` | Pipeline architecture: stages, gates, environments |
| `design_cost_alerts` | Budget + cost-anomaly alert definitions |
| `assess_security_posture` | Security posture summary (Defender + policy) |

### DR / BC (`drbc.py`)

| Tool | Purpose |
| --- | --- |
| `design_dr_strategy` | RTO / RPO targets, regional pairing, failover plan |

### Governance (`governance.py`)

| Tool | Purpose |
| --- | --- |
| `design_landing_zone` | CAF-aligned landing zone |
| `validate_resource_naming` | Validate names against CAF naming conventions |
| `suggest_resource_name` | Suggest a compliant name |
| `compare_clouds` | Multi-cloud (AWS / GCP) equivalence |
| `generate_project_timeline` | Phased project plan with milestones |

### Learning (`learning.py`)

| Tool | Purpose |
| --- | --- |
| `generate_learning_plan` | N-week study plan toward a goal |
| `generate_practice_exam` | Cert-style practice exam (AZ-XXX) |

### Migration (`migration.py`)

| Tool | Purpose |
| --- | --- |
| `assess_migration` | Rehost / replatform / refactor recommendation per workload |

### Monitoring (`monitoring.py`)

| Tool | Purpose |
| --- | --- |
| `generate_monitoring_config` | Log Analytics + App Insights + alert rules |
| `define_slo_framework` | SLIs, SLOs, error-budget policy |
| `diagnose_issue` | Root-cause hypothesis ranking |
| `generate_kql_queries` | KQL queries scoped to a workload |
| `generate_remediation_runbook` | Step-by-step remediation runbook |

### Network (`network.py`)

| Tool | Purpose |
| --- | --- |
| `design_network_topology` | Hub-spoke / vWAN topology |

### Operations / scanning (`operations.py`)

(Tools wrap live Azure scanning + reporting utilities; see also `services/azure_scan_service.py`, `services/cost_anomaly_service.py`.)

### Presentation (`presentation.py`)

| Tool | Purpose |
| --- | --- |
| `generate_deck_outline` | Slide-deck outline (sections + slide titles) |
| `review_deck_outline` | Review and tighten an existing deck outline |

### Project (`project.py`)

(Project-management helpers; `generate_project_timeline` is exposed via `governance.py`.)

### QA / docs (`qa.py`)

| Tool | Purpose |
| --- | --- |
| `search_azure_docs` | Microsoft Learn search (`backend/services/docs_service.py`) |

### Security (`security.py`)

| Tool | Purpose |
| --- | --- |
| `design_rbac_model` | RBAC model + role assignments |
| `generate_threat_register` | STRIDE threat register |

### Sizing (`sizing.py`)

| Tool | Purpose |
| --- | --- |
| `recommend_sku` | SKU recommendations (compute, DB, etc.) |

### Stakeholder (`stakeholder.py`)

| Tool | Purpose |
| --- | --- |
| `create_stakeholder_plan` | Stakeholder situation + comms plan |

### Troubleshooting (`troubleshoot.py`)

(Tools also bound via `monitoring.py`: `diagnose_issue`, `generate_kql_queries`, `generate_remediation_runbook`.)

### WAF (`waf.py`)

| Tool | Purpose |
| --- | --- |
| `assess_waf_pillar` | Score / advise on a Well-Architected pillar |

## MCP tools (optional)

When `MCP_ENABLED=true`, the `@azure/mcp` stdio server is spawned at startup (`backend/services/mcp_service.py:init_mcp`). Whitelisted MCP tools are registered with an `mcp_` prefix and merged into the catalog for `_MCP_ENABLED_MODES` (`backend/tools/tool_definitions.py:92`). The whitelist filters which MCP tools are exposed; see `_WHITELIST` in `mcp_service.py`.

## Non-LLM features

These are direct REST endpoints — no model call involved. Useful as building blocks and for non-chat UI panels.

| Feature | Endpoint | Backing service |
| --- | --- | --- |
| Live resource inventory | `GET /api/scan/resources` | `services/azure_scan_service.py` (Azure Resource Graph) |
| Drift detection | `GET /api/scan/drift` | `services/azure_scan_service.py` |
| Month-to-date cost | `GET /api/cost/mtd` | `services/cost_service.py` (Cost Management) |
| Budget Bicep emitter | `POST /api/cost/budget/bicep` | `services/cost_service.py` |
| Cost anomaly KQL | `GET /api/cost/anomaly-kql` | `services/cost_anomaly_service.py` |
| Non-compliant policy items | `GET /api/security/policy/noncompliant` | `services/security_posture_service.py` |
| Defender recommendations | `GET /api/security/defender/recommendations` | `services/security_posture_service.py` |
| Security posture roll-up | `GET /api/security/posture` | `services/security_posture_service.py` |
| Direct IaC emit | `GET /api/iac/emit` | `services/iac/` (Bicep, Terraform, ARM emitters) |
| CI/CD pipeline emit | `GET /api/iac/pipeline` | `services/cicd_emitter.py` |
| RAG reindex | `POST /api/rag/reindex/reference-archs` | `services/rag_service.py` |
| RAG search | `GET /api/rag/search` | `services/rag_service.py` |
| Conversations CRUD | `/api/conversations` | `db.py` (SQLAlchemy async) |
| User GitHub token | `/api/auth/github-token` | `services/secret_store.py` (Fernet-encrypted) |
| Reference Architecture library | `/api/refarch` (CRUD) + `POST /api/refarch/ingest` | `services/refarch_ingest.py` (Microsoft Learn ContentBrowser) |
| Demo Showcase library | `/api/demos` (CRUD) + `POST /api/demos/ingest` | `services/demo_ingest.py` (`Azure/awesome-azd`) |
| Diagram render | (via `services/diagram_service.py`) | drawpyo → draw.io XML |
| PPTX export | (via `services/pptx_service.py`) | `python-pptx` |

## Weekly content ingests

When `INGEST_ENABLED=true`, `backend/services/scheduler.py` registers two APScheduler cron jobs at app startup (`backend/main.py` lifespan):

| Job id | Cron (local) | Source | Backing service | Inserts into |
| --- | --- | --- | --- | --- |
| `refarch_ingest_weekly` | Sun 04:17 | `learn.microsoft.com/api/contentbrowser/search/architectures` (paginated, `$top=30`, cap 60 pages) | `services/refarch_ingest.py` | `RefArch` table |
| `demo_ingest_weekly` | Sun 04:42 | `raw.githubusercontent.com/Azure/awesome-azd/main/website/static/templates.json` (msft-tagged only) | `services/demo_ingest.py` | `Demo` table |

Both ingests apply the same source-aware upsert:

- Insert new rows with `source="microsoft_official"`, `featured=False`, fresh `created_at` and `last_synced_at`.
- Update existing `microsoft_official` rows in place — but never touch `featured` or `created_at`.
- Skip rows whose `source` is `custom` or `community` (user-authored content is sacred).

The same logic runs synchronously when an operator hits `POST /api/refarch/ingest` or `POST /api/demos/ingest` (both gated on the `Metrics.Read` Entra app role via `backend/auth/entra.py:require_metrics_role`). Both endpoints return `{ok, fetched, normalised, inserted, updated, unchanged, skipped, duration_s}`.

## Frontend feature inventory

`frontend/src/components/` contains 31 components. Highlights:

- `chat/StructuredResultCard.tsx` — renders typed SSE events (cost tables, threat registers, IaC bundles, etc.)
- `architecture/ArchitectureCanvas.tsx` — embeds rendered draw.io diagram
- `iac/IacTabs.tsx` — Bicep / Terraform / ARM file tabs with copy-to-clipboard
- `cost/CostTable.tsx` — cost-estimate renderer
- `auth/AuthGate.tsx` — MSAL gate
- `settings/SettingsPanel.tsx` — provider, model, GitHub PAT entry

`frontend/src/hooks/` contains 7 hooks: `useChat`, `useSSE`, `useSettings`, `useConversationHistory`, `useFindingChecklist`, `useWorkloadContext`, `useWorkloadSpec`.

`frontend/src/utils/` contains 16 helpers for clipboard copy, JSON / Markdown / PPTX export, diagram conversion, etc.
