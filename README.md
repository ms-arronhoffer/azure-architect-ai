# Azure Architect AI

A full-featured virtual Azure Solutions Architect — 15 specialist modes covering expert Q&A, architecture design, WAF assessments, compliance mapping, migration planning, cost optimization, DR/BC design, and more.

## Quick Start (Local Dev)

### Prerequisites
- Docker Desktop (or Docker + Docker Compose)
- Azure OpenAI resource with `gpt-4.1` and `gpt-4o-mini` deployments

### 1. Configure environment

```bash
cd azure-architect-ai
cp .env.example .env
# Edit .env with your Azure OpenAI credentials
```

`.env` values:

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Your Azure OpenAI endpoint URL |
| `AZURE_OPENAI_KEY` | API key (see note below on keyless auth) |
| `AZURE_OPENAI_DEPLOYMENT_CHAT` | Deployment for chat modes (default: `gpt-4o-mini`) |
| `AZURE_OPENAI_DEPLOYMENT_ARCH` | Deployment for architecture/design modes (default: `gpt-4.1`) |
| `AZURE_OPENAI_API_VERSION` | API version (default: `2024-12-01-preview`) |

> **API key vs. `az login`:** The app currently uses `AZURE_OPENAI_KEY` (API key auth). It does **not** use `az login` / `DefaultAzureCredential` by default. If you want keyless auth (managed identity or developer credentials via `az login`), remove `AZURE_OPENAI_KEY` from `.env` and update `backend/services/openai_service.py` to use `azure.identity.DefaultAzureCredential` as the `azure_ad_token_provider`. Add `azure-identity` to `requirements.txt`.

### 2. Run without Docker

**Backend:**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend (separate terminal):**
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

### 3. Run with Docker Compose

```bash
docker compose up --build
```

Open `http://localhost:5173`

---

## Features

### Advisory
| Mode | Description |
|------|-------------|
| **Expert Q&A** | Ask any Azure question — answers with cited Microsoft Learn sources |
| **Situation Advisor** | Navigate difficult stakeholder, vendor, and migration scenarios |
| **Presentation Coach** | Structure Azure topics compellingly for exec or technical audiences |
| **Cert Prep** | Study for AZ-305, AZ-500, AZ-104, AZ-700, and more with scenario coaching |
| **Regional Advisor** | Region selection, availability zone coverage, data residency, sovereign clouds |

### Design & Build
| Mode | Description |
|------|-------------|
| **Architecture Design** | Requirements → draw.io diagram + runbook + Bicep IaC + cost estimate |
| **Reference Library** | Browse 15 curated Azure reference architectures with WAF scores and filters |
| **Service Comparison** | Side-by-side structured comparison of Azure services with a recommendation |

### Assessment
| Mode | Description |
|------|-------------|
| **WAF Assessment** | Describe an architecture → scored findings across all 5 WAF pillars |
| **Architecture Review** | Red-team an architecture — severity-tagged gaps and pillar scores |
| **Compliance Mapping** | Map to HIPAA, PCI-DSS, SOC 2, FedRAMP, GDPR, ISO 27001, NIST, CIS |
| **Migration Assessment** | 6 R's analysis, effort estimates, risk level, and wave planning |

### Operations
| Mode | Description |
|------|-------------|
| **Cost Optimization** | FinOps analysis with Azure Retail Pricing API estimates and savings recommendations |
| **Monitoring Config** | Alert rules, KQL queries, and dashboard configs for your architecture |
| **DR/BC Design** | Recovery pattern recommendation (hot/warm/cold/pilot-light/active-active), RTO/RPO configs, and failover runbook |

---

## UI

- **Collapsible side navigation** — 15 modes in 4 sections; collapses to icon-only (48px) to maximize content area
- **Conversation history** — All chat conversations auto-persist to `localStorage`; browse, reload, and delete from the history drawer
- **Streaming responses** — All LLM output streams token-by-token via SSE
- **Structured result cards** — Tool call outputs (cost tables, compliance gap lists, comparison matrices, DR strategy cards, migration assessments, monitoring configs) render as rich inline cards
- **Dark / light theme toggle** — Fluent UI v9 themes
- **File upload** — Attach `.txt`, `.md`, `.json`, `.yaml`, `.bicep`, `.tf`, `.ps1`, `.sh`, `.csv` files into any chat input

---

## Architecture

```
frontend (React 18 + Fluent UI v9 + Vite, port 5173)
    ↓ SSE streaming (text/event-stream)
backend (FastAPI + Python 3.11, port 8000)
    ↓ Azure OpenAI tool use loop (10 tools)
Azure OpenAI (gpt-4.1 / gpt-4o-mini)
    ├── search_azure_docs     → Microsoft Learn Search API (public, no key)
    ├── design_architecture   → drawpyo draw.io XML (azure2 stencils)
    ├── generate_bicep        → Bicep IaC + param file + deploy commands
    ├── estimate_costs        → Azure Retail Pricing API (public, no key)
    ├── assess_waf_pillar     → 5-pillar WAF scoring
    ├── generate_monitoring_config → Alert rules + KQL queries
    ├── compare_services      → Structured comparison matrix
    ├── map_compliance        → Framework gap analysis
    ├── assess_migration      → 6 R's assessment
    └── design_dr_strategy    → Pattern + service configs + failover runbook
```

---

## Project Structure

```
azure-architect-ai/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── main.py                     # FastAPI app, CORS, router registration
│   ├── config.py                   # pydantic-settings (env vars)
│   ├── routes/
│   │   ├── chat.py                 # POST /api/chat — SSE + tool dispatch
│   │   ├── architecture.py         # POST /api/architecture — design/review/WAF/DRBC
│   │   ├── reference.py            # GET  /api/reference-architectures
│   │   └── health.py               # GET  /api/health
│   ├── services/
│   │   ├── openai_service.py       # AzureOpenAI streaming client
│   │   ├── docs_service.py         # MS Learn Search API wrapper
│   │   ├── diagram_service.py      # draw.io XML generator (drawpyo)
│   │   ├── runbook_service.py      # Markdown runbook builder
│   │   └── pricing_service.py      # Azure Retail Pricing API client
│   ├── tools/
│   │   └── tool_definitions.py     # All 10 OpenAI function schemas + TOOLS_BY_MODE
│   ├── prompts/
│   │   └── system_prompt.py        # 9 system prompts + MODE_TEMPLATES
│   └── data/
│       └── reference_archs.py      # 15 curated reference architecture records
└── frontend/
    └── src/
        ├── App.tsx                 # SideNav + Header + HistoryDrawer layout
        ├── types.ts                # All TypeScript interfaces and unions
        ├── hooks/
        │   ├── useSSE.ts           # SSE streaming hook
        │   ├── useChat.ts          # Chat state + structured result mapping
        │   └── useConversationHistory.ts  # localStorage persistence
        └── components/
            ├── SideNav.tsx         # Collapsible 15-mode navigation
            ├── Header.tsx          # Brand + mode label + history + theme
            ├── HistoryDrawer.tsx   # Conversation history overlay drawer
            ├── ChatPanel.tsx       # Chat input + message list (10 modes)
            ├── ChatMessage.tsx     # Markdown + 6 structured result card renderers
            ├── ArchitecturePanel.tsx  # Design form + 5 result tabs (Explanation/Diagram/Runbook/Bicep/Cost)
            ├── ReferenceLibrary.tsx   # Catalog browser with search, filters, detail panel
            ├── WAFPanel.tsx        # WAF assessment form + pillar accordions
            ├── ReviewPanel.tsx     # Architecture review + pillar scores
            └── DRBCPanel.tsx       # DR/BC form + strategy card + runbook accordion
```
