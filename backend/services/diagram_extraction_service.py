"""Extract a normalized component list from any architecture input.

Four entry paths, one output shape (``list[Component]`` + edges):

  * ``extract_from_drawio_xml`` — deterministic parse of draw.io / mxGraph XML.
    Each vertex's label + style token is mapped to an Azure service; container /
    cluster rectangles are skipped.
  * ``extract_from_diagram`` — our own ``{components, connections}`` diagram
    dicts (as produced by ``diagram_service``).
  * ``extract_from_image`` — a GPT-4o vision pass constrained to a strict JSON
    schema (one row per inferred component). Network-dependent; injectable for
    tests.
  * ``extract_from_text`` — an LLM pass over a free-text description, same JSON
    schema. Injectable for tests.

Edges are returned alongside nodes so the pricing pipeline can infer implied
egress / data-transfer line items the drawing implies but does not draw.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from html import unescape
from typing import Any

from middleware.logging import get_logger
from services import component_model
from services.component_model import Component

log = get_logger("diagram_extraction")


@dataclass
class Extraction:
    components: list[Component] = field(default_factory=list)
    edges: list[tuple[str, str]] = field(default_factory=list)  # (from_label, to_label)
    source: str = ""
    notes: list[str] = field(default_factory=list)


_TAG_RE = re.compile(r"<[^>]+>")
# draw.io shape tokens we can lift a service hint from, e.g.
# "shape=mxgraph.azure.sql_database" or "mscae/Azure SQL".
_SHAPE_TOKEN_RE = re.compile(r"(?:shape=)?(?:mxgraph\.azure\.|mxgraph\.mscae\.|mscae/)([a-z0-9_ ]+)", re.I)


def _clean_label(value: str) -> str:
    """Strip HTML markup draw.io stores in node labels."""
    if not value:
        return ""
    text = unescape(value)
    text = _TAG_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _shape_hint_from_style(style: str) -> str:
    if not style:
        return ""
    m = _SHAPE_TOKEN_RE.search(style)
    if m:
        return m.group(1).strip().replace(" ", "_")
    return ""


def _is_container(style: str) -> bool:
    """Cluster rectangles / swimlanes are layout, not billable nodes."""
    s = (style or "").lower()
    return "dashpattern" in s or "swimlane" in s or "container=1" in s or "grticon" in s


def extract_from_drawio_xml(xml: str) -> Extraction:
    """Parse draw.io / mxGraph XML into components + edges."""
    out = Extraction(source="drawio_xml")
    if not xml or not xml.strip():
        return out
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        log.warning("diagram_extraction.xml_parse_failed", error=str(exc))
        out.notes.append("Could not parse the draw.io XML.")
        return out

    cells = root.iter("mxCell")
    nodes_by_id: dict[str, Component] = {}
    edges_raw: list[tuple[str, str]] = []

    for cell in cells:
        cid = cell.get("id", "")
        style = cell.get("style", "") or ""
        if cell.get("edge") == "1":
            src, tgt = cell.get("source", ""), cell.get("target", "")
            if src and tgt:
                edges_raw.append((src, tgt))
            continue
        if cell.get("vertex") != "1":
            continue
        if _is_container(style):
            continue
        label = _clean_label(cell.get("value", ""))
        shape_hint = _shape_hint_from_style(style)
        if not label and not shape_hint:
            continue
        comp = Component(
            label=label or shape_hint.replace("_", " "),
            shape=shape_hint,
            source="xml",
            node_id=cid,
        )
        nodes_by_id[cid] = comp
        out.components.append(comp)

    for src, tgt in edges_raw:
        s = nodes_by_id.get(src)
        t = nodes_by_id.get(tgt)
        if s and t:
            out.edges.append((s.label, t.label))
        elif t:
            # Edge from a non-node (e.g. a free-floating "Internet" label cell)
            out.edges.append((src, t.label))
    return out


def extract_from_diagram(diagram: dict[str, Any]) -> Extraction:
    """Build components from our own ``{components, connections}`` diagram dict."""
    out = Extraction(source="diagram_json")
    comps = diagram.get("components", []) or []
    by_id: dict[str, Component] = {}
    for c in comps:
        comp = Component(
            label=str(c.get("label") or c.get("id") or ""),
            shape=str(c.get("shape") or c.get("id") or ""),
            sku=str(c.get("sku", "")),
            region=str(c.get("region", "")),
            group=str(c.get("group", "")),
            tier=c.get("tier"),
            source="json",
            node_id=str(c.get("id", "")),
        )
        if isinstance(c.get("dimensions"), dict):
            comp.dimensions.update(c["dimensions"])
        if c.get("quantity"):
            comp.quantity = float(c["quantity"])
        by_id[comp.node_id] = comp
        out.components.append(comp)
    for conn in diagram.get("connections", []) or []:
        s = by_id.get(str(conn.get("from", "")))
        t = by_id.get(str(conn.get("to", "")))
        if s and t:
            out.edges.append((s.label, t.label))
    return out


# Strict JSON schema the vision / text LLM passes must emit. Kept here so both
# image and text extraction share one contract.
_EXTRACTION_INSTRUCTIONS = (
    "You are an Azure pricing analyst. Identify every Azure resource implied by "
    "the input and return STRICT JSON only (no prose) of the form:\n"
    '{ "components": [ { "label": str, "service": str, "sku": str, '
    '"region": str, "quantity": number, "dimensions": { } } ], '
    '"edges": [ [ "from label", "to label" ] ] }\n'
    "Rules: one row per distinct resource; `service` should be the Azure product "
    "name (e.g. 'Virtual Machines', 'SQL Database', 'Storage'); use '' when a SKU "
    "or region is not stated; quantity defaults to 1; include logical-only nodes "
    "(VNet, subnet, users, internet) so edges are complete — they will be "
    "classified as non-billable downstream. Return ONLY the JSON object."
)


def _components_from_payload(payload: dict[str, Any], source: str) -> Extraction:
    out = Extraction(source=source)
    for row in payload.get("components", []) or []:
        if not isinstance(row, dict):
            continue
        comp = Component(
            label=str(row.get("label", "")),
            service=None,
            shape=str(row.get("service") or row.get("label") or ""),
            sku=str(row.get("sku", "")),
            region=str(row.get("region", "")),
            source=source.replace("_llm", "").replace("vision", "vision") or source,
            node_id=str(row.get("label", "")),
        )
        # Honour an explicit service hint from the model as a shape candidate.
        if row.get("service"):
            comp.shape = str(row["service"])
        if isinstance(row.get("dimensions"), dict):
            comp.dimensions.update(row["dimensions"])
        try:
            if row.get("quantity"):
                comp.quantity = float(row["quantity"])
        except (TypeError, ValueError):
            pass
        if comp.label or comp.shape:
            out.components.append(comp)
    for edge in payload.get("edges", []) or []:
        if isinstance(edge, (list, tuple)) and len(edge) == 2:
            out.edges.append((str(edge[0]), str(edge[1])))
    return out


def _parse_llm_json(content: str) -> dict[str, Any]:
    """Best-effort extraction of the JSON object from an LLM reply."""
    content = (content or "").strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?|\n?```$", "", content).strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return data if isinstance(data, dict) else {}


# Type of the injectable LLM caller: (system, user_parts) -> assistant content.
LLMCaller = Callable[[str, list[dict[str, Any]]], Awaitable[str]]


async def _default_llm_caller(system: str, user_parts: list[dict[str, Any]]) -> str:
    from services import openai_service

    client, model = openai_service.resolve_async_client_and_model("chat")
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_parts},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content or "{}"


async def extract_from_image(
    image_data_url: str, *, llm_caller: LLMCaller | None = None
) -> Extraction:
    """Vision pass: a data-URL image → components. Never raises."""
    caller = llm_caller or _default_llm_caller
    if not image_data_url:
        return Extraction(source="vision")
    try:
        content = await caller(
            _EXTRACTION_INSTRUCTIONS,
            [
                {"type": "text", "text": "Extract the Azure components from this architecture diagram."},
                {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
            ],
        )
    except Exception as exc:  # never raise — degrade to empty
        log.warning("diagram_extraction.vision_failed", error=str(exc))
        ex = Extraction(source="vision")
        ex.notes.append(f"Vision extraction failed: {exc}")
        return ex
    return _components_from_payload(_parse_llm_json(content), "vision")


async def extract_from_text(
    text: str, *, llm_caller: LLMCaller | None = None
) -> Extraction:
    """LLM pass over a free-text description → components. Never raises."""
    caller = llm_caller or _default_llm_caller
    if not text or not text.strip():
        return Extraction(source="text")
    try:
        content = await caller(
            _EXTRACTION_INSTRUCTIONS,
            [{"type": "text", "text": text}],
        )
    except Exception as exc:
        log.warning("diagram_extraction.text_failed", error=str(exc))
        ex = Extraction(source="text")
        ex.notes.append(f"Text extraction failed: {exc}")
        return ex
    return _components_from_payload(_parse_llm_json(content), "text")


def looks_like_drawio(text: str) -> bool:
    head = (text or "").lstrip()[:512].lower()
    return "<mxfile" in head or "<mxgraphmodel" in head or "<mxcell" in head


async def extract(
    *,
    drawio_xml: str | None = None,
    diagram: dict[str, Any] | None = None,
    image_data_url: str | None = None,
    text: str | None = None,
    llm_caller: LLMCaller | None = None,
) -> Extraction:
    """Dispatch to the right extractor based on which input is provided.

    Precedence: explicit diagram dict → draw.io XML → image → text. A ``text``
    value that is actually draw.io XML is routed to the XML parser.
    """
    if diagram is not None:
        return extract_from_diagram(diagram)
    if drawio_xml:
        return extract_from_drawio_xml(drawio_xml)
    if text and looks_like_drawio(text):
        return extract_from_drawio_xml(text)
    if image_data_url:
        return await extract_from_image(image_data_url, llm_caller=llm_caller)
    if text:
        return await extract_from_text(text, llm_caller=llm_caller)
    return Extraction()


def normalize_all(extraction: Extraction) -> Extraction:
    """Classify + default every component, then add implied edge-driven lines."""
    for comp in extraction.components:
        component_model.normalize(comp)
    _add_implied(extraction)
    return extraction


def _add_implied(extraction: Extraction) -> None:
    """Append implied egress / data-transfer lines from edges when triggered."""
    existing_services = {
        c.service for c in extraction.components if c.service
    }
    for rule in component_model.implied_rules():
        triggers = {str(t).strip().lower() for t in rule.get("when_edge_to", [])}
        add = rule.get("add", {}) or {}
        add_service = component_model.resolve_service(str(add.get("service", "")))
        if not add_service or add_service in existing_services:
            continue
        fired = any(
            (str(a).strip().lower() in triggers or str(b).strip().lower() in triggers)
            for a, b in extraction.edges
        )
        if not fired:
            continue
        comp = Component(
            label=str(add.get("label", add_service)),
            shape=str(add.get("service", "")),
            source="implied",
        )
        if isinstance(add.get("dimensions"), dict):
            comp.dimensions.update(add["dimensions"])
        component_model.normalize(comp)
        if rule.get("reason"):
            comp.assumptions.append(str(rule["reason"]))
        extraction.components.append(comp)
        existing_services.add(add_service)


__all__ = [
    "Extraction",
    "extract",
    "extract_from_diagram",
    "extract_from_drawio_xml",
    "extract_from_image",
    "extract_from_text",
    "looks_like_drawio",
    "normalize_all",
]
