# CAF Resource Naming — Components & Abbreviations

Microsoft's Cloud Adoption Framework recommends composing resource names from a
consistent set of components, delimited by hyphens where the resource allows it:

```
<resource-type-abbrev>-<workload/app>-<environment>-<region>-<instance>
```

- **resource-type-abbrev** — the standard short code for the resource type.
- **workload/app** — the workload or application name.
- **environment** — `dev`, `test`, `stage`, `prod`, etc.
- **region** — a short code for the Azure region (e.g. `eus`, `wus2`, `weu`).
- **instance** — a zero-padded ordinal (e.g. `001`) for multiple instances.

## Common resource type abbreviations

| Resource type | Abbreviation |
|---|---|
| Resource group | `rg` |
| Virtual network | `vnet` |
| Subnet | `snet` |
| Network security group | `nsg` |
| Public IP address | `pip` |
| Load balancer (internal) | `lbi` |
| Application gateway | `agw` |
| Azure Firewall | `afw` |
| Virtual machine | `vm` |
| VM scale set | `vmss` |
| AKS cluster | `aks` |
| App Service plan | `plan` |
| App Service / Web App | `app` |
| Function App | `func` |
| Azure SQL Database server | `sql` |
| Azure SQL Database | `sqldb` |
| Cosmos DB account | `cosmos` |
| Azure Cache for Redis | `redis` |
| Storage account | `st` |
| Key Vault | `kv` |
| Container registry | `cr` |
| Log Analytics workspace | `log` |
| Application Insights | `appi` |
| API Management | `apim` |
| Event Hub namespace | `evhns` |
| Service Bus namespace | `sbns` |

## Resources with special constraints

Some resources are **globally unique** and/or disallow hyphens and uppercase.
Use a compact, lowercase, hyphen-free form and mind the length caps:

| Resource | Constraint |
|---|---|
| Storage account | 3–24 chars, lowercase letters + digits only, globally unique → e.g. `stpayprodeus001` |
| Key Vault | 3–24 chars, alphanumeric + hyphens, globally unique |
| Container registry | 5–50 chars, alphanumeric only, globally unique |
| Cosmos DB / SQL server | lowercase, globally unique DNS name |

When a composed name would violate a rule, drop delimiters and/or abbreviate the
workload token rather than silently truncating in the middle of a component.

## Enforcement

- Bake the convention into a **Bicep module** (`naming.bicep`) or **Terraform
  `locals`** so every resource name is derived, not hand-typed.
- Use **Azure Policy** (deny/audit on `name` with a `like`/`match` condition) to
  reject non-conforming names at deployment time.

Reference: Microsoft CAF — "Define your naming convention" and
"Abbreviation recommendations for Azure resources".
