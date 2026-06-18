# API Reference

REST + SSE routes exposed by the backend (`backend/main.py:62`-`80`). All routers are mounted under `/api`. When `AUTH_ENABLED=true`, every endpoint requires `Authorization: Bearer <jwt>`.

## Health

### `GET /api/healthz`
`backend/routes/health.py`. Liveness probe. Returns `{"status":"ok"}`.

### `GET /api/readyz`
Readiness probe. Returns `200` with `{"status":"ok"}` once startup is complete.

## Chat (SSE)

### `POST /api/chat`
`backend/routes/chat.py:65`. Streams `text/event-stream`.

Request body:

```json
{
  "mode": "qa",
  "messages": [{"role": "user", "content": "..."}],
  "llm_config": {
    "provider": "azure" | "github-copilot" | "github-models",
    "model": "gpt-4.1",
    "github_token": "<optional>"
  }
}
```

ARCH_ROUTE_MODES (`architecture`, `waf`, `review`, `drbc`) redirect internally to `POST /api/architecture`.

SSE event kinds emitted:

| `type` | Payload | Purpose |
| --- | --- | --- |
| `token` | `{ "text": "..." }` | Incremental LLM tokens |
| `citations` | `[{ "title", "url" }, ...]` | RAG / Learn citations |
| `error` | `{ "message": "..." }` | Streamed error |
| `service_comparison` | service comparison table | from `compare_services` |
| `region_comparison` | region comparison table | from `compare_regions` |
| `compliance_result` | control mappings | from `map_compliance` |
| `cost_estimate` | cost table + monthly total | from `estimate_costs` |
| `tco_report` | 3-year TCO | from `generate_tco_report` |
| `decision_card` | summary card | from `recommend_service` |
| `dr_strategy` | RTO/RPO + plan | from `design_dr_strategy` |
| `landing_zone_design` | mgmt groups + policies | from `design_landing_zone` |
| `naming_validation` | per-resource pass/fail | from `validate_resource_naming` |
| `naming_suggestion` | suggested name | from `suggest_resource_name` |
| `learning_plan` | weekly milestones | from `generate_learning_plan` |
| `practice_exam_pack` | questions + answers | from `generate_practice_exam` |
| `migration_assessment` | per-workload R | from `assess_migration` |
| `monitoring_config` | LA + AI + alerts | from `generate_monitoring_config` |
| `slo_framework` | SLIs, SLOs, error budget | from `define_slo_framework` |
| `diagnosis` | ranked hypotheses | from `diagnose_issue` |
| `kql_queries` | list of named KQL | from `generate_kql_queries` |
| `remediation_runbook` | numbered steps | from `generate_remediation_runbook` |
| `network_topology` | hub-spoke / vWAN | from `design_network_topology` |
| `pipeline_design` | stages + gates | from `design_pipeline` |
| `rbac_model` | roles + assignments | from `design_rbac_model` |
| `threat_register` | STRIDE entries | from `generate_threat_register` |
| `sku_recommendation` | SKU + rationale | from `recommend_sku` |
| `stakeholder_plan` | audiences + comms | from `create_stakeholder_plan` |

## Architecture (SSE)

### `POST /api/architecture`
`backend/routes/architecture.py`. Same request shape as `/api/chat` but specialized for architecture-quality output.

Routed modes (`ARCHITECTURE_MODES`): `architecture`, `waf`, `review`, `drbc`, `network`, `aiarchitecture`, `dataplatform`, `apim`.

Additional SSE event kinds (beyond those in `/api/chat`):

| `type` | Payload | Purpose |
| --- | --- | --- |
| `status` | `{ "message": "..." }` | Phase markers ("Designing…", "Emitting IaC…") |
| `bicep` | `{ "files": [{name,content}, ...] }` | Bicep bundle |
| `terraform_files` | `[{name,content}, ...]` | Terraform bundle |
| `arm_files` | `[{name,content}, ...]` | ARM JSON bundle |
| `adr` | `{ "markdown": "..." }` | Architecture Decision Record |
| `project_timeline` | phased milestones | from `generate_project_timeline` |
| `cicd_files` | `[{name,content}, ...]` | from `generate_cicd_pipeline` |
| `cost_alerts` | budget + alert specs | from `design_cost_alerts` |
| `security_posture` | summary | from `assess_security_posture` |
| `multicloud_comparison` | 3-cloud table | from `compare_clouds` |
| `diagram` | `{ "xml": "<drawio>...</drawio>" }` | draw.io XML |
| `runbook` | numbered runbook | from `generate_remediation_runbook` |
| `waf_pillar` | single-pillar score | from `assess_waf_pillar` |
| `waf_complete` | five-pillar summary | end-of-stream marker |

## Reference data

### `GET /api/reference/archs`
`backend/routes/reference.py`. Returns the bundled reference architectures from `backend/data/reference_archs.py`.

## Reference Architecture library

CRUD for the curated `RefArch` catalog. Rows whose `source` is `microsoft_official` (ingested weekly from Microsoft Learn) or `community` are read-only — `PATCH` accepts only the `featured` flag and `DELETE` returns 403. Rows with `source="custom"` are fully mutable.

### `GET /api/refarch`
List entries. Supports `?category=`, `?tag=`, `?featured=true`, `?q=` filters.

### `POST /api/refarch`
Create a `custom`-sourced entry.

### `PATCH /api/refarch/{id}`
Update an entry. Curated rows: `featured` only.

### `DELETE /api/refarch/{id}`
Delete. Curated rows return 403.

### `POST /api/refarch/ingest` (admin)
`backend/routes/refarch_admin.py`. Requires the `Metrics.Read` app role. Runs `services/refarch_ingest.run_ingest()` synchronously and returns `{ok, fetched, normalised, inserted, updated, unchanged, skipped, duration_s}`.

## Demo Showcase

CRUD for the curated `Demo` catalog. Source-aware mutation model is identical to RefArch: `microsoft_official` rows (ingested weekly from `Azure/awesome-azd`, msft-tagged only) and `community` rows are read-only except for `featured`; `custom` rows are mutable.

### `GET /api/demos`
List entries with the same filter set as `/api/refarch`.

### `POST /api/demos` / `PATCH /api/demos/{id}` / `DELETE /api/demos/{id}`
CRUD with the same source guards.

### `POST /api/demos/ingest` (admin)
`backend/routes/demos_admin.py`. Requires the `Metrics.Read` app role. Runs `services/demo_ingest.run_ingest()` synchronously and returns the same summary shape as the refarch ingest.

## Conversations

### `GET /api/conversations`
List conversations for the current user.

### `POST /api/conversations`
Create a conversation. Body: `{ "title": "...", "mode": "...", "meta": {...} }`.

### `DELETE /api/conversations/{id}`
Delete a conversation.

Source: `backend/routes/conversations.py`.

## Export

### `POST /api/export/markdown`
### `POST /api/export/pptx`
`backend/routes/export.py`. Render the current conversation or artefact bundle to Markdown or PPTX (`services/pptx_service.py`).

## Improve

### `POST /api/improve`
`backend/routes/improve.py`. Send a draft and receive an edited / improved version via the chat model.

## Presentation

### `POST /api/presentation/outline`
### `POST /api/presentation/review`
`backend/routes/presentation.py`. Deck outline generation + review.

## Settings

### `GET /api/settings`
### `PUT /api/settings`
`backend/routes/settings.py`. User preferences (default mode, provider, model).

## Code generation

### `POST /api/codegen`
`backend/routes/codegen.py`. Emits boilerplate file bundles (uses `generate_code_files`).

## Intake / parse / analyze

### `POST /api/intake`
### `POST /api/parse`
### `POST /api/analyze`
Pre-chat workflow helpers — see `backend/routes/intake.py`, `parse.py`, `analyze.py`.

## Auth

### `GET /api/auth/me`
Returns the resolved user claims (or `{"sub":"default"}` in dev).

### `GET /api/auth/github-token`
Returns `{ "has_token": true|false }` (does NOT return the secret).

### `PUT /api/auth/github-token`
Body: `{ "token": "ghp_..." }`. Encrypted at rest (Fernet); requires `SECRET_ENCRYPTION_KEY`.

### `DELETE /api/auth/github-token`
Source: `backend/routes/auth.py`.

## RAG

### `POST /api/rag/reindex/reference-archs`
Rebuild the reference-arch corpus. Returns `{ "indexed": <n> }`.

### `GET /api/rag/search?q=...&top_k=5`
Returns matching documents with cosine scores.

Source: `backend/routes/rag.py`.

## Scan (live Azure)

### `GET /api/scan/resources?subscription_id=...`
Lists subscription resources via Azure Resource Graph.

### `GET /api/scan/drift?subscription_id=...&pattern=...`
Compares live resources to an expected pattern.

Source: `backend/routes/scan.py`. Backed by `services/azure_scan_service.py`.

## Cost

### `GET /api/cost/mtd?subscription_id=...`
Month-to-date cost via Cost Management API.

### `POST /api/cost/budget/bicep`
Body: budget spec → returns generated Bicep.

### `GET /api/cost/anomaly-kql`
Returns KQL queries to detect spend anomalies.

Source: `backend/routes/cost.py`. Backed by `services/cost_service.py` and `services/cost_anomaly_service.py`.

## Security posture

### `GET /api/security/policy/noncompliant?subscription_id=...`
Non-compliant policy assignments (Policy Insights).

### `GET /api/security/defender/recommendations?subscription_id=...`
Defender for Cloud recommendations.

### `GET /api/security/posture?subscription_id=...`
Aggregated posture roll-up.

Source: `backend/routes/security.py`. Backed by `services/security_posture_service.py`.

## IaC emit (direct)

### `GET /api/iac/emit?reference_arch_id=...&format=bicep|terraform|arm`
Returns a file bundle for a bundled reference arch.

### `GET /api/iac/pipeline?reference_arch_id=...&pipeline_type=github-actions|azure-devops`
Returns a CI/CD pipeline YAML bundle.

Source: `backend/routes/iac.py`. Backed by `services/iac/` and `services/cicd_emitter.py`.

## SSE format

All streaming endpoints emit standard SSE frames:

```
data: {"type":"token","text":"Hello"}\n\n
data: {"type":"citations","citations":[{"title":"...","url":"..."}]}\n\n
data: {"type":"error","message":"..."}\n\n
```

Frontend consumes via `EventSource` polyfill in `frontend/src/hooks/useSSE.ts`. Each frame is parsed and dispatched into the chat state machine.

## Error responses

REST endpoints (non-SSE) return standard FastAPI/Pydantic error envelopes:

```json
{ "detail": "..." }
```

SSE endpoints emit `{ "type": "error", "message": "..." }` followed by stream close.

## Status codes

| Code | Used when |
| --- | --- |
| 200 | Success (REST) |
| 200 + SSE | Streaming endpoints (the SSE stream may still emit `type:"error"` frames) |
| 401 | Auth required (`AUTH_ENABLED=true` and missing/invalid bearer) |
| 403 | Token valid but user lacks claim (rare; mostly informational) |
| 404 | Conversation / resource not found |
| 422 | Pydantic validation |
| 500 | Unhandled exception (logged with `request_id`) |
