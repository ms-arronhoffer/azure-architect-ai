# `infra/` — Azure deployment

Subscription-scope Bicep that provisions Azure Architect AI as a monolith on
Azure Container Apps with private images in ACR, Azure OpenAI, Key Vault, and
an Azure Files share for SQLite persistence.

## Files

| File | Purpose |
|---|---|
| `main.bicep` | Entrypoint (subscription scope). Creates RG and invokes modules. |
| `main.bicepparam` | Parameter values (env, prefix, location, image references). |
| `modules/identity.bicep` | User-assigned managed identity used by both apps. |
| `modules/containerregistry.bicep` | Premium ACR. Grants `AcrPull` to the MI. |
| `modules/keyvault.bicep` | RBAC-mode KV. Grants `Key Vault Secrets User` to the MI. |
| `modules/storage.bicep` | Storage account + Azure Files share for `/app/data` (SQLite). |
| `modules/openai.bicep` | Azure OpenAI account + model deployments. Grants `Cognitive Services OpenAI User` to the MI. |
| `modules/containerapps-env.bicep` | ACA managed environment + Log Analytics + App Insights + env-scoped Azure Files storage definition. |
| `modules/containerapp.bicep` | Reusable Container App. Used for backend (internal) and frontend (external). |

## First-time deploy

```bash
# 1) provision platform (placeholder images — won't serve traffic yet)
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

# 2) capture outputs
RG=$(az deployment sub show -n main --query properties.outputs.resourceGroupName.value -o tsv)
ACR=$(az deployment sub show -n main --query properties.outputs.acrLoginServer.value -o tsv | cut -d. -f1)

# 3) build & push the real images using ACR Tasks (no local Docker needed)
az acr build -r "$ACR" -t aa-backend:v1  -f backend/Dockerfile.prod  ./backend
az acr build -r "$ACR" -t aa-frontend:v1 -f frontend/Dockerfile.prod ./frontend

# 4) redeploy pointing at the real images
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters backendImage="$ACR.azurecr.io/aa-backend:v1" frontendImage="$ACR.azurecr.io/aa-frontend:v1"

# 5) open the SPA
az deployment sub show -n main --query properties.outputs.frontendUrl.value -o tsv
```

## Auth model

The user-assigned managed identity (`identity.bicep`) is the only principal that
talks to OpenAI, KV, and ACR. The backend's existing
`services/openai_service.py:24-32` `DefaultAzureCredential` path picks up the
workload identity automatically — **no code change needed** between local
`az login` and ACA managed identity modes. `AZURE_CLIENT_ID` is exported into
the backend so the credential picks the right identity when more than one is
present.

## What's intentionally NOT here yet

These are roadmap, not gaps:

- VNet + private endpoints (everything is public-ingress today)
- Postgres + pgvector (SQLite on file share is the v1 store)
- Front Door / WAF
- Per-service identities (single MI keeps role-assignment sprawl low)
- 8-service decomposition (monolith now; carve in follow-up — see `plans/`)

## Cost (rough monthly, dev env, `eastus2`)

| Resource | Cost |
|---|---|
| ACA env + 2 apps (min 1 replica each) | ~$45 |
| Log Analytics + App Insights (low ingest) | ~$10 |
| Azure OpenAI (pay-per-token; 50K capacity but only billed on use) | $0 idle |
| ACR Premium | ~$50 |
| Storage (10 GB file share) | ~$1 |
| Key Vault | ~$1 |
| **Total idle** | **~$107/mo** |

ACR Premium is the largest fixed cost — drop to `Basic` (~$5/mo) if you don't
need private link, geo-replication, or content trust. Edit
`modules/containerregistry.bicep`.
