# Specification — Azure Architect AI

Formal specification covering functional requirements (FRs), non-functional requirements (NFRs), data specs, interface specs, acceptance criteria, and a glossary.

Version: 2.0.0 (matches `backend/main.py:51`)

## 1. Purpose and scope

Azure Architect AI is a multi-mode, chat-driven assistant that helps cloud architects design, document, deploy, operate, and optimize Azure workloads. The system combines an LLM (Azure OpenAI), tool-use (39 callable tools across 23 domains), a RAG corpus over Microsoft Learn, optional MCP tools (`@azure/mcp`), and direct Azure control-plane integrations (Resource Graph, Cost Management, Policy Insights, Defender for Cloud).

In scope:
- Architecture design + IaC emission (Bicep / Terraform / ARM)
- Diagram generation (draw.io)
- Cost estimation, TCO, anomaly detection
- Security: threat modeling, posture, compliance mapping
- Reliability: SLO frameworks, monitoring config, runbooks
- Governance: landing zones, naming, RBAC
- Workflow helpers: stakeholder plans, deck outlines, learning plans
- Live subscription scanning (read-only)

Out of scope:
- Mutating Azure resources directly (the app does not apply IaC, only emits it)
- Real-time team collaboration / multi-user editing
- Long-term forecasting beyond bundled pricing data

## 2. Functional requirements

### 2.1 Chat (FR-CHAT)
| ID | Requirement |
| --- | --- |
| FR-CHAT-01 | The system shall expose `POST /api/chat` accepting `{ mode, messages, llm_config }` and returning `text/event-stream`. |
| FR-CHAT-02 | The system shall support 34 modes as defined in `backend/tools/tool_definitions.py:TOOLS_BY_MODE`. |
| FR-CHAT-03 | For each mode, the system shall pass only that mode's tool catalog to the LLM. |
| FR-CHAT-04 | For modes in `_MCP_ENABLED_MODES`, the system shall additionally pass whitelisted MCP tools when `MCP_ENABLED=true`. |
| FR-CHAT-05 | For modes in `PREFETCH_MODES` (landingzone, threatmodel, reliability, sizing, drbc, waf), the system shall pre-fetch ≤5 Microsoft Learn documents before the LLM call and inject them as citations. |
| FR-CHAT-06 | The system shall dispatch tool calls and emit each result as a typed SSE event (`type` ∈ {token, citations, error, plus 25 structured kinds in API.md}). |
| FR-CHAT-07 | The system shall persist user + assistant messages to the conversation store. |

### 2.2 Architecture (FR-ARCH)
| ID | Requirement |
| --- | --- |
| FR-ARCH-01 | The system shall expose `POST /api/architecture` for modes in `ARCHITECTURE_MODES`. |
| FR-ARCH-02 | The architecture stream shall emit Bicep, Terraform, and ARM file bundles in a single response. |
| FR-ARCH-03 | The architecture stream shall emit a draw.io XML diagram. |
| FR-ARCH-04 | The architecture stream shall emit a cost estimate and an ADR. |
| FR-ARCH-05 | IaC emission for the 15 bundled reference architectures shall use the IR (`services/iac/ir.py`) deterministically (no LLM in the loop). |

### 2.3 IaC (FR-IAC)
| ID | Requirement |
| --- | --- |
| FR-IAC-01 | `GET /api/iac/emit?reference_arch_id=...&format=...` shall return a file bundle for Bicep, Terraform, or ARM. |
| FR-IAC-02 | The IR shall record `notes[]` listing any service labels missing from `SERVICE_CATALOG`. |
| FR-IAC-03 | The CI/CD emitter shall produce GitHub Actions or Azure DevOps pipeline YAML. |

### 2.4 RAG (FR-RAG)
| ID | Requirement |
| --- | --- |
| FR-RAG-01 | The system shall index reference architectures at startup when `RAG_ENABLED=true`. |
| FR-RAG-02 | `POST /api/rag/reindex/reference-archs` shall rebuild the index. |
| FR-RAG-03 | `GET /api/rag/search?q=...&top_k=...` shall return ranked documents using cosine similarity. |

### 2.5 Live scanning (FR-SCAN)
| ID | Requirement |
| --- | --- |
| FR-SCAN-01 | `GET /api/scan/resources` shall list subscription resources via Azure Resource Graph. |
| FR-SCAN-02 | `GET /api/scan/drift` shall compare live resources to an expected pattern. |
| FR-SCAN-03 | Cost endpoints (`/api/cost/*`) shall surface MTD spend, budget Bicep, and anomaly KQL. |
| FR-SCAN-04 | Security endpoints (`/api/security/*`) shall surface non-compliant policy, Defender recommendations, and posture summary. |

### 2.6 Auth (FR-AUTH)
| ID | Requirement |
| --- | --- |
| FR-AUTH-01 | When `AUTH_ENABLED=false`, `require_user` shall return `{"sub":"default"}` without contacting Entra. |
| FR-AUTH-02 | When `AUTH_ENABLED=true`, every `/api/*` request shall require `Authorization: Bearer <jwt>`. |
| FR-AUTH-03 | Tokens shall be validated using RS256 against JWKS from `https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys` with issuer + audience + expiry checks. |
| FR-AUTH-04 | User GitHub PATs shall be encrypted at rest with Fernet (`SECRET_ENCRYPTION_KEY`) and accessible only to the owning user. |

### 2.7 Persistence (FR-PERSIST)
| ID | Requirement |
| --- | --- |
| FR-PERSIST-01 | The system shall use SQLAlchemy 2 async with SQLite (dev) or Postgres (prod) per `DATABASE_URL`. |
| FR-PERSIST-02 | Schema shall be created on startup via `init_db()` (`backend/db.py`). |
| FR-PERSIST-03 | Conversations, messages, RAG documents, and user secrets shall be modeled. |

### 2.8 Observability (FR-OBS)
| ID | Requirement |
| --- | --- |
| FR-OBS-01 | When `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, the system shall export traces, logs, and metrics via `azure-monitor-opentelemetry`. |
| FR-OBS-02 | Custom counters `aa_tool_calls_total`, `aa_openai_tokens_used`, `aa_rag_cache_hit_latency_ms` shall be emitted. |
| FR-OBS-03 | Every request shall be tagged with a `request_id` propagated through logs and traces. |

## 3. Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-PERF-01 | First token latency (chat) | ≤ 4 s p95 with warm RAG cache |
| NFR-PERF-02 | Full architecture stream completion | ≤ 60 s p95 |
| NFR-AVAIL-01 | Production availability | 99.5% monthly (single-region MVP); 99.9% with multi-region (roadmap) |
| NFR-SCALE-01 | Concurrent chat sessions | 50 per backend replica; scale via ACA replica count (`infra/main.bicep:221`) |
| NFR-SEC-01 | All Azure access uses managed identity in prod (no static keys) | enforced via UAMI bindings in `infra/modules/*.bicep` |
| NFR-SEC-02 | Secrets at rest encrypted (Fernet) | enforced in `services/secret_store.py` |
| NFR-SEC-03 | All inbound traffic terminates HTTPS at Front Door | when `deployFrontDoor=true` |
| NFR-SEC-04 | OpenAI / Key Vault / Postgres reachable only via private endpoint in prod | partially implemented; private endpoints on KV + OpenAI + Postgres; ACR + Storage not yet |
| NFR-COMPL-01 | Tooling shall support PCI / HIPAA / NIST / CIS mapping | via `map_compliance` tool |
| NFR-PORT-01 | Backend shall run on Linux containers | enforced by `Dockerfile.prod` |
| NFR-OBSV-01 | Mean time to diagnose (with traces + custom metrics) | ≤ 15 min |
| NFR-COST-01 | Idle infra cost (no active users) | ≤ $250 / month with `deploySearch=false` |

## 4. Data specifications

### 4.1 Conversation (SQLAlchemy)
```
id          string (UUID4)          PK
user_id     string                  NOT NULL
title       string(256)
mode        string(64)
meta        JSON
created_at  datetime (utc)
updated_at  datetime (utc)
```

### 4.2 Message
```
id               int   PK
conversation_id  string FK
role             string  ('system' | 'user' | 'assistant' | 'tool')
content          text
artefacts        JSON  (typed SSE events accumulated)
created_at       datetime (utc)
```

### 4.3 RagDocument
```
id         int    PK
source     string ('reference_arch' | 'learn' | ...)
url        string
content    text
embedding  JSON   (list[float])
```

### 4.4 UserSecret
```
id          int    PK
user_id     string
kind        string  ('github_pat' | ...)
ciphertext  text    (Fernet encrypted)
```

### 4.5 IacModule (in-memory)
See `backend/services/iac/ir.py:38`. Carries `name`, `description`, `parameters[]`, `resources[]`, `outputs{}`, `notes[]`.

## 5. Interface specifications

See [docs/API.md](docs/API.md) for the full enumeration. Key contract points:

### 5.1 Chat request

```json
{
  "mode": "string (one of 34)",
  "messages": [{"role": "user|assistant|system", "content": "string"}],
  "llm_config": {
    "provider": "azure|github-copilot|github-models",
    "model": "string",
    "github_token": "string?"
  }
}
```

### 5.2 SSE event envelope

```json
{ "type": "<kind>", "...kind-specific fields": "..." }
```

`<kind>` enumeration is fixed (28 chat kinds + 14 architecture-specific kinds). The frontend is contract-bound: an unknown kind is logged + ignored (`frontend/src/hooks/useSSE.ts`).

### 5.3 IaC bundle shape

```json
{ "files": [{"name": "main.bicep", "content": "..."}, {"name": "params.bicepparam", "content": "..."}] }
```

### 5.4 Cost estimate shape

```json
{
  "items": [{"service":"...", "sku":"...", "quantity":"...", "monthly_usd": 0.0}],
  "monthly_total_usd": 0.0,
  "currency": "USD",
  "assumptions": ["..."]
}
```

## 6. Acceptance criteria

A release is acceptable when:

1. `pytest -q` passes for the 23 backend tests (`backend/tests/`).
2. `npm test` passes for the 7 frontend tests (`frontend/src/**/__tests__/**`).
3. `npm run build` succeeds with no `tsc --noEmit` errors.
4. `ruff check backend/` is clean.
5. `az deployment sub what-if` against `infra/main.bicep` produces no destructive changes for the target environment.
6. The deployed app passes the `deploy.yml` `smoke` job (HTTP 200 on `frontendUrl`).
7. `/api/healthz` returns `200` within 30 s of revision start.
8. Issuing an `architecture` mode prompt produces a stream containing at least: `status`, `token`, `bicep`, `cost_estimate`, `adr`, `diagram`, `citations`.
9. `/api/scan/resources` returns ≥1 resource against a non-empty subscription.
10. Custom OTel metrics `aa_tool_calls_total` appear in Application Insights within 5 minutes of usage.

## 7. Constraints and assumptions

- **Azure OpenAI**: Caller has a deployed model that supports tool use. Models in `TOOL_INCOMPATIBLE_MODELS` (e.g. some llama / mistral / phi via GitHub Models) bypass tool calls.
- **Region**: Default deploy target is `eastus2` (matches workflows). Other regions require parameter override.
- **Concurrency**: SQLite is single-writer; Postgres is required for prod multi-replica.
- **Secrets**: `SECRET_ENCRYPTION_KEY` rotation invalidates stored ciphertexts — re-issue user PATs.
- **MCP**: Node 20+ on `PATH` required for `npx -y @azure/mcp@latest` spawn.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Azure OpenAI quota throttling | Token-budget service (`services/token_budget.py`) caps per-request usage; back-off on `429` |
| RAG corpus stale | `POST /api/rag/reindex/reference-archs` is idempotent and safe to schedule |
| MCP subprocess crash | Lifespan re-spawns on next startup; tools merge degrades to empty list if MCP missing |
| LLM hallucinates wrong SKU | Pricing service validates SKUs; unknown SKUs flagged in cost estimate |
| Container Apps cold start | `minReplicas=1` for backend (`infra/main.bicep:220`) keeps a warm replica |

## 9. Roadmap (not yet implemented)

- pgvector-backed RAG (currently pure-Python cosine on JSON embeddings)
- Private endpoints on ACR + Storage
- WAF policy attached to Front Door
- Multi-region active-active deployment
- Native diagram editor in the frontend (currently render-only)
- System-prompt templates for modes: `qa`, `codegen`, `devops`, `finops`, `securityposture`, `multicloud` (these fall through to default today)

## 10. Glossary

| Term | Definition |
| --- | --- |
| **ACA** | Azure Container Apps |
| **ACR** | Azure Container Registry |
| **ADR** | Architecture Decision Record |
| **AOAI** | Azure OpenAI |
| **CAF** | Microsoft Cloud Adoption Framework |
| **Drift** | Difference between live resources and an expected pattern |
| **Fernet** | Symmetric AEAD cipher (cryptography library) used for at-rest secrets |
| **IaC** | Infrastructure as Code |
| **IR** | Intermediate Representation (`services/iac/ir.py`) used by Bicep / Terraform / ARM emitters |
| **JWKS** | JSON Web Key Set; Entra-published RSA keys for JWT validation |
| **MCP** | Model Context Protocol; tools sourced from `@azure/mcp` |
| **MSAL** | Microsoft Authentication Library; used in the frontend SPA |
| **OTel** | OpenTelemetry |
| **PAT** | Personal Access Token (GitHub) |
| **RAG** | Retrieval Augmented Generation |
| **RG** | Resource Group |
| **SLO** | Service Level Objective |
| **SSE** | Server-Sent Events |
| **STRIDE** | Threat modeling categories: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege |
| **UAMI** | User-Assigned Managed Identity |
| **WAF** | Well-Architected Framework (Microsoft) — distinct from Web Application Firewall |
