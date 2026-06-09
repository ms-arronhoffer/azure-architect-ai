---
name: aaai
description: Project skill for azure-architect-ai (Virtual Azure Solutions Architect web app). Encodes repo layout, SSE streaming conventions, panel patterns, and quirks discovered while building this app. Invoke when working in c:\Users\arronhoffer\source\repos\azure-architect-ai\.
---

# azure-architect-ai

FastAPI + React + Azure OpenAI + draw.io. Local Docker Compose. Stack: Python 3.14 (pytest, pydantic, FastAPI) / TypeScript + Vite + React + Fluent UI v9.

## Layout

- `backend/routes/` — FastAPI routers (`analyze.py`, `architecture.py`, etc.)
- `backend/tests/` — pytest with `pytest-asyncio` (strict mode); monkeypatch `_stream_architecture` for pipeline tests
- `frontend/src/components/<Mode>Panel.tsx` — one panel per mode listed in `App.tsx`
- `frontend/src/hooks/` — `useWorkloadSpec`, `useConversationHistory`, `useSettings`, `useWorkloadContext`, `useServiceHealth`
- `frontend/src/utils/` — `telemetry.ts`, `pipelineState.ts`, `bundledDesignStore.ts`, `markdownExport.ts`
- `infra/` — Bicep; `docs/` — design notes

## SSE conventions (`backend/routes/analyze.py`)

- **Single relay helper**: `_relay_sse(gen, job, *, phase=None, container=None, yield_individually=True, collected=None)`. Tags each event with `_job` and optional `_phase`. If `container` is given, accumulates token text (`container["text"]`), runbook/bicep (`container["artifacts"]`), and `waf_pillars`. If `yield_individually=False`, appends to `collected` for batch emission.
- **Parallel mode** (`POST /api/analyze`): wraps `_relay_sse` with `_collect_tagged` and `asyncio.gather` four `_stream_architecture` calls.
- **Pipeline mode** (`POST /api/analyze/pipeline`): runs architecture → sizing → security → waf sequentially, injecting each prior text as `## Prior Step — <Name>` into the next request. Final event is `bundled_design` with `{architecture:{text,runbook,bicep}, sizing, security, waf:{pillars}}`.
- `ArchRequest.mode ∈ {"architecture","sizing","security","waf"}` drives `_stream_architecture`.

## Frontend mode system (`App.tsx`)

- `Mode` union in `frontend/src/types.ts`. Each mode renders one panel in `App.renderMode()`.
- `ARCH_MODES` and `PANEL_MODES` arrays gate routing — keep in sync when adding modes.
- Panel prop convention: `{ onRefine, onSave, initialSession, conversationId|sessionId, onContinueIn? }`.
- `handleContinueIn(targetMode, seed)` lets a panel push a seed `ChatMessage` and switch modes (used by Bundled → Refine in Chat).

## Quirks (learned the hard way)

- **`useWorkloadSpec()` returns `{ spec, setSpec }`** — NOT `updateSpec`.
- **Fluent v9 `makeStyles` rejects standalone `borderColor: string`** with `Type 'string' is not assignable to type 'undefined'`. Use full `border: "1px solid #..."` shorthand instead.
- **No toaster wired up**. For transient notices use the existing pattern: `MessageBar` with `setTimeout(() => setMessage(null), 4000)`.
- **Fluent icon lookup**: when an import like `ArrowCompareRegular` doesn't exist, enumerate with `node -e "console.log(Object.keys(require('@fluentui/react-icons')).filter(k=>k.toLowerCase().includes('compare')).join('\n'))"`. Current compare icon: `ColumnDoubleCompareRegular`.

## Persistence layers (all localStorage)

- `azure_pipeline_state` — partial pipeline run with `request_hash`; AnalysisPanel offers Resume on mount when hash matches.
- `azure_saved_designs` — `SavedDesign[]` with `spec_hash` / `spec_snapshot`; grouped in UI by spec hash.
- `azure_app_telemetry` — counters via `track({kind, ...})`; view with **Ctrl+Shift+T** (TelemetryDebugDrawer).
- `azure_workload_spec` / `azure_workload_context` / conversation history — each owned by its hook.

## Commands

- Backend tests: `cd backend && pytest tests/ -v`
- Pipeline tests only: `pytest tests/test_analyze_pipeline.py -v`
- Type check: `cd frontend && npx tsc --noEmit`
- Dev stack: `docker compose up` (prod: `docker-compose.prod.yml`)

## When extending the pipeline

1. Add a new mode to `ArchRequest.mode` and to `_stream_architecture` in `routes/architecture.py`.
2. Add a phase block in `_stream_pipeline` using `_relay_sse(..., phase="pipeline", container=<state>)`.
3. Extend `bundled_design` payload and the `BundledDesign` TS type in `frontend/src/types.ts`.
4. Add a tab to AnalysisPanel and to `markdownExport.ts`.
5. Add a test to `backend/tests/test_analyze_pipeline.py` mirroring the existing pattern (monkeypatch `_stream_architecture` to a fake async generator).
