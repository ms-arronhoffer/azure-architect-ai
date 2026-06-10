# Azure Deployment Plan — azure-architect-ai

**Status:** `Validated`
**Date:** 2026-06-09
**Mode:** MODIFY (infra already deployed; build and push real container images)

---

## 1. Project Summary

| Field | Value |
|-------|-------|
| App | azure-architect-ai |
| Stack | FastAPI backend + React/Vite frontend |
| Hosting | Azure Container Apps (two apps: backend internal, frontend external) |
| Subscription | MCAPS-Hybrid-REQ-133815-2025-arronhoffer (`79398e05-f318-4010-a508-d913c3763e39`) |
| Tenant | Non-Prod (`16b3c013-d300-468d-ac64-7eda0820b6d3`) |
| Region | centralus |
| Resource Group | `aarch-dev-rg` (exists) |

---

## 2. Current State

Infrastructure is fully deployed. Both container apps are running the placeholder image `mcr.microsoft.com/azuredocs/aci-helloworld:latest`. This plan builds and pushes the real application images via ACR Tasks, then updates each container app.

---

## 3. Recipe

**Type:** `AZCLI` — raw `az` commands (no `azure.yaml`; project uses Bicep + az CLI natively per `docs/DEPLOYMENT.md`)

---

## 4. Architecture (existing)

| Resource | Name |
|----------|------|
| Resource Group | `aarch-dev-rg` |
| ACR | `aarchdevacr.azurecr.io` |
| Backend Container App | `aarch-dev-backend` (internal) |
| Frontend Container App | `aarch-dev-frontend` (external, public) |
| Key Vault | `aarch-dev-kv-zguaqvtsqxx` |
| Managed Identity (UAMI) | client id `e0bbe182-9794-453c-8efe-a48e0b6ac4f0` |
| Azure OpenAI | `https://aarch-dev-aoai.openai.azure.com/` |
| PostgreSQL | `aarch-dev-pg-7s6kzxncbhezw.postgres.database.azure.com` |
| Entra SPA App | `azure-architect-ai-spa` (`e9616e6b-3c8b-4153-b814-b01817c9ade2`) |
| Frontend URL | `https://aarch-dev-frontend.victoriouswave-14404e90.centralus.azurecontainerapps.io` |
| ACA Environment | VNet-injected (`aca-subnet`), workload profile Consumption |
| Models | `gpt-5.4` (2026-03-05), `gpt-5.4-mini` (2026-03-17) |

---

## 5. Deployment Steps

### Step 1 — Build backend image via ACR Tasks
```bash
az acr build \
  --registry aarchdevacr \
  --image aa-backend:latest \
  --file backend/Dockerfile.prod \
  .
```

### Step 2 — Build frontend image via ACR Tasks (with MSAL build args)
```bash
az acr build \
  --registry aarchdevacr \
  --image aa-frontend:latest \
  --file frontend/Dockerfile.prod \
  --build-arg VITE_AUTH_ENABLED=true \
  --build-arg VITE_ENTRA_TENANT_ID=16b3c013-d300-468d-ac64-7eda0820b6d3 \
  --build-arg VITE_ENTRA_CLIENT_ID=e9616e6b-3c8b-4153-b814-b01817c9ade2 \
  --build-arg "VITE_ENTRA_API_SCOPE=api://e9616e6b-3c8b-4153-b814-b01817c9ade2/access_as_admin" \
  ./frontend
```

### Step 3 — Update backend container app
```bash
az containerapp update \
  --resource-group aarch-dev-rg \
  --name aarch-dev-backend \
  --image aarchdevacr.azurecr.io/aa-backend:latest
```

### Step 4 — Update frontend container app
```bash
az containerapp update \
  --resource-group aarch-dev-rg \
  --name aarch-dev-frontend \
  --image aarchdevacr.azurecr.io/aa-frontend:latest
```

### Step 5 — Smoke test
```bash
curl -sIL https://aarch-dev-frontend.bluefield-debdcece.centralus.azurecontainerapps.io/ | grep "HTTP/"
```

---

## 6. Entra Auth Configuration

- `VITE_AUTH_ENABLED=true` baked into frontend image at build time
- `VITE_ENTRA_TENANT_ID=16b3c013-d300-468d-ac64-7eda0820b6d3`
- `VITE_ENTRA_CLIENT_ID=e9616e6b-3c8b-4153-b814-b01817c9ade2`
- `VITE_ENTRA_API_SCOPE=api://e9616e6b-3c8b-4153-b814-b01817c9ade2/access_as_admin`
- Backend `ENTRA_TENANT_ID` and `ENTRA_AUDIENCE` already set via Bicep deployment

> **Note:** Admin consent for `azure-architect-ai-spa` must be granted before auth will work end-to-end (see Entra issue addressed separately).

---

## 7. Validation Proof

**Validated:** 2026-06-09

| Check | Command | Result |
|-------|---------|--------|
| az CLI auth | `az account show --subscription 79398e05...` | ✅ Enabled, correct subscription |
| ACR exists | `az acr show --name aarchdevacr` | ✅ Premium, `aarchdevacr.azurecr.io` |
| ACR registry identity | `az containerapp show ... --query properties.configuration.registries` | ✅ UAMI configured as registry identity |
| Backend container app | `az containerapp show -n aarch-dev-backend` | ✅ Exists (placeholder image, Failed state expected) |
| Frontend container app | `az containerapp show -n aarch-dev-frontend` | ✅ Exists (placeholder image, Failed state expected) |
| backend/Dockerfile.prod | file check | ✅ Exists |
| frontend/Dockerfile.prod | file check | ✅ Exists |
| Entra redirect URI | Graph PATCH + verify | ✅ Fixed — `https://aarch-dev-frontend.bluefield-debdcece.centralus.azurecontainerapps.io/` confirmed |

**Issues found and resolved:**
- SPA `redirectUris` was empty → restored via `PATCH /v1.0/applications/{id}` with Graph API
- Container app `provisioningState: Failed` → expected; caused by placeholder image port mismatch, resolved by deploying real images

---

## 8. Risks / Notes

- Both ACR builds may take 3–5 minutes each (backend includes Node.js + Python deps)
- No infra changes — Bicep is not re-run
- Rollback: `az containerapp update --image mcr.microsoft.com/azuredocs/aci-helloworld:latest`
