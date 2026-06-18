# azure-architect-ai

Virtual Azure Solutions Architect web app. FastAPI + React (Vite + TypeScript + Fluent UI v9) + Azure OpenAI + draw.io. Local Docker Compose.

**Layout**: `backend/` (FastAPI, pytest), `frontend/` (React), `infra/` (Bicep), `docs/`.

**Deep context**: invoke `/aaai` skill at `.claude/skills/aaai/SKILL.md` for SSE conventions, pipeline architecture, persistence layers, and the recipe for adding a new pipeline phase.

## Trusted-oracle stack (Themes 1–4)

- **5-agent surface** behind feature flag `VITE_UNIFIED_AGENTS=true` (frontend) and `UNIFIED_AGENTS=true` (backend router). When true, SideNav collapses to: `architect`, `cost`, `operations`, `compliance`, `engagement`. Flag-off path still serves all 84 legacy modes — both routes remain wired during the migration window.
- **AgentPanel** (`frontend/src/components/AgentPanel.tsx`) is a thin wrapper that forwards an agent token through `ChatPanel`. `isAgentToken()` type guard gates the dispatch in `App.tsx::renderMode()`.
- **Engagement scope**: `Engagement` model (`backend/db.py`) carries `subscription_ids`, `compliance_frameworks`, `region_preference`, and `reservation_commitments`. Active engagement is propagated via `engagement_id_var` ContextVar (mirrors `tenant_id_var`) and the `X-Engagement-Id` request header. Frontend `apiFetch` injects the header automatically when an engagement is selected.
- **Cost emitter is RI-aware**: `services/reservations_service.apply_reservation_discounts()` adjusts `cost_estimate` SSE payloads when the active engagement declares `reservation_commitments`. Applied in both `routes/architecture.py` and `routes/chat.py`.
- **Citations**: every chip carries `corpus` (learn / azure_updates / avm / reference_archs / sdk_releases), `published_at`, `freshness_days`, and reranker `confidence`. When retrieval confidence falls below floor, `routes/chat.py` swaps to honesty mode and prefixes the answer with "I'm not confident…".
- **Reranker cache**: `services/rag_reranker.py` keys by `hash(query + doc_ids)` with 24 h TTL.
- **Scheduled ingests** (`services/scheduler.py`): `azure_updates_ingest_daily`, `avm_ingest_weekly`, `refarch_ingest_weekly`, `demo_ingest_weekly`. Tests should use `issubset` rather than strict equality when asserting job IDs.

## Quirks that will bite you

- `useWorkloadSpec()` returns `{ spec, setSpec }` — **not** `updateSpec`.
- Fluent v9 `makeStyles` rejects standalone `borderColor: string` (`Type 'string' is not assignable to type 'undefined'`). Use full `border: "1px solid #..."` shorthand.
- No toaster wired up. Use `MessageBar` + `setTimeout(() => setMessage(null), 4000)` for transient notices.
- When a Fluent icon import fails, enumerate available names: `node -e "console.log(Object.keys(require('@fluentui/react-icons')).filter(k=>k.toLowerCase().includes('<term>')).join('\n'))"`.

## Commands

- Backend tests: `cd backend && pytest tests/ -v`
- Frontend typecheck: `cd frontend && npx tsc --noEmit`
- Dev stack: `docker compose up`

## Conventions

- One panel per `Mode` in `frontend/src/App.tsx`. Panel props: `{ onRefine, onSave, initialSession, conversationId|sessionId, onContinueIn? }`.
- SSE events flow through `_relay_sse` in `backend/routes/analyze.py` — every event is tagged with `_job` and (in pipeline mode) `_phase`.
- All persistence is localStorage keys prefixed `azure_*`. Telemetry debug drawer: **Ctrl+Shift+T**.
- Pipeline mode chains context via `## Prior Step — <Name>` headers injected into each subsequent `ArchRequest.requirements`.
