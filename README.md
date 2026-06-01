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

```bash
docker compose up --build
# backend  http://localhost:8000
# frontend http://localhost:5173
```

`docker-compose.yml` bind-mounts source for hot reload and mounts your host `~/.azure` into the backend container so `DefaultAzureCredential` picks up your existing `az login` session.

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
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | unset | Enables OTel export to Azure Monitor |

## Auth matrix

| Environment | Backend auth | Azure OpenAI auth | Notes |
| --- | --- | --- | --- |
| Local (`uvicorn`) | `AUTH_ENABLED=false` (default) → `require_user` returns `{"sub":"default"}` (`backend/auth/entra.py:127`) | Host `az login` → `DefaultAzureCredential` | Easiest dev path |
| Docker dev | Same as local | Host `~/.azure` mounted into container | See `docker-compose.yml` |
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

## License

Internal / unspecified. Add a `LICENSE` file before publishing externally.
