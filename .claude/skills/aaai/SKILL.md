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

## Trusted-oracle stack (Themes 1–4)

### Knowledge corpus (Theme 1)
- `services/azure_updates_ingest.py` — daily RSS poll, writes `RagDocument(corpus="azure_updates", published_at=…)`.
- `services/avm_ingest.py` — weekly Azure/bicep-registry-modules pull, writes `corpus="avm"` with `module_path` + `version` metadata.
- `services/refarch_ingest.py` — also writes to `RagDocument(corpus="reference_archs")`; no longer needs the standalone `refarch_match.py`.
- All registered in `services/scheduler.py`: `azure_updates_ingest_daily`, `avm_ingest_weekly`, `refarch_ingest_weekly`, `demo_ingest_weekly`. Tests assert with `issubset`, never strict equality.

### Retrieval + citations (Theme 2)
- `services/rag_service.hybrid_search()` — rapidfuzz BM25 + cosine, RRF-merged top-30.
- `services/rag_reranker.py` — gpt-4o-mini reranker, top-30 → top-5 with score + reason. Cache key: `hash(query + doc_ids)`, 24 h TTL.
- `services/citation_service.py` — every citation carries `{url, title, corpus, published_at, freshness_days, confidence}`. Emitted via the existing SSE `citations` event payload (extended, not new).
- `services/rag_service` exposes `confidence_floor`; below floor → `unknown` flag → `routes/chat.py` swaps to honesty mode ("I'm not confident — closest matches are…").
- `frontend/src/components/ChatMessage.tsx` renders freshness badges + corpus chip + confidence ring.

### Cost truth (Theme 3)
- `services/retail_pricing_service.py` — layered over `pricing_service.py`, 1 h cache, prefers `azure-pricing-mcp` when available.
- `services/reservations_service.py` — Consumption API RI/SP recommendations + `break_even()` + `apply_reservation_discounts(estimate, commitments)`.
- `services/rightsizing_service.py` — Azure Monitor P95 CPU pulls. **`azure.monitor.query` is an optional import**: wrap usage in try/except and raise RuntimeError lazily; tests run without the SDK installed.
- `services/carbon_service.py` — region-keyed carbon-intensity × compute hours.
- `tools/domains/cost.py` — `live_price_lookup`, `analyze_reservations`, `recommend_rightsizing`, `estimate_carbon`, `compare_payg_vs_ri`, `suggest_alternatives`, `request_clarification`.
- `routes/architecture.py` and `routes/chat.py` `estimate_costs` paths apply `apply_reservation_discounts` after `estimate_architecture` when the active engagement declares `reservation_commitments`. Adds `reservation_adjustments` + `reservation_monthly_savings` to the `cost_estimate` SSE payload.
- **Cheaper alternatives**: `services/sku_alternatives_service.py` reads the grounded equivalence map `knowledge/pricing/sku_alternatives.yaml` (regex pattern→replacement rules, e.g. Intel `D{n}s_v{ver}`→AMD `D{n}as_v{ver}`), prices each candidate via `pricing_service.estimate_line_item`, drops unpriced/auto-swapped candidates (never fabricates), and ranks cheapest-first. `suggest_alternatives` tool → `cost_alternatives` SSE event → `CostAlternativesCard`.
- **Clarify-before-pricing**: `service_catalog.yaml` services carry an optional `clarify:` block (disambiguation questions, `required: true` for size/engine/region); `cost_catalog.clarify_for(service)` + `public_catalog()['services'][].clarify` expose them. `request_clarification` tool → `clarification_request` SSE event → `ClarificationRequestCard` (quick-reply chips post the answer via `onQuickReply`→`sendMessage`). Prompt discipline added to `prompts/agents/cost.py`, `prompts/agents/architect.py`, and `system_prompt.COST_SYSTEM`.

### 5-agent surface + Engagement scope (Theme 4)
- Feature flag: `VITE_UNIFIED_AGENTS=true` (frontend) and `UNIFIED_AGENTS=true` (backend). The unified surface is **opt-in** — both must be explicitly truthy (`true`/`1`/`yes`/`on`) to enable it; unset/anything else uses the legacy 84-mode path.
- Agents: `architect`, `cost`, `operations`, `compliance`, `engagement`. Defined in `frontend/src/components/AgentPanel.tsx` (`AGENT_TOKENS`, `isAgentToken`). `App.tsx::renderMode()` dispatches via `isAgentToken(mode)` before any legacy panel branches.
- `SideNav.tsx` filters NAV_SECTIONS by flag; default-expands only the `Agents` section.
- `Header.tsx::MODE_LABELS` includes labels for the 5 agent tokens.
- `services/agent_router.py` — gpt-4o-mini classifier → `{agent, domain_fragments[], suggested_tools[]}`. 24 h cache.
- Prompts: `prompts/agents/{architect,cost,operations,compliance,engagement}.py` + `prompts/domain_fragments.py` (lazy-selected). `prompts/system_prompt.py` shrunk to ~20 KB.
- `tools/tool_definitions.TOOLS_BY_MODE` collapsed to the 5 agents; the 39 LLM tools themselves are unchanged.
- **Engagement scope**: `Engagement` model in `backend/db.py` with `subscription_ids`, `compliance_frameworks`, `region_preference`, `reservation_commitments`. Propagated via `engagement_id_var` ContextVar (mirrors `tenant_id_var`) and the `X-Engagement-Id` request header. Frontend `apiFetch` injects the header when an engagement is selected.
- `services/engagement_context.py` — `preamble_for_active()` returns the ~400-token Markdown block prefixed to the system prompt for any chat in that engagement's scope.
- `routes/engagements.py` — CRUD + `GET /api/engagements/{id}/context`.
- UI: `EngagementSelector.tsx` in `Header.tsx`; `EngagementDrawer.tsx` for CRUD. `WorkloadContextPanel` still serves the per-chat workload context (region, compliance framework, budget) and remains separate from Engagement.
- Audit events: `engagement.*`, plus new `rag.unknown_response` and `cost.reservation_recommended`.

## When extending the pipeline

1. Add a new mode to `ArchRequest.mode` and to `_stream_architecture` in `routes/architecture.py`.
2. Add a phase block in `_stream_pipeline` using `_relay_sse(..., phase="pipeline", container=<state>)`.
3. Extend `bundled_design` payload and the `BundledDesign` TS type in `frontend/src/types.ts`.
4. Add a tab to AnalysisPanel and to `markdownExport.ts`.
5. Add a test to `backend/tests/test_analyze_pipeline.py` mirroring the existing pattern (monkeypatch `_stream_architecture` to a fake async generator).
