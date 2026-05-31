# Azure Architect AI

A virtual Azure Solutions Architect — 15 specialist modes covering expert Q&A,
architecture design with draw.io diagrams + Bicep, WAF assessments, compliance
mapping, migration planning, cost optimization, DR/BC design, landing zones,
threat modeling, and more.

FastAPI + React 18 + Fluent UI v9 + Azure OpenAI. Streams every token over SSE.

---

## Pick your deploy path

| Path | Use when | Section |
|---|---|---|
| Local, no Docker | Hacking on backend or frontend in isolation | [Local without Docker](#local-without-docker) |
| Local Docker (dev) | Default loop. Hot reload, `az login` for auth | [Local Docker (dev)](#local-docker-dev) |
| Local Docker (prod parity) | Smoke-test prod image graph before shipping | [Local Docker (prod parity)](#local-docker-prod-parity) |
| Azure Container Apps | Shared / pilot / prod | [Azure Container Apps](#azure-container-apps) |

All four use the **same** `services/openai_service.py:get_client()` factory.
You do not need to switch between API key and managed identity in code — see
the [auth matrix](#auth-matrix).

---

## Prerequisites

| For | Need |
|---|---|
| Local, no Docker | Python 3.11+, Node 20+, an Azure OpenAI resource |
| Local Docker | Docker Desktop, an Azure OpenAI resource |
| Azure deploy | Azure CLI, an Azure subscription with Contributor + User Access Administrator at the target scope |

Azure OpenAI deployments expected by default: `gpt-4.1` and `gpt-4o-mini`.
Override per-mode in the Settings panel.

---

## Local without Docker

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env                            # then edit
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
cp .env.example .env                                  # optional; leave empty for local
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to
`http://localhost:8000` (see `frontend/vite.config.ts`).

For keyless auth, leave `AZURE_OPENAI_KEY` unset in `.env` and run `az login`
on the host. `DefaultAzureCredential` picks up your developer credentials.

## Local Docker (dev)

The default loop. Hot reload on both services, host `az login` tokens mounted
into the backend container so keyless auth works without changing code.

```bash
cp .env.example .env
az login                                              # so the mount has tokens
docker compose up --build
```

Open <http://localhost:5173>.

The backend container mounts `~/.azure:/root/.azure:ro` (set in
`docker-compose.yml`). Docker Desktop expands `~` correctly on Windows, macOS,
and Linux. If you only want API key auth, leave `~/.azure` empty and set
`AZURE_OPENAI_KEY` in `.env`.

## Local Docker (prod parity)

Builds the production images (multi-stage, no bind mounts, nginx-served SPA)
and runs them locally. Use this to catch regressions in the image graph before
deploying to Azure.

```bash
az login                                              # if using keyless auth
docker compose -f docker-compose.prod.yml up --build
```

Open <http://localhost:8080>.

## Azure Container Apps

End-to-end deploy with managed identity, ACR, Key Vault, Azure OpenAI, and an
Azure Files-backed SQLite store. Full Bicep is in [`infra/`](./infra/README.md);
short version:

```bash
# 1. Provision platform (placeholder images on first run)
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

ACR=$(az deployment sub show -n main \
  --query properties.outputs.acrLoginServer.value -o tsv | cut -d. -f1)

# 2. Build & push real images via ACR Tasks
az acr build -r "$ACR" -t aa-backend:v1  -f backend/Dockerfile.prod  ./backend
az acr build -r "$ACR" -t aa-frontend:v1 -f frontend/Dockerfile.prod ./frontend

# 3. Re-deploy with real images
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters \
    backendImage="$ACR.azurecr.io/aa-backend:v1" \
    frontendImage="$ACR.azurecr.io/aa-frontend:v1"

# 4. Open
az deployment sub show -n main \
  --query properties.outputs.frontendUrl.value -o tsv
```

See [`infra/README.md`](./infra/README.md) for parameters, role assignments,
and the per-module breakdown.

---

## Auth matrix

| Environment | Azure OpenAI auth | How |
|---|---|---|
| Local, no Docker | `az login` → `DefaultAzureCredential` | Existing path in `backend/services/openai_service.py:24-32` |
| Local Docker (dev) | `az login` → `DefaultAzureCredential` | Compose mounts `~/.azure:/root/.azure:ro` |
| Local Docker (prod parity) | `az login` or `AZURE_OPENAI_KEY` in `.env` | Same factory; API key path takes precedence when set |
| Azure Container Apps | User-assigned managed identity | `DefaultAzureCredential` picks up the workload identity; `AZURE_CLIENT_ID` env var disambiguates |

The single `get_client()` function in `backend/services/openai_service.py`
handles all four modes — **never change it per environment**. If
`settings.azure_openai_key` is set, the SDK uses it. Otherwise
`DefaultAzureCredential` walks its chain (env → workload identity → managed
identity → Azure CLI → developer).

---

## Configuration reference

Backend reads env vars via `backend/config.py` (Pydantic settings). `.env` and
shell vars both work.

| Variable | Required | Default | Where read |
|---|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | yes | — | `services/openai_service.py` |
| `AZURE_OPENAI_KEY` | no | — | If set, used; else `DefaultAzureCredential` |
| `AZURE_OPENAI_API_VERSION` | no | `2024-12-01-preview` | `services/openai_service.py` |
| `AZURE_OPENAI_DEPLOYMENT` | no | `gpt-4.1` | `services/openai_service.py` |
| `AZURE_OPENAI_MINI_DEPLOYMENT` | no | `gpt-4o-mini` | `services/openai_service.py` |
| `AZURE_CLIENT_ID` | only in ACA with multiple MIs | — | DefaultAzureCredential disambiguator |
| `ENABLE_MCP` | no | `true` | `services/mcp_service.py` |
| `DATABASE_URL` | no | SQLite at `./data/conversations.db` | `services/db.py` |

Frontend has one build-time var (`frontend/.env.example`):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_BASE_URL` | no | empty | Set for split-host deploys (SPA on Static Web Apps, API elsewhere). Leave empty for same-origin / Vite proxy. |

---

## Architecture

```
frontend (React 18 + Fluent UI v9 + Vite → nginx in prod)
    ↓ /api/* (SSE)
backend (FastAPI + Python 3.11, uvicorn)
    ↓ Azure OpenAI tool-use loop, 25+ tools
Azure OpenAI (gpt-4.1 / gpt-4o-mini)
    ├── search_azure_docs       → Microsoft Learn Search API
    ├── design_architecture     → drawpyo draw.io XML (azure2 stencils)
    ├── generate_bicep          → Bicep IaC + param file + deploy commands
    ├── estimate_costs          → Azure Retail Pricing API
    ├── assess_waf_pillar       → 5-pillar WAF scoring
    ├── generate_monitoring_config
    ├── compare_services
    ├── map_compliance
    ├── assess_migration
    ├── design_dr_strategy
    ├── design_landing_zone
    ├── design_network_topology
    ├── design_rbac_model
    ├── generate_threat_register
    ├── design_pipeline
    ├── define_slo_framework
    ├── recommend_sku
    ├── compare_regions
    ├── generate_practice_exam
    ├── create_stakeholder_plan
    ├── recommend_service
    ├── diagnose_issue
    ├── generate_kql_queries
    ├── generate_remediation_runbook
    └── generate_tco_report
```

Azure Container Apps deploys both services into one managed environment behind
a single managed identity. SQLite lives on an Azure Files share mounted at
`/app/data` so conversations survive revision swaps. See
[`infra/README.md`](./infra/README.md) for the full topology.

---

## Modes

### Advisory
| Mode | Description |
|---|---|
| Expert Q&A | Cited answers from Microsoft Learn |
| Situation Advisor | Stakeholder, vendor, migration conversations |
| Presentation Coach | Structure Azure topics for an audience |
| Cert Prep | AZ-305 / AZ-500 / AZ-104 / AZ-700 scenario coaching |
| Regional Advisor | Region selection, AZ coverage, data residency, sovereign |

### Design & Build
| Mode | Description |
|---|---|
| Architecture Design | Requirements → diagram + runbook + Bicep + cost |
| Reference Library | 15 curated architectures with WAF scores |
| Service Comparison | Side-by-side structured comparison |
| Landing Zone | CAF-aligned management group + hub-spoke design |
| Codegen | Push generated Bicep to a GitHub repo |

### Assessment
| Mode | Description |
|---|---|
| WAF Assessment | 5-pillar scored findings |
| Architecture Review | Red-team review with severity-tagged gaps |
| Compliance Mapping | HIPAA, PCI-DSS, SOC 2, FedRAMP, GDPR, ISO 27001, NIST, CIS |
| Migration Assessment | 6 R's analysis with effort and wave planning |
| Threat Model | STRIDE register + control recommendations |

### Operations
| Mode | Description |
|---|---|
| Cost Optimization | Retail Pricing API estimates + savings recs |
| Monitoring Config | Alert rules, KQL, dashboards |
| DR/BC Design | Pattern + service configs + failover runbook |
| Sizing | VM/AKS/SQL/Storage sizing for stated load |
| Reliability | SLO framework + error budget policy |

---

## Project structure

```
azure-architect-ai/
├── README.md                       ← you are here
├── docker-compose.yml              ← dev (bind mounts, az login mount, hot reload)
├── docker-compose.prod.yml         ← prod parity (multi-stage, nginx, no mounts)
├── .env.example
├── infra/                          ← Azure deploy (Bicep, ACA monolith)
│   ├── README.md
│   ├── main.bicep
│   ├── main.bicepparam
│   └── modules/
│       ├── identity.bicep
│       ├── containerregistry.bicep
│       ├── keyvault.bicep
│       ├── storage.bicep
│       ├── openai.bicep
│       ├── containerapps-env.bicep
│       └── containerapp.bicep
├── backend/
│   ├── Dockerfile                  ← dev (single stage, includes Node for MCP)
│   ├── Dockerfile.prod             ← multi-stage, non-root, healthcheck
│   ├── main.py
│   ├── config.py
│   ├── routes/                     ← chat, architecture, reference, codegen, intake, presentation, conversations, settings, export, health
│   ├── services/                   ← openai, docs, diagram, pricing, mcp, db, settings, runbook
│   ├── tools/tool_definitions.py   ← 25+ tool schemas + TOOLS_BY_MODE
│   ├── prompts/system_prompt.py    ← 15 mode templates
│   └── data/reference_archs.py     ← 15 curated reference architectures
└── frontend/
    ├── Dockerfile                  ← dev (Vite dev server, port 5173)
    ├── Dockerfile.prod             ← multi-stage, nginx on 8080, /api proxy
    ├── nginx.conf
    ├── .env.example                ← VITE_API_BASE_URL for split-host deploys
    └── src/
        ├── App.tsx
        ├── config/api.ts           ← apiPath() — all fetches route through here
        ├── hooks/                  ← useSSE, useChat, useSettings, useConversationHistory, useWorkloadSpec
        └── components/             ← 15 mode panels + SideNav + Header + HistoryDrawer
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `DefaultAzureCredential failed` in Docker dev | `az login` on host, then restart compose. Check `~/.azure` exists. |
| `403` from Azure OpenAI in ACA | Managed identity missing `Cognitive Services OpenAI User` on the AOAI account. Re-run `infra/main.bicep`. |
| SSE response cuts off | Reverse proxy buffering. nginx config in `frontend/nginx.conf` has `proxy_buffering off`. If running behind Front Door / APIM, set the same. |
| MCP tools time out on first call | First `npx @azure/mcp` download. Dockerfiles pre-install it. Locally without Docker, run `npm install -g @azure/mcp@latest`. |
| `429` from Azure OpenAI under load | Capacity in `infra/main.bicepparam`. Bump `capacity` per deployment. |
| Conversations disappear after redeploy in ACA | File share volume not mounted. Check `containerapps-env.bicep` storage definition and that backend volume mount path is `/app/data`. |
| Cold start latency in ACA | `minReplicas: 1` is set for both apps. To save cost, drop to `0` and accept ~5s cold start. |

---

## Security model

- One user-assigned managed identity per environment (`infra/modules/identity.bicep`)
- Role assignments scoped to the resource, not the subscription
- `AcrPull` on the registry, `Key Vault Secrets User` on the vault, `Cognitive Services OpenAI User` on the AOAI account
- ACR admin user disabled
- Key Vault in RBAC mode, soft-delete on, purge protection on
- Storage account: HTTPS only, TLS 1.2 minimum, no public blob access
- Frontend image runs as `nginx` user; backend prod image runs as non-root `app` user
- Both prod images have `HEALTHCHECK` instructions
- ACA ingress: backend internal, frontend external

Roadmap (not yet implemented): VNet + private endpoints, Entra ID auth on the
frontend, encrypted server-side storage of GitHub PATs, key rotation
automation.

---

## Roadmap

See [`plans/`](.) for the full multi-phase plan. Highlights:

- **Phase 2** — Move GitHub PAT to backend session, Entra ID auth, Postgres + Alembic
- **Phase 3.1** — RAG cache (pgvector) over Microsoft Learn + reference archs
- **Phase 3.2** — Live Azure subscription scanner with drift detection (flagship)
- **Phase 3.3** — Terraform + ARM emitters alongside Bicep
- **Phase 4** — CI/CD pipeline emitter, cost anomaly design, Defender/Sentinel integration, AWS/GCP comparison
- **Phase 6 follow-up** — Carve monolith into 8 microservices (gateway, chat, architecture, rag, scanner, export, mcp, frontend)
