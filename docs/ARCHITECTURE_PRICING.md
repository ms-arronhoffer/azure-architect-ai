# Architecture Pricing — Drawing / Description → Full Reliable Price List

The **Pricing Desk** can turn an **architecture drawing** (a diagram image or a
draw.io file) **or** a **free-text description** into a complete, line-by-line
Azure price list. Every priceable node is enumerated, defaulted, costed across
all of its billing meters, and accounted for — with explicit **assumptions**,
per-line **confidence**, **citations** to the matched Azure Retail meter, and a
**completeness report** that flags anything it could not price.

This complements the manual, meter-aware **Cost Optimize** flow
(see [`COST_OPTIMIZE.md`](./COST_OPTIMIZE.md)); the two share the same pricing
core (`meter_pricing_service.py`) and the same `priced_worksheet` UI.

---

## 1. What you can submit

The unified endpoint `POST /api/cost/price-architecture` accepts any one of:

| Input | Field | How it is extracted |
| --- | --- | --- |
| Diagram image (PNG/JPG/WebP) | `image_data_url` (a `data:image/...;base64,` URL) | GPT‑4o vision pass with a strict JSON schema → one row per inferred component |
| draw.io / `mxGraphModel` XML | `drawio_xml` | Deterministic parse of nodes + edges; shape/style → Azure service via the same map `diagram_service.py` uses to *draw* diagrams, in reverse |
| Our own diagram JSON | `diagram` | Deterministic node/edge walk |
| Free-text description | `text` | LLM pass into the same strict component schema |
| Pre-structured line items | `line_items` | Bypasses extraction; priced directly |
| Chat attachments | `attachments` | `data:image/...` attachments are treated as images |

All paths converge on the **same normalized component list**, so downstream
pricing is identical regardless of how the architecture arrived.

The **Price a drawing** button on the Pricing Desk panel uploads a file
(image / `.drawio` / `.xml` / `.txt`) and streams the worksheet straight in.

---

## 2. How the pipeline works

```
extraction → component normalization → assumptions/defaults →
meter pricing (catalog + dynamic discovery) → reservation/hybrid discounts →
completeness report → priced_worksheet (SSE)
```

1. **Extraction** (`diagram_extraction_service.py`) produces an
   `Extraction(components, edges)`. Edges that target the internet/users imply
   **egress / data-transfer** line items that the drawing doesn't draw; these
   are added by `normalize_all` from `knowledge/pricing/default_profiles.yaml`.
2. **Normalization & classification** (`component_model.py`) resolves each shape
   to an Azure service and classifies it as `priceable`, `not_billable`
   (free / license-only / EA-negotiated), or `unknown`. Resolution order is
   **direct** (catalog / shape-map / name-map) → `not_billable` → **fuzzy** →
   `unknown`, so a known free service is never fuzzy-matched into a paid one.
3. **Assumptions** — every quantity that drives cost (hours, instance count,
   storage GB, RU/s, egress GB, requests) that is missing from the drawing is
   filled from a per-service **default-quantity profile** and recorded as an
   explicit, human-readable assumption on the line
   (e.g. *"assumption: 730 hrs/mo, 2× D4s_v5"*).
4. **Meter pricing** (`meter_pricing_service.py`) prices **all billing
   dimensions** of catalog services. For services *not* in
   `service_catalog.yaml`, **dynamic meter discovery** groups the live Azure
   Retail records by `meterName`/`unitOfMeasure` instead of collapsing to a
   single SKU — so "any priceable service" is metered, not under-counted.
5. **Discounts** — engagement-aware reservation and hybrid-benefit discounts are
   applied (the same `reservations_service` bridge used by the chat
   `price_services` tool).
6. **Completeness report** accounts for every extracted node: priced vs.
   not-billable vs. unpriced-with-reason.

---

## 3. Confidence & citations (per line)

Each priced meter carries:

- a **citation** — the exact matched Retail record: `meterId`, `skuName`,
  `productName`, `region`, unit price, `currency`, and `retrieved_at`.
- a **confidence** score and label (`high` / `medium` / `low` / `none`) based on
  how cleanly the requested SKU and region matched the returned record.

Line confidence is the weakest of its priced meters. The worksheet surfaces a
confidence badge per line; **low-confidence** lines are good candidates for the
existing clarify-before-pricing and cheaper-SKU **alternatives** loops.

---

## 4. Completeness report

The `completeness` block on the worksheet reports:

- `components_found`, `priceable`, `priced`
- `not_billable[]` — `{name, reason}` for free / license-only / EA items
- `unknown[]` — shapes that could not be resolved to a service
- `unpriced[]` — `{name, reason}` for priceable items that returned no meter
- `fully_accounted` — `true` only when nothing is unknown or unpriced

This is what lets a user **trust the grand total is whole**: every node is in
exactly one bucket, and anything that couldn't be priced is reported rather than
silently zeroed.

---

## 5. Output & export

The endpoint streams the existing `priced_worksheet` SSE shape, so the frontend
change is minimal. The worksheet shows, per line: service / SKU / region /
quantity / assumptions / unit price / monthly + annual / confidence / citation,
plus the grand total, the completeness report, and the existing
reservation/hybrid-benefit and cheaper-SKU suggestions.

- **Excel export** is available from the panel (`Export to Excel`).
- **CSV export** is available via `POST /api/cost/worksheet/export`
  (`cost_template_service.worksheet_to_csv`) — one row per meter with citation,
  confidence, and assumptions, plus a TOTAL row.

---

## 6. Accuracy guarantees & known limits

**Guarantees**

- Every extracted node is **classified** into exactly one of priced /
  not-billable / unknown, and the completeness report makes that explicit.
- Prices come from the **live Azure Retail Prices API** (no auth, 6 h cache,
  MCP fallback); each priced line cites the exact meter and retrieval time.
- Catalog services are priced across **all** their billing meters; uncatalogued
  services are metered via **dynamic discovery**, not a single SKU.
- Defaulted quantities are surfaced as editable **assumptions**, never hidden.

**Limits**

- **Retail list price only.** Results do **not** reflect EA / CSP / MCA
  negotiated discounts, Azure consumption commitments, or private offers.
- Quantities not present in a drawing are **assumptions**; the total is only as
  accurate as those assumptions. Refine the high-impact ones via the clarify
  loop and re-price.
- Vision extraction from a raster image is best-effort; a draw.io/diagram-JSON
  input is deterministic and therefore more reliable.
- `not_billable` items (free tiers, license-only, EA-negotiated) contribute
  **$0** to the total by design and are listed in the completeness report.
- Dynamic discovery prices the **primary** meter of an uncatalogued service;
  graduated-tier or free-grant services should be added to
  `service_catalog.yaml` for exact pricing.
