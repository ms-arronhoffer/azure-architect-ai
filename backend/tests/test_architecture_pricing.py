"""Tests for the architecture-pricing pipeline: component model, diagram
extraction, dynamic meter discovery, the orchestrator, and CSV export.

All network is monkeypatched; the LLM caller is injected so vision/text paths
run hermetically.
"""
from __future__ import annotations

import pytest

# ── component_model ──────────────────────────────────────────────────────────


def test_resolve_service_direct_and_alias():
    from services import component_model as cm

    assert cm.resolve_service("virtual_machine") == "Virtual Machines"
    assert cm.resolve_service("Azure SQL") == "SQL Database"
    assert cm.resolve_service("container_registry") == "Container Registry"
    assert cm.resolve_service("totally bogus thing") is None


def test_classify_not_billable_takes_precedence_over_fuzzy():
    from services import component_model as cm

    # "Virtual Network" shares the token "virtual" with "Virtual Machines";
    # it must still be classified not_billable, never mis-priced as compute.
    for shape, label in [("virtual_network", "VNet"), ("subnet", "App Subnet")]:
        c = cm.Component(label=label, shape=shape)
        cm.classify(c)
        assert c.classification == "not_billable", (shape, c.service)
        assert c.service is None
        assert c.reason


def test_fuzzy_does_not_bind_unrelated_service_via_generic_token():
    from services import component_model as cm

    # These share only the generic word "azure" (or an incidental "vaults") with
    # priceable services; they must NOT collapse onto Azure App Service / Key
    # Vault and get mispriced — they resolve to unknown and are reported.
    for name in ["Azure Backup Vaults", "Azure Arc", "Azure Backup"]:
        c = cm.Component(label=name, shape=name)
        cm.classify(c)
        assert c.classification == "unknown", (name, c.service)
        assert c.service is None


def test_fuzzy_still_resolves_distinctive_overlap():
    from services import component_model as cm

    # A decisive token overlap (service or candidate fully covered) still binds.
    assert cm.resolve_service("Azure Monitor + Log Analytics") == "Log Analytics"
    assert cm.resolve_service("Storage Account") == "Storage"
    assert cm.resolve_service("Cosmos") == "Azure Cosmos DB"


def test_classify_public_ip_stays_priceable():
    from services import component_model as cm

    c = cm.Component(label="Public IP", shape="public_ip")
    cm.classify(c)
    assert c.classification == "priceable"
    assert c.service == "Virtual Network"


def test_apply_defaults_records_assumptions():
    from services import component_model as cm

    c = cm.Component(label="DB", shape="sql_database")
    cm.normalize(c)
    assert c.service == "SQL Database"
    assert c.sku == "GP_Gen5_2"
    assert c.dimensions.get("storage_gb") == 32
    assert c.hours_per_month == 730
    assert c.assumptions and "GP_Gen5_2" in c.assumptions[0]


def test_apply_defaults_does_not_override_explicit_values():
    from services import component_model as cm

    c = cm.Component(label="DB", shape="sql_database", sku="BC_Gen5_8")
    c.dimensions["storage_gb"] = 500
    cm.normalize(c)
    assert c.sku == "BC_Gen5_8"
    assert c.dimensions["storage_gb"] == 500  # not clobbered by default 32


# ── diagram extraction ───────────────────────────────────────────────────────

_DRAWIO = """<mxfile><diagram><mxGraphModel><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="n1" value="Web App" style="shape=mxgraph.azure.app_services" vertex="1" parent="1"/>
<mxCell id="n2" value="&lt;b&gt;SQL Database&lt;/b&gt;" style="image;html=1" vertex="1" parent="1"/>
<mxCell id="cl" value="Compute" style="rounded=1;dashed=1;dashPattern=4 4" vertex="1" parent="1"/>
<mxCell id="u1" value="Users" vertex="1" parent="1"/>
<mxCell id="e1" edge="1" source="n1" target="u1" parent="1"/>
</root></mxGraphModel></diagram></mxfile>"""


def test_extract_drawio_skips_containers_and_reads_edges():
    from services import diagram_extraction_service as dx

    ex = dx.extract_from_drawio_xml(_DRAWIO)
    labels = {c.label for c in ex.components}
    assert "Web App" in labels
    assert "SQL Database" in labels      # HTML markup stripped
    assert "Users" in labels
    assert "Compute" not in labels       # cluster rectangle skipped
    assert ("Web App", "Users") in ex.edges


def test_extract_drawio_invalid_xml_degrades():
    from services import diagram_extraction_service as dx

    ex = dx.extract_from_drawio_xml("<not valid")
    assert ex.components == []
    assert ex.notes


def test_normalize_all_adds_implied_egress():
    from services import diagram_extraction_service as dx

    ex = dx.extract_from_drawio_xml(_DRAWIO)
    dx.normalize_all(ex)
    services = {c.service for c in ex.components if c.service}
    assert "Bandwidth" in services       # edge to "Users" implied internet egress
    assert any(c.classification == "not_billable" for c in ex.components)


@pytest.mark.asyncio
async def test_default_llm_caller_routes_gpt5_via_responses_api(monkeypatch):
    """The Pricing Desk model (gpt-5.4-mini) must go through the Responses API,
    not Chat Completions, and image parts are converted to Responses input."""
    from services import diagram_extraction_service as dx
    from services import openai_service

    captured: dict[str, object] = {}

    class _Resp:
        output_text = '{"components": [], "edges": []}'

    class _Responses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _Resp()

    class _RClient:
        responses = _Responses()

    def fake_resolve(mode, *a, **k):
        captured["mode"] = mode
        return object(), "gpt-5.4-mini"

    monkeypatch.setattr(openai_service, "resolve_async_client_and_model", fake_resolve)
    monkeypatch.setattr(openai_service, "get_async_responses_client", lambda d: _RClient())

    out = await dx._default_llm_caller(
        "system",
        [
            {"type": "text", "text": "hi"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA", "detail": "high"}},
        ],
    )
    assert out == '{"components": [], "edges": []}'
    assert captured["mode"] == "pricing"
    assert captured["model"] == "gpt-5.4-mini"
    content = captured["input"][0]["content"]
    assert {"type": "input_text", "text": "hi"} in content
    assert any(p.get("type") == "input_image" for p in content)


@pytest.mark.asyncio
async def test_extract_from_text_uses_injected_llm():
    from services import diagram_extraction_service as dx

    async def fake_llm(system, parts):
        return (
            '{"components": [{"label": "API", "service": "Azure App Service", '
            '"sku": "P1v3", "region": "eastus", "quantity": 2}], "edges": []}'
        )

    ex = await dx.extract_from_text("two app service instances", llm_caller=fake_llm)
    assert len(ex.components) == 1
    assert ex.components[0].quantity == 2


@pytest.mark.asyncio
async def test_extract_from_image_handles_fenced_json():
    from services import diagram_extraction_service as dx

    async def fake_llm(system, parts):
        # model wrapped JSON in a code fence
        return '```json\n{"components": [{"label": "VM", "service": "Virtual Machines"}]}\n```'

    ex = await dx.extract_from_image("data:image/png;base64,AAAA", llm_caller=fake_llm)
    assert ex.components[0].label == "VM"


@pytest.mark.asyncio
async def test_extract_from_image_failure_degrades():
    from services import diagram_extraction_service as dx

    async def boom(system, parts):
        raise RuntimeError("vision down")

    ex = await dx.extract_from_image("data:image/png;base64,AAAA", llm_caller=boom)
    assert ex.components == []
    assert ex.notes


# ── meter dynamic discovery + confidence ─────────────────────────────────────


@pytest.fixture
def fake_get_price(monkeypatch):
    from services import pricing_service

    records: dict[str, list[dict]] = {}

    async def fake(service, sku_name="", region="eastus", currency="USD", *,
                   meter_name="", product_name="", unit_of_measure=""):
        if meter_name and meter_name in records:
            return records[meter_name]
        return records.get("", [])

    monkeypatch.setattr(pricing_service, "get_price", fake)
    return records


@pytest.mark.asyncio
async def test_dynamic_discovery_prices_noncatalog_service(fake_get_price):
    from services import meter_pricing_service as mp

    fake_get_price[""] = [
        {"skuName": "Standard", "meterName": "Gateway Hours", "productName": "NAT Gateway",
         "retailPrice": 0.045, "unitOfMeasure": "1 Hour", "meterId": "nat", "currencyCode": "USD"},
        {"skuName": "Standard", "meterName": "Data Processed", "productName": "NAT Gateway",
         "retailPrice": 0.045, "unitOfMeasure": "1 GB", "meterId": "natd", "currencyCode": "USD"},
    ]
    item = {"service": "NAT Gateway", "sku": "Standard", "quantity": 1, "hours_per_month": 730}
    line = await mp.price_line_item(item, dynamic_discovery=True)
    assert line["catalog_matched"] is False
    assert line["discovered"] is True
    assert line["meters"][0]["priced"] is True
    assert line["meters"][0]["monthly_cost"] == pytest.approx(round(0.045 * 730, 2))
    assert line["meters"][0]["citation"]["meter_id"] == "nat"
    assert "confidence_label" in line


@pytest.mark.asyncio
async def test_catalog_meter_has_confidence_and_citation(fake_get_price):
    from services import meter_pricing_service as mp

    fake_get_price[""] = [
        {"skuName": "Standard_D4s_v5", "meterName": "D4s v5", "productName": "Virtual Machines Dv5",
         "retailPrice": 0.20, "unitOfMeasure": "1 Hour", "meterId": "vm", "currencyCode": "USD"}
    ]
    item = {"service": "Virtual Machines", "sku": "Standard_D4s_v5", "quantity": 1, "hours_per_month": 730}
    line = await mp.price_line_item(item)
    compute = next(m for m in line["meters"] if m["dimension"] == "compute")
    assert compute["confidence"] >= 0.8           # requested SKU matched
    assert compute["citation"]["meter_id"] == "vm"
    assert line["confidence"] >= 0.8


# ── orchestrator ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_price_architecture_from_drawio_end_to_end(fake_get_price):
    from services import architecture_pricing_service as ap

    fake_get_price[""] = [
        {"skuName": "P1v3", "meterName": "P1 v3", "productName": "App Service",
         "retailPrice": 0.10, "unitOfMeasure": "1 Hour", "meterId": "app", "currencyCode": "USD"},
    ]
    ws = await ap.price_architecture(drawio_xml=_DRAWIO)
    # Every extracted node is accounted for.
    comp = ws["completeness"]
    assert comp["components_found"] >= 3
    assert any("Users" in nb["name"] for nb in comp["not_billable"])
    assert ws["extraction"]["source"] == "drawio_xml"
    assert ws["disclaimer"]
    # App Service line carries assumptions (defaulted SKU / hours).
    app_line = next(
        (ln for ln in ws["line_items"] if ln["service"] == "Azure App Service"), None
    )
    assert app_line is not None
    assert app_line.get("assumptions")


@pytest.mark.asyncio
async def test_price_architecture_streaming_emits_worksheet(fake_get_price):
    from services import architecture_pricing_service as ap

    fake_get_price[""] = [
        {"skuName": "GP_Gen5_2", "meterName": "vCore", "productName": "SQL DB General Purpose",
         "retailPrice": 0.12, "unitOfMeasure": "1 Hour", "meterId": "c", "currencyCode": "USD"}
    ]
    events = [
        ev
        async for ev in ap.stream_price_architecture(
            line_items=[{"service": "SQL Database", "sku": "GP_Gen5_2"}]
        )
    ]
    types = [e["type"] for e in events]
    assert "priced_worksheet" in types
    ws = next(e["worksheet"] for e in events if e["type"] == "priced_worksheet")
    assert ws["total_monthly_estimate"] > 0


@pytest.mark.asyncio
async def test_price_architecture_reservations(fake_get_price, monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
    from services import architecture_pricing_service as ap

    fake_get_price[""] = [
        {"skuName": "Standard_D8s_v5", "meterName": "D8s v5", "productName": "Virtual Machines Dv5",
         "retailPrice": 0.40, "unitOfMeasure": "1 Hour", "meterId": "vm", "currencyCode": "USD"}
    ]
    ws = await ap.price_architecture(
        line_items=[{"service": "Virtual Machines", "sku": "Standard_D8s_v5", "quantity": 2,
                     "hours_per_month": 730}],
        commitments={"Standard_D8s_v5": 2},
    )
    line = ws["line_items"][0]
    assert line.get("reservation_applied")
    assert line["monthly_subtotal"] < line["original_monthly_estimate"]


# ── CSV export ───────────────────────────────────────────────────────────────


def test_worksheet_to_csv_flattens_meters():
    from services import cost_template_service as cts

    worksheet = {
        "currency": "USD",
        "total_monthly_estimate": 100.0,
        "line_items": [
            {
                "service": "Virtual Machines",
                "display_name": "Web tier",
                "sku": "Standard_D4s_v5",
                "region": "eastus",
                "assumptions": ["Assumed 730h"],
                "meters": [
                    {"label": "Compute", "unit_of_measure": "1 Hour", "billable_quantity": 730,
                     "unit_price": 0.20, "monthly_cost": 146.0, "priced": True,
                     "confidence_label": "high", "citation": {"meter_id": "abc"}},
                ],
            }
        ],
    }
    csv_text = cts.worksheet_to_csv(worksheet)
    assert "Virtual Machines" in csv_text
    assert "146.0" in csv_text
    assert "1752.0" in csv_text          # annual = monthly * 12
    assert "TOTAL" in csv_text
    assert "abc" in csv_text             # citation meter id
