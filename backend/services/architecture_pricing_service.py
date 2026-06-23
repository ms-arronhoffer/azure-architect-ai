"""Architecture → reliable price list orchestrator.

Ties the pipeline together: extraction (image / draw.io XML / diagram JSON /
text) → component normalization (classify + default quantities + assumptions) →
meter-aware pricing with dynamic discovery → engagement reservation discounts →
a completeness report that accounts for every node found.

Output is a superset of the ``priced_worksheet`` shape the Pricing Desk panel
already renders, with three additions: per-line ``assumptions`` and
``confidence``, a top-level ``completeness`` report, and an ``extraction``
summary. Streaming wrapper emits progress events then the final worksheet.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from middleware.logging import get_logger
from services import diagram_extraction_service as extract_svc
from services import meter_pricing_service
from services.component_model import Component
from services.diagram_extraction_service import Extraction

log = get_logger("architecture_pricing")

DISCLAIMER = (
    "Estimates use Azure Retail (pay-as-you-go) list prices via the public "
    "Retail Prices API. They exclude EA/CSP/MCA negotiated discounts, free-tier "
    "grants beyond those modelled, support plans, and taxes. Quantities marked "
    "as assumptions are defaults — refine them for a precise quote."
)


async def _run_extraction(
    *,
    drawio_xml: str | None,
    diagram: dict[str, Any] | None,
    image_data_url: str | None,
    text: str | None,
    line_items: list[dict[str, Any]] | None,
    llm_caller: extract_svc.LLMCaller | None,
) -> Extraction:
    """Produce a normalized Extraction from whichever input is supplied.

    Pre-structured ``line_items`` bypass extraction and are wrapped directly as
    components so callers that already know their inventory still flow through
    the same assumptions + completeness machinery.
    """
    if line_items:
        ex = Extraction(source="line_items")
        for it in line_items:
            comp = Component(
                label=str(it.get("display_name") or it.get("service") or ""),
                shape=str(it.get("service") or ""),
                sku=str(it.get("sku", "")),
                region=str(it.get("region", "")),
                quantity=float(it.get("quantity", 1) or 1),
                hours_per_month=(
                    float(it["hours_per_month"]) if it.get("hours_per_month") else None
                ),
                source="line_items",
            )
            if isinstance(it.get("dimensions"), dict):
                comp.dimensions.update(it["dimensions"])
            ex.components.append(comp)
        return extract_svc.normalize_all(ex)

    ex = await extract_svc.extract(
        drawio_xml=drawio_xml,
        diagram=diagram,
        image_data_url=image_data_url,
        text=text,
        llm_caller=llm_caller,
    )
    return extract_svc.normalize_all(ex)


def _completeness(
    components: list[Component], priced_lines: list[dict[str, Any]]
) -> dict[str, Any]:
    """Account for every extracted node: priced, not-billable, or unpriced."""
    not_billable = [
        {"name": c.label or c.shape, "reason": c.reason}
        for c in components
        if c.classification == "not_billable"
    ]
    unknown = [
        {"name": c.label or c.shape, "reason": c.reason}
        for c in components
        if c.classification == "unknown"
    ]
    unpriced_lines = [
        {
            "name": ln.get("display_name") or ln.get("service"),
            "reason": ln.get("note")
            or "No retail meter matched — verify in the Azure Pricing Calculator.",
        }
        for ln in priced_lines
        if (ln.get("monthly_subtotal") or 0) == 0
        and not any(m.get("priced") for m in ln.get("meters", []))
    ]
    priceable = sum(1 for c in components if c.classification == "priceable")
    return {
        "components_found": len(components),
        "priceable": priceable,
        "priced": priceable - len(unpriced_lines),
        "not_billable": not_billable,
        "unknown": unknown,
        "unpriced": unpriced_lines,
        "fully_accounted": len(unknown) == 0 and len(unpriced_lines) == 0,
    }


def _apply_reservations(worksheet: dict[str, Any], commitments: dict[str, Any]) -> dict[str, Any]:
    """Bridge the meter-aware worksheet to the reservation engine, which keys on
    per-line ``monthly_estimate``/``quantity``, then reconcile subtotals back."""
    from services.reservations_service import apply_reservation_discounts

    for line in worksheet.get("line_items", []):
        line["monthly_estimate"] = line.get("monthly_subtotal")
        line.setdefault("quantity", 1)
    worksheet = apply_reservation_discounts(worksheet, commitments)
    for line in worksheet.get("line_items", []):
        if "monthly_estimate" in line:
            line["monthly_subtotal"] = line["monthly_estimate"]
    return worksheet


async def price_architecture(
    *,
    drawio_xml: str | None = None,
    diagram: dict[str, Any] | None = None,
    image_data_url: str | None = None,
    text: str | None = None,
    line_items: list[dict[str, Any]] | None = None,
    region: str = "eastus",
    currency: str = "USD",
    optimization_tips: list[str] | None = None,
    llm_caller: extract_svc.LLMCaller | None = None,
    commitments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Full non-streaming run. Returns the enriched worksheet dict."""
    extraction = await _run_extraction(
        drawio_xml=drawio_xml,
        diagram=diagram,
        image_data_url=image_data_url,
        text=text,
        line_items=line_items,
        llm_caller=llm_caller,
    )
    priceable = [c for c in extraction.components if c.classification == "priceable"]
    items = [c.to_line_item() for c in priceable]

    worksheet = await meter_pricing_service.price_model(
        items, region_default=region, currency=currency, dynamic_discovery=True
    )

    # Attach per-component assumptions onto the matching priced line (same order).
    for comp, line in zip(priceable, worksheet.get("line_items", []), strict=False):
        if comp.assumptions:
            line["assumptions"] = list(comp.assumptions)
        line.setdefault("source", comp.source)

    if commitments:
        worksheet = _apply_reservations(worksheet, commitments)

    worksheet["completeness"] = _completeness(extraction.components, worksheet.get("line_items", []))
    worksheet["extraction"] = {
        "source": extraction.source,
        "component_count": len(extraction.components),
        "notes": extraction.notes,
    }
    if optimization_tips:
        worksheet["optimization_tips"] = list(optimization_tips)
    worksheet["disclaimer"] = DISCLAIMER
    return worksheet


async def stream_price_architecture(
    *,
    drawio_xml: str | None = None,
    diagram: dict[str, Any] | None = None,
    image_data_url: str | None = None,
    text: str | None = None,
    line_items: list[dict[str, Any]] | None = None,
    region: str = "eastus",
    currency: str = "USD",
    optimization_tips: list[str] | None = None,
    llm_caller: extract_svc.LLMCaller | None = None,
    commitments: dict[str, Any] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Streaming wrapper: progress events then the final ``priced_worksheet``."""
    yield {"type": "status", "phase": "extract", "message": "Reading the architecture…"}
    try:
        worksheet = await price_architecture(
            drawio_xml=drawio_xml,
            diagram=diagram,
            image_data_url=image_data_url,
            text=text,
            line_items=line_items,
            region=region,
            currency=currency,
            optimization_tips=optimization_tips,
            llm_caller=llm_caller,
            commitments=commitments,
        )
    except Exception as exc:  # surface, never crash the stream
        log.error("architecture_pricing.failed", error=str(exc))
        yield {"type": "error", "message": f"Pricing failed: {exc}"}
        return

    comp_count = worksheet.get("extraction", {}).get("component_count", 0)
    yield {
        "type": "status",
        "phase": "priced",
        "message": (
            f"Priced {worksheet.get('summary', {}).get('total_lines', 0)} of "
            f"{comp_count} components."
        ),
    }
    yield {"type": "priced_worksheet", "worksheet": worksheet}


__all__ = ["DISCLAIMER", "price_architecture", "stream_price_architecture"]
