# Cost Optimize — Meter-Aware Pricing & Template Reference

The **Cost Optimize** tool prices an Azure workload across **every billing meter** of
each service (not a single SKU rate), then runs a deterministic recommendations
engine that quantifies savings — all from manual input, with **no connected
subscription required**.

This document describes:

1. The cost-model **input template** (fields you can author or upload).
2. How each supported service is **priced** (its billing dimensions/meters).
3. The **recommendations** the engine produces.

---

## 1. Input template

You can drive the tool three ways:

- **Manual entry** in the panel (catalog-aware dimension fields appear once a
  recognized service is typed).
- **Upload** a template: YAML, JSON, or CSV (`Upload template` button).
- **Download** a documented starter template: `Sample YAML` / `CSV` / `JSON`
  buttons, served from `GET /api/cost/template/sample?format=yaml|csv|json`.

The canonical sample lives at
`backend/knowledge/pricing/sample_cost_model.yaml` (with `.csv` / `.json`
siblings).

### Top-level fields

| Field            | Required | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `model_name`     | no       | Free-text label for the cost model.                                |
| `default_region` | no       | Azure region applied when a service omits `region` (e.g. `eastus`).|
| `currency`       | no       | Reporting currency (v1 prices in USD).                             |
| `services`       | **yes**  | List of service entries (see below).                               |

### Per-service entry fields

| Field             | Required | Description                                                                          |
| ----------------- | -------- | ------------------------------------------------------------------------------------ |
| `name`            | **yes**  | Azure service, validated against the catalog (aliases accepted, e.g. `vm`).          |
| `display_name`    | no       | Free-text label (e.g. "Prod API plan") used in the breakdown.                         |
| `region`          | no       | Per-service override of `default_region`.                                            |
| `sku` / `tier`    | no       | SKU/tier string (e.g. `Standard_D4s_v5`, `P1v3`, `GP_Gen5_4`).                        |
| `quantity`        | no       | Instance/unit count (default `1`). Scales `instance_scaled` meters.                  |
| `hours_per_month` | no       | Runtime for hourly meters (default `730`).                                           |
| `dimensions`      | no       | Map of the service's billing meters → quantity (keys below).                         |
| `tags`            | no       | Cost-center/app labels for grouping.                                                 |
| `commitment`      | no       | `none` \| `1yr_ri` \| `3yr_ri` \| `savings_plan` to model committed-use pricing.      |

> **Backward compatibility:** a bare `{ name, sku, quantity, hours_per_month }`
> entry still works — omitted dimensions fall back to catalog defaults, and any
> service not in the catalog is priced with the legacy single-meter estimator.

### Validation

`POST /api/cost/template/parse` never returns 500 on bad input. Unknown
services or dimension keys come back as per-entry **warnings** (surfaced as a
toast in the UI) while the rest of the model is still parsed and runnable.

---

## 2. How each service is priced

The catalog (`backend/knowledge/pricing/service_catalog.yaml`) declares the
billing dimensions per service. Each dimension is priced against the **Azure
Retail Pricing API** using its own meter hints and native unit of measure;
graduated tiers (`tierMinimumUnits`) and `included_free` quantities are applied
per meter.

Notes on the dimension columns:

- `__hours__` meters are billed from `hours_per_month` (folded into the panel's
  Hours/mo field — they don't appear as a separate dimension input).
- `__instances__` / `instance_scaled` meters are multiplied by `quantity`.
- `included_free` quantities are subtracted before pricing.

| Service | Category | RI-eligible | Dimensions (`key` — unit, [free]) |
| ------- | -------- | ----------- | --------------------------------- |
| Virtual Machines | compute | yes | `__hours__` (hour); `os_disk_gb` (GB-month) |
| App Service | compute | yes | `__hours__` (hour) |
| Functions | compute | no | `executions_millions` (1M executions, free 1.0); `gb_seconds` (1M GB-s, free 0.4) |
| Azure Kubernetes Service | compute | yes | `__hours__` (hour) |
| Azure Cache for Redis | data | yes | `__hours__` (hour) |
| Azure SQL Database | data | yes | `__hours__` (vCore hour); `storage_gb` (GB-month); `backup_gb` (GB-month) |
| Azure Cosmos DB | data | no | `provisioned_ru_100s` (100 RU/s-month); `storage_gb` (GB-month) |
| Storage Account | storage | no | `capacity_gb` (GB-month); `write_ops_10k` (10K ops); `read_ops_10k` (10K ops) |
| Egress Bandwidth | network | no | `egress_gb` (GB-month, free 100.0) |
| Azure Front Door | network | no | `__hours__` (base-fee hour) |
| Application Gateway | network | no | `__hours__` (hour) |
| Service Bus | integration | no | `__hours__` (messaging-unit hour) |
| Event Hubs | integration | no | `__hours__` (throughput-unit hour) |
| API Management | integration | no | `__hours__` (unit hour) |
| Key Vault | integration | no | `operations_10k` (10K ops) |
| Log Analytics | observability | no | `ingestion_gb` (GB-month, free 5.0); `retention_gb` (GB-month) |

> This table is generated from the catalog; if you add or change a service in
> `service_catalog.yaml`, regenerate it from `cost_catalog.public_catalog()`.

The live `GET /api/cost/catalog` endpoint returns the same data (including
`quantity_field`, `default_quantity`, and `included_free`) so the frontend can
render dimension fields dynamically and validate input.

---

## 3. Recommendations engine

`backend/services/cost_recommendations_service.py` runs deterministically on
the priced breakdown — no subscription needed — and emits structured
recommendations, each with estimated **monthly savings**, rationale,
confidence, and effort:

| Type                | What it flags                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `reserved_instance` | RI/Savings-Plan discount on RI-eligible compute meters; uses catalog discount bands and computes break-even. |
| `storage_tier`      | Redundancy/tier downgrades (e.g. GRS → LRS) when capacity dominates.           |
| `idle_resource`     | Always-allocated SKUs running part-time, or over-provisioned dev/test counts.  |
| `region_shift`      | Greenest equivalent region (kgCO₂e delta via the carbon service).             |

Recommendations are aggregated by the pipeline's `recommendations` phase and
fed into the narration prompt so the LLM **grounds its report on real numbers**
rather than inventing them. They are also surfaced as a sortable table in the
panel alongside the per-meter cost breakdown.

---

## Pipeline phases

`estimate → live_price → carbon → reservations → rightsizing → break_even →
recommendations → narration`

Engagement-dependent phases (`reservations`, `rightsizing`) emit
`phase_skipped` when no subscription is connected; the catalog-based
recommendations engine fills that gap for manual-only input. Pricing stays
grounded in the live Retail API with the existing cache and MCP fallback.
