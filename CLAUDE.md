# azure-architect-ai

Virtual Azure Solutions Architect web app. FastAPI + React (Vite + TypeScript + Fluent UI v9) + Azure OpenAI + draw.io. Local Docker Compose.

**Layout**: `backend/` (FastAPI, pytest), `frontend/` (React), `infra/` (Bicep), `docs/`.

**Deep context**: invoke `/aaai` skill at `.claude/skills/aaai/SKILL.md` for SSE conventions, pipeline architecture, persistence layers, and the recipe for adding a new pipeline phase.

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
