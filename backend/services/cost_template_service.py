"""Cost-model template parsing & validation.

Accepts a hand-authored cost model in YAML, JSON, or CSV and normalises it into
the ``CostOptimizeRequest`` shape the pipeline consumes. Validation is
**non-fatal**: unknown services or dimensions are returned as structured
warnings (per service entry) so the user can fix the file, rather than a 500.

Used by ``routes/cost.py`` (template download + upload endpoints).
"""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

import yaml

from middleware.logging import get_logger
from services import cost_catalog

log = get_logger("cost_template_service")

_PRICING_DIR = Path(__file__).resolve().parent.parent / "knowledge" / "pricing"
_SAMPLES = {
    "yaml": _PRICING_DIR / "sample_cost_model.yaml",
    "json": _PRICING_DIR / "sample_cost_model.json",
    "csv": _PRICING_DIR / "sample_cost_model.csv",
}

# Top-level CSV columns that are line-item attributes (everything else is a
# billing dimension column).
_CSV_ATTRS = {"name", "display_name", "sku", "region", "quantity", "hours_per_month", "commitment", "tags"}
_VALID_COMMITMENTS = {"none", "1yr_ri", "3yr_ri", "savings_plan"}


def sample_template(fmt: str = "yaml") -> tuple[str, str, str]:
    """Return (content, media_type, filename) for the requested sample format."""
    fmt = (fmt or "yaml").lower()
    path = _SAMPLES.get(fmt)
    if path is None:
        raise ValueError(f"unsupported format '{fmt}' (use yaml, json, or csv)")
    content = path.read_text(encoding="utf-8")
    media = {
        "yaml": "application/x-yaml",
        "json": "application/json",
        "csv": "text/csv",
    }[fmt]
    return content, media, path.name


def _coerce_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalise_dimensions(raw: Any) -> tuple[dict[str, float], list[str]]:
    """Coerce a dimensions mapping to {key: float}; return (dims, bad_keys)."""
    dims: dict[str, float] = {}
    bad: list[str] = []
    if not isinstance(raw, dict):
        return dims, bad
    for key, val in raw.items():
        num = _coerce_number(val)
        if num is None:
            bad.append(str(key))
            continue
        dims[str(key)] = num
    return dims, bad


def _validate_entry(entry: dict[str, Any], idx: int) -> tuple[dict[str, Any], list[str]]:
    """Normalise one service entry; return (line_item, warnings)."""
    warnings: list[str] = []
    name = str(entry.get("name") or entry.get("service") or "").strip()
    label = entry.get("display_name") or name or f"line {idx + 1}"

    svc = cost_catalog.resolve_service(name)
    if name and svc is None:
        warnings.append(
            f"'{label}': service '{name}' is not in the catalog — it will be priced "
            f"with the legacy single-meter estimator."
        )

    dims, bad = _normalise_dimensions(entry.get("dimensions"))
    for b in bad:
        warnings.append(f"'{label}': dimension '{b}' has a non-numeric value and was ignored.")

    # When the catalog knows the service, warn about dimension keys it doesn't define.
    # Template dimension keys are the catalog dimensions' `quantity_field` names
    # (e.g. Storage exposes `capacity_gb`, not its internal dimension key `capacity`).
    if svc is not None and dims:
        known = {
            d.get("quantity_field")
            for d in svc.get("dimensions", [])
            if d.get("quantity_field") and not str(d.get("quantity_field")).startswith("__")
        }
        for key in list(dims):
            if key not in known:
                warnings.append(
                    f"'{label}': '{name}' has no billing dimension '{key}' — ignored. "
                    f"Known: {', '.join(sorted(k for k in known if k))}."
                )
                dims.pop(key, None)

    commitment = str(entry.get("commitment") or "none").strip().lower()
    if commitment not in _VALID_COMMITMENTS:
        warnings.append(
            f"'{label}': commitment '{commitment}' is invalid (use one of "
            f"{', '.join(sorted(_VALID_COMMITMENTS))}); defaulting to 'none'."
        )
        commitment = "none"

    tags = entry.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(";") if t.strip()] or [t.strip() for t in tags.split(",") if t.strip()]

    line_item = {
        "service": name,
        "display_name": str(entry.get("display_name") or "").strip(),
        "sku": str(entry.get("sku") or "").strip(),
        "region": str(entry.get("region") or "").strip(),
        "quantity": _coerce_number(entry.get("quantity")) or 1.0,
        "hours_per_month": _coerce_number(entry.get("hours_per_month")) or 730.0,
        "dimensions": dims,
        "tags": list(tags),
        "commitment": commitment,
    }
    return line_item, warnings


def _parse_csv(text: str) -> list[dict[str, Any]]:
    """Turn a flat CSV into service entries, folding dimension columns into a
    nested ``dimensions`` map (blank cells are skipped)."""
    reader = csv.DictReader(io.StringIO(text))
    entries: list[dict[str, Any]] = []
    for row in reader:
        entry: dict[str, Any] = {}
        dims: dict[str, Any] = {}
        for col, val in row.items():
            if col is None:
                continue
            key = col.strip()
            if val is None or str(val).strip() == "":
                continue
            if key in _CSV_ATTRS:
                entry[key] = val
            else:
                dims[key] = val
        if dims:
            entry["dimensions"] = dims
        if entry.get("name") or entry.get("service"):
            entries.append(entry)
    return entries


def parse_template(content: str, fmt: str = "") -> dict[str, Any]:
    """Parse + validate a cost-model template.

    ``fmt`` is one of yaml/json/csv; when blank it is inferred from the content.
    Returns a dict ready to feed a ``CostOptimizeRequest``:

        {
          "model_name", "region", "currency",
          "items": [ <line_item>, ... ],
          "warnings": [ ... ],
          "error": <str|None>
        }
    """
    fmt = (fmt or "").lower().lstrip(".")
    text = content or ""
    stripped = text.lstrip()

    if not fmt:
        first_line = stripped.splitlines()[0] if stripped else ""
        if stripped.startswith("{"):
            fmt = "json"
        elif "," in first_line and ":" not in first_line:
            fmt = "csv"
        else:
            fmt = "yaml"

    try:
        if fmt == "csv":
            raw: Any = {"services": _parse_csv(text)}
        elif fmt == "json":
            raw = json.loads(text)
        else:
            raw = yaml.safe_load(text)
    except (yaml.YAMLError, json.JSONDecodeError, csv.Error):
        return {
            "items": [],
            "warnings": [],
            "error": f"could not parse template as {fmt}; check the file is well-formed {fmt.upper()}.",
        }

    if not isinstance(raw, dict):
        return {"items": [], "warnings": [], "error": "template root must be a mapping with a 'services' list."}

    services = raw.get("services")
    if not isinstance(services, list) or not services:
        return {"items": [], "warnings": [], "error": "template has no 'services' entries."}

    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    for idx, entry in enumerate(services):
        if not isinstance(entry, dict):
            warnings.append(f"service entry {idx + 1} is not a mapping — skipped.")
            continue
        line_item, entry_warnings = _validate_entry(entry, idx)
        if not line_item["service"]:
            warnings.append(f"service entry {idx + 1} has no 'name' — skipped.")
            continue
        items.append(line_item)
        warnings.extend(entry_warnings)

    return {
        "model_name": str(raw.get("model_name") or "Cost model"),
        "region": str(raw.get("default_region") or raw.get("region") or cost_catalog.region_default()),
        "currency": str(raw.get("currency") or cost_catalog.currency_default()),
        "items": items,
        "warnings": warnings,
        "error": None,
    }


def worksheet_to_csv(worksheet: dict[str, Any]) -> str:
    """Flatten a priced worksheet to CSV — one row per meter — for sharing.

    Columns cover the service, SKU, region, meter, billable quantity, unit
    price, monthly + annual cost, confidence, assumptions, and the retail meter
    citation so the figures are independently verifiable.
    """
    currency = str(worksheet.get("currency") or "USD")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Service",
            "Display name",
            "SKU",
            "Region",
            "Meter",
            "Unit",
            "Billable quantity",
            "Unit price",
            "Monthly cost",
            "Annual cost",
            "Currency",
            "Confidence",
            "Priced",
            "Assumptions",
            "Meter ID",
        ]
    )
    for line in worksheet.get("line_items", []) or []:
        assumptions = "; ".join(line.get("assumptions", []) or [])
        line_currency = str(line.get("currency") or currency)
        meters = line.get("meters", []) or []
        if not meters:
            meters = [{}]
        for meter in meters:
            citation = meter.get("citation") or {}
            monthly = meter.get("monthly_cost")
            annual = round(monthly * 12, 2) if isinstance(monthly, (int, float)) else ""
            writer.writerow(
                [
                    line.get("service", ""),
                    line.get("display_name", ""),
                    line.get("sku", ""),
                    line.get("region", ""),
                    meter.get("label") or meter.get("meter_name") or meter.get("dimension") or "",
                    meter.get("unit_of_measure") or meter.get("unit") or "",
                    meter.get("billable_quantity", meter.get("quantity", "")),
                    meter.get("unit_price", ""),
                    "" if monthly is None else monthly,
                    annual,
                    meter.get("currency") or line_currency,
                    meter.get("confidence_label") or line.get("confidence_label") or "",
                    "yes" if meter.get("priced") else "no",
                    assumptions,
                    citation.get("meter_id") or meter.get("meter_id") or "",
                ]
            )
    total = worksheet.get("total_monthly_estimate")
    if isinstance(total, (int, float)):
        writer.writerow([])
        writer.writerow(
            ["TOTAL", "", "", "", "", "", "", "", total, round(total * 12, 2), currency, "", "", "", ""]
        )
    return buf.getvalue()


__all__ = ["parse_template", "sample_template", "worksheet_to_csv"]
