# Azure Architect AI

A virtual Azure Solutions Architect web app: FastAPI + React + Azure OpenAI with 39 tools across 34 modes, draw.io diagrams, Bicep/Terraform/ARM emitters, RAG over Microsoft Learn, a live Azure scanner, and Container Apps deployment.

- Backend: `backend/` — FastAPI, Pydantic, SQLAlchemy 2 async, OpenTelemetry
- Frontend: `frontend/` — React 18 + Vite + Fluent UI v9 + MSAL React
- Infra: `infra/` — subscription-scope Bicep (13 module deployments)
- CI/CD: `.github/workflows/` — `ci.yml`, `infra.yml`, `deploy.yml`

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Local development setup, dependencies, env vars |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Container Apps deploy + GitHub Actions workflows |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | End-user guide with all 34 modes and worked examples |
| [docs/FEATURES.md](docs/FEATURES.md) | All 39 tools grouped by domain |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, auth, observability |
| [docs/API.md](docs/API.md) | REST + SSE route reference and all SSE event kinds |
| [SPECIFICATION.md](SPECIFICATION.md) | Formal FR/NFR specification, data + interface specs |

## What it does

Azure Architect AI is a chat-driven assistant for cloud architects. Pick a mode (e.g. `architecture`, `landingzone`, `threatmodel`, `cost`), describe a workload, and the app:

1. Pre-fetches Microsoft Learn docs (for structured modes, see `backend/routes/chat.py:45`)
2. Calls Azure OpenAI with a mode-specific system prompt and tool catalog
3. Dispatches tool calls (built-in + optional MCP tools from `@azure/mcp`)
4. Streams typed SSE events back: tokens, citations, diagrams, IaC files, cost tables, ADRs, runbooks, threat registers, KQL queries
5. Persists conversation + artefacts via SQLAlchemy async (SQLite dev / Postgres prod)

The `architecture` route additionally emits Bicep, Terraform, ARM, draw.io XML, cost estimates, ADRs, project timelines, and CI/CD pipeline files in a single SSE stream (`backend/routes/architecture.py`).

## Quick start (local, no Docker)

```bash
# Prereqs: Python 3.11+, Node 20+, Azure OpenAI endpoint, az login

# Backend
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # then fill in AZURE_OPENAI_ENDPOINT, etc.
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173
```

The backend uses `DefaultAzureCredential`, so `az login` on the host is the simplest auth path; it falls back to `AZURE_OPENAI_KEY` if set.

## Quick start (Docker dev)

The container authenticates to Azure OpenAI with an Entra ID **service principal** (app registration) — no `az login` mount required.

**1. One-time: create an app registration**

```bash
# Create app + service principal
az ad sp create-for-rbac --name azure-architect-ai-dev --skip-assignment
# Note the appId (= AZURE_CLIENT_ID), password (= AZURE_CLIENT_SECRET), tenant (= AZURE_TENANT_ID)

# Grant it data-plane access on your Azure OpenAI resource
AOAI_ID=$(az cognitiveservices account show -n <aoai-name> -g <rg> --query id -o tsv)
az role assignment create \
  --assignee <appId> \
  --role "Cognitive Services OpenAI User" \
  --scope "$AOAI_ID"
```

**2. Add to `backend/.env`**

```env
AZURE_TENANT_ID=<tenant-guid>
AZURE_CLIENT_ID=<appId>
AZURE_CLIENT_SECRET=<password>
```

`DefaultAzureCredential`'s `EnvironmentCredential` picks these up automatically.

**3. Run**

```bash
docker compose up --build
# backend  http://localhost:8000
# frontend http://localhost:5173
```

`docker-compose.yml` bind-mounts source for hot reload. No host `~/.azure` mount is needed.

> **Note:** This app registration is for the **backend → Azure OpenAI** call. The separate `AUTH_ENABLED` / `ENTRA_AUDIENCE` settings (user → API auth) require their own API + SPA app registrations — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Protected login (Docker, optional)

To put the Docker app behind an Entra ID popup login, create two more app registrations and add their IDs to `.env`. The frontend uses MSAL popup; all `/api/*` calls then require a bearer JWT.

**1. Create the API app registration**

```bash
# API (the resource being called)
API_APP=$(az ad app create --display-name azure-architect-ai-api \
  --query appId -o tsv)
# Expose a scope so the SPA can request it
az ad app update --id $API_APP --identifier-uris api://$API_APP
az ad app update --id $API_APP --set api.oauth2PermissionScopes="[{
  \"adminConsentDescription\":\"Access Azure Architect API\",
  \"adminConsentDisplayName\":\"Access API\",
  \"id\":\"$(uuidgen)\",
  \"isEnabled\":true,
  \"type\":\"User\",
  \"userConsentDescription\":\"Access Azure Architect API on your behalf\",
  \"userConsentDisplayName\":\"Access API\",
  \"value\":\"access_as_user\"
}]"
```

**2. Create the SPA app registration**

```bash
SPA_APP=$(az ad app create --display-name azure-architect-ai-spa \
  --spa-redirect-uris http://localhost:5173 \
  --query appId -o tsv)
# Pre-authorize the SPA against the API scope (avoids extra consent prompts)
az ad app permission add --id $SPA_APP \
  --api $API_APP --api-permissions <scope-id>=Scope
az ad app permission grant --id $SPA_APP --api $API_APP \
  --scope access_as_user
```

**3. Add to repo-root `.env`** (next to `docker-compose.yml`)

```env
# Backend
AUTH_ENABLED=true
ENTRA_TENANT_ID=<tenant-guid>
ENTRA_AUDIENCE=api://<API_APP>     # or just <API_APP>

# Frontend (forwarded into the SPA container by docker-compose)
VITE_AUTH_ENABLED=true
VITE_ENTRA_TENANT_ID=<tenant-guid>
VITE_ENTRA_CLIENT_ID=<SPA_APP>
VITE_ENTRA_API_SCOPE=api://<API_APP>/access_as_user
```

**4. Restart**

```bash
docker compose up --build
```

The SPA now shows a sign-in page; after popup login it stores the access token in `sessionStorage` and adds `Authorization: Bearer …` to every `/api/*` request. With `AUTH_ENABLED=false` (the default), the gate is bypassed entirely.

## Quick start (Docker "prod-like")

```bash
docker compose -f docker-compose.prod.yml up --build
# backend  http://localhost:8000
# frontend http://localhost:8080 (nginx, served static)
```

This builds production images (multi-stage), but still runs locally. For real production see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Config reference (backend `.env`)

Defined in `backend/config.py`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_OPENAI_ENDPOINT` | (required) | `https://<account>.openai.azure.com/` |
| `AZURE_OPENAI_KEY` | unset | Optional. If unset, uses `DefaultAzureCredential` token provider |
| `AZURE_OPENAI_DEPLOYMENT_CHAT` | `gpt-4o-mini` | Fast chat / QA model |
| `AZURE_OPENAI_DEPLOYMENT_ARCH` | `gpt-4.1` | Architecture-quality model |
| `AZURE_OPENAI_DEPLOYMENT_EMBEDDING` | `text-embedding-3-small` | RAG embeddings |
| `AZURE_OPENAI_API_VERSION` | `2024-12-01-preview` | API version |
| `RAG_ENABLED` | `true` | Pre-warm RAG corpus on startup |
| `RAG_TOP_K` | `5` | Top-k documents per RAG lookup |
| `MCP_ENABLED` | `true` | Spawn `@azure/mcp` subprocess + register MCP tools |
| `AZURE_SUBSCRIPTION_ID` | unset | Default subscription for MCP / scanner / cost |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/conversations.db` | Async SQLAlchemy URL |
| `SECRET_ENCRYPTION_KEY` | unset | Fernet key for `UserSecret` storage (GitHub PATs) |
| `AUTH_ENABLED` | `false` | When true, all `/api/*` requires bearer JWT |
| `ENTRA_TENANT_ID` | unset | Required when `AUTH_ENABLED=true` |
| `ENTRA_AUDIENCE` | unset | API app registration client ID / app ID URI |
| `INGEST_ENABLED` | `false` | Register the APScheduler weekly ingest jobs at startup (`services/scheduler.py`) |
| `INGEST_USER_AGENT` | `AzureArchitectAI-Ingest/1.0` | User-Agent header sent on outbound ingest fetches |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | unset | Enables OTel export to Azure Monitor |

## Auth matrix

| Environment | Backend auth | Azure OpenAI auth | Notes |
| --- | --- | --- | --- |
| Local (`uvicorn`) | `AUTH_ENABLED=false` (default) → `require_user` returns `{"sub":"default"}` (`backend/auth/entra.py:127`) | Host `az login` → `DefaultAzureCredential` | Easiest dev path |
| Docker dev | Same as local | SP env vars (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`) → `EnvironmentCredential` | App registration with `Cognitive Services OpenAI User` role |
| Docker prod-like | Optional `AUTH_ENABLED=true` | Either `AZURE_OPENAI_KEY` or mounted credentials | For local prod parity |
| Container Apps | `AUTH_ENABLED=true` + Entra JWT validation (`backend/auth/entra.py`) | User-assigned managed identity (`infra/modules/identity.bicep`) | Production target |

## Feature highlights

- 39 LLM-callable tools across 23 domains (`backend/tools/domains/`)
- 34 chat modes (`backend/tools/tool_definitions.py:34`)
- Architecture mode emits Bicep + Terraform + ARM + draw.io + cost + ADR in one stream
- RAG over Microsoft Learn with cached cosine similarity (`backend/services/rag_service.py`)
- Optional MCP tools auto-discovered from `@azure/mcp` (`backend/services/mcp_service.py`)
- Live Azure scanner: drift detection via Resource Graph (`backend/services/azure_scan_service.py`)
- Cost MTD, anomaly KQL, budget Bicep emitter (`backend/routes/cost.py`)
- Security posture: Defender + policy compliance roll-up (`backend/services/security_posture_service.py`)
- CI/CD emitter: GitHub Actions + Azure DevOps pipelines (`backend/services/cicd_emitter.py`)
- Multicloud comparator (AWS / GCP equivalents) (`backend/services/multicloud_service.py`)
- Export to PPTX (`backend/services/pptx_service.py`)
- Curated Reference Architecture library ingested weekly from the Microsoft Learn ContentBrowser API (~220 entries) — `backend/services/refarch_ingest.py`, Sun 04:17 UTC
- Demo Showcase ingested weekly from `Azure/awesome-azd` (msft-tagged templates only, ~214 entries) — `backend/services/demo_ingest.py`, Sun 04:42 UTC
- Source-aware mutation model on both libraries: `microsoft_official` / `community` rows are read-only (except the user-toggled `featured` flag); `custom` rows remain fully editable. User toggles survive every weekly refresh.
- On-demand admin ingest endpoints: `POST /api/refarch/ingest`, `POST /api/demos/ingest` (gated on the `Metrics.Read` app role)
- 23 backend pytest functions across 6 test files, 7 frontend Vitest tests across 4 files

## Repository layout

```
azure-architect-ai/
  backend/        FastAPI app, services, tools, tests
    routes/       19 routers mounted under /api
    services/     22 service modules + iac/ subpackage
    tools/        Tool catalog (23 domains, 39 tools)
    prompts/      System prompt templates
    auth/         Entra JWT validation
    middleware/   Logging + request context
    tests/        Pytest suite
  frontend/       Vite + React + Fluent UI v9
    src/          Components, hooks, auth, utils
  infra/          Bicep
    main.bicep    Subscription-scope entrypoint
    modules/      12 modules (network, kv, openai, postgres, aca, ...)
  .github/workflows/  ci.yml | infra.yml | deploy.yml
  docs/           Long-form documentation
  SPECIFICATION.md  Formal spec
  docker-compose.yml         dev (bind mounts)
  docker-compose.prod.yml    prod-like (built images)
  alembic.ini                migration config
  pyproject.toml
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `DefaultAzureCredential failed to retrieve a token` | Not logged in / wrong tenant | `az login --tenant <tenantId>`; or set `AZURE_OPENAI_KEY` |
| MCP tools missing from a mode | `MCP_ENABLED=false` or `npx` not on PATH | Install Node 20+; check backend logs for `mcp.init_failed` |
| RAG returns no results | Reindex not run | `POST /api/rag/reindex/reference-archs` |
| Frontend 401s after `AUTH_ENABLED=true` | No bearer token | Sign in via MSAL; check `VITE_ENTRA_*` env vars |
| Container Apps revision unhealthy | Image pull denied | Confirm UAMI has `AcrPull` on ACR (see `infra/modules/containerregistry.bicep`) |
| Reference Architecture / Demo Showcase library is empty | `INGEST_ENABLED=false` or the weekly job hasn't fired yet | Set `INGEST_ENABLED=true` and either wait for Sun 04:17/04:42 UTC, or trigger manually: `POST /api/refarch/ingest` and `POST /api/demos/ingest` (caller needs the `Metrics.Read` app role) |
| Edit / delete buttons hidden on a library entry | Row's `source` is `microsoft_official` or `community` | Expected — curated rows are read-only except the `featured` toggle. Use a `custom`-sourced entry to author your own. |

## License

Internal / unspecified. Add a `LICENSE` file before publishing externally.
