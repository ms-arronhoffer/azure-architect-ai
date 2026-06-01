# Setup

Full developer setup for Azure Architect AI.

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Python | 3.11+ | Backend runtime |
| Node.js | 20+ | Frontend build, MCP subprocess (`npx @azure/mcp`) |
| Docker Desktop | latest | Optional, for Compose workflows |
| Azure CLI | latest | `az login` powers `DefaultAzureCredential` |
| An Azure OpenAI resource | with `gpt-4.1`, `gpt-4o-mini`, `text-embedding-3-small` deployments | Or use API key |

## 1. Clone and check out

```bash
git clone <your-fork-or-remote> azure-architect-ai
cd azure-architect-ai
```

## 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Environment file

Copy the example and edit:

```bash
cp .env.example .env
```

Minimum viable `.env`:

```
AZURE_OPENAI_ENDPOINT=https://my-aoai.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_CHAT=gpt-4o-mini
AZURE_OPENAI_DEPLOYMENT_ARCH=gpt-4.1
AZURE_OPENAI_DEPLOYMENT_EMBEDDING=text-embedding-3-small
```

If you cannot use Entra, add `AZURE_OPENAI_KEY=...`. See full config table in [README.md](../README.md#config-reference-backend-env).

### Database

The default uses SQLite at `backend/data/conversations.db`. The schema is auto-created via `init_db()` (`backend/db.py:init_db`).

For Postgres locally:

```
DATABASE_URL=postgresql+asyncpg://aa:aa@localhost:5432/aa
```

Alembic config is at `alembic.ini`; migrations live alongside it.

### Auth + secrets

- `AUTH_ENABLED=false` is the dev default. The dependency `require_user` short-circuits to `{"sub":"default"}` (`backend/auth/entra.py`).
- To store GitHub PATs (`/api/auth/github-token`), generate a Fernet key and set `SECRET_ENCRYPTION_KEY`:

  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```

### Run

```bash
uvicorn main:app --reload --port 8000
```

Health: `curl http://localhost:8000/api/healthz` (`backend/routes/health.py`).

## 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Frontend env file `frontend/.env.local` (only needed when enabling auth or pointing to a non-default backend):

```
VITE_API_BASE_URL=http://localhost:8000
VITE_ENTRA_CLIENT_ID=<spa-app-registration-id>
VITE_ENTRA_TENANT_ID=<tenant-id>
VITE_ENTRA_API_SCOPE=api://<api-app-id>/.default
```

MSAL config lives at `frontend/src/auth/msalConfig.ts`. `AuthGate` (`frontend/src/auth/AuthGate.tsx`) blocks rendering until MSAL acquires a token.

## 4. Docker Compose (dev)

```bash
docker compose up --build
```

- Backend: bind-mounts `./backend` and mounts host `~/.azure` (Linux/macOS) / `%USERPROFILE%/.azure` (Windows) into the container so `DefaultAzureCredential` reuses your `az login` session.
- Frontend: bind-mounts `./frontend` with a named `node_modules` volume.
- Hot reload works for both.

## 5. Docker Compose (prod-like)

```bash
docker compose -f docker-compose.prod.yml up --build
```

Builds the multi-stage production images (backend → `python:3.11-slim`, frontend → nginx-served static). Useful before pushing to ACR.

## 6. RAG

RAG over Microsoft Learn corpus + the bundled reference archs is enabled by default (`RAG_ENABLED=true`).

- The startup hook in `backend/main.py:42` calls `reindex_reference_archs()`.
- To rebuild manually: `POST /api/rag/reindex/reference-archs` (see `backend/routes/rag.py`).
- Embeddings are persisted as JSON in `RagDocument` rows (`backend/db.py`). Pure-Python cosine similarity is used; pgvector is on the roadmap (not yet implemented).

## 7. MCP (optional)

When `MCP_ENABLED=true`, `init_mcp` (`backend/services/mcp_service.py`) spawns `npx -y @azure/mcp@latest server start` as a stdio subprocess and registers any whitelisted tools with the `mcp_` prefix.

To disable: `MCP_ENABLED=false`.

## 8. Tests

Backend:

```bash
cd backend
pytest -q
```

Test files (6): `test_health.py`, `test_iac_emitters.py`, `test_naming_service.py`, `test_rag_service.py`, `test_token_budget.py`, `test_tool_registry.py` — 23 test functions in total.

Frontend:

```bash
cd frontend
npm test
```

Test files (4): `ChatMessage.test.tsx`, `StructuredResultCard.test.tsx`, `useSettings.test.ts`, `serviceMetadata.test.ts` — 7 specs.

## 9. Common issues

| Issue | Fix |
| --- | --- |
| `pydantic_settings` missing | `pip install -r requirements.txt` (must be inside venv) |
| Vite says port 5173 is in use | `npm run dev -- --port 5174` |
| `429 Too Many Requests` from Azure OpenAI | Increase deployment capacity or stagger requests |
| `az login` works but app still 401s | `az account set --subscription <id>`; restart backend |
| MCP subprocess fails on Windows | Ensure `npx.cmd` is on `PATH`; check backend logs for `mcp.init_failed` |
