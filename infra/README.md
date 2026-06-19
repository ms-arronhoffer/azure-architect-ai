# `infra/` — Azure deployment

Subscription-scope Bicep that provisions Azure Architect AI on Azure Container
Apps with VNet injection, private Postgres Flexible Server, Key Vault, Azure
OpenAI, Azure Container Registry, and an optional Azure Front Door.

For workflow / Entra / custom-domain details see [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Environments

| Env | Branch | RG | Param file |
|---|---|---|---|
| **prod** | `main` | `aarch-dev-rg` | `main.bicepparam` |
| **test** | `dev` | `aarch-test-rg` | `main.test.bicepparam` |

Both envs share the AOAI account (`aarch-dev-aoai`) and ACR (`aarchdevacr`)
which live in `aarch-dev-rg`. The test stack sets `deployOpenAi=false` and
`deployAcr=false`; cross-RG role assignments are created by
`modules/openai-grant.bicep` and `modules/acr-grant.bicep`.

## Files

| File | Purpose |
|---|---|
| `main.bicep` | Entrypoint (subscription scope). Creates RG and invokes modules. |
| `main.bicepparam` | Prod parameter values. |
| `main.test.bicepparam` | Test parameter values (shares AOAI/ACR with prod). |
| `modules/identity.bicep` | User-assigned managed identity used by both apps. |
| `modules/network.bicep` | VNet (3 subnets) + private DNS zones for KV/PG/AOAI. |
| `modules/containerregistry.bicep` | Premium ACR. Grants `AcrPull` to the MI. |
| `modules/acr-grant.bicep` | Cross-RG `AcrPull` for the test MI on the shared ACR. |
| `modules/keyvault.bicep` | RBAC-mode KV + private endpoint. Grants `Key Vault Secrets User` to the MI. |
| `modules/storage.bicep` | Storage account + Azure Files share for `/app/data`. |
| `modules/openai.bicep` | Azure OpenAI account + model deployments. Grants `Cognitive Services OpenAI User` to the MI. |
| `modules/openai-grant.bicep` | Cross-RG OpenAI role assignment for the test MI on the shared AOAI. |
| `modules/postgres.bicep` | Flexible Server (VNet-injected) + private DNS. |
| `modules/monitoring.bicep` | Log Analytics + Application Insights + alerts. |
| `modules/search.bicep` | Optional Azure AI Search (`deploySearch=true`). |
| `modules/containerapps-env.bicep` | ACA managed environment + env-scoped Azure Files definition. |
| `modules/containerapp.bicep` | Reusable Container App (backend + frontend). Binds custom domains from `frontendCustomDomains`. |
| `modules/frontdoor.bicep` | Optional Azure Front Door (`deployFrontDoor=true`). |

## Deploy

Day-to-day deploys run through `.github/workflows/infra.yml` and
`.github/workflows/deploy.yml`. For manual deploys:

```bash
# prod
az deployment sub create --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

# test (env vars must be exported for readEnvironmentVariable() params)
az deployment sub create --location centralus \
  --template-file infra/main.bicep \
  --parameters infra/main.test.bicepparam
```

## Auth model

A single user-assigned managed identity per env (`identity.bicep`) is the only
principal that talks to OpenAI, KV, Postgres, and ACR. The backend's
`DefaultAzureCredential` path picks up the workload identity automatically — no
code change between local `az login` and ACA managed identity modes.
`AZURE_CLIENT_ID` is exported into the backend so the credential picks the right
identity when more than one is present.

For the test env, the cross-RG grants in `openai-grant.bicep` / `acr-grant.bicep`
give the test MI the same roles on the shared dev AOAI/ACR.

## Custom domains

Each env's frontend has a managed TLS cert bound to a custom hostname:

| Env | Hostname |
|---|---|
| prod | `blueprint.techtools.host` |
| test | `dev.blueprint.techtools.host` |

Bindings are declared in `frontendCustomDomains` in each env's bicepparam, so
re-applying Bicep preserves them. Cert provisioning itself is a one-time manual
step (`az containerapp env certificate create --validation-method CNAME` then
`az containerapp hostname bind`).

## Roadmap

- Private endpoints on every PaaS service (KV + AOAI already private; ACR + Storage pending)
- WAF policy attached to Front Door
- Per-service identities (single MI keeps role-assignment sprawl low today)
- AUTH_ENABLED enforced via Bicep instead of env var
