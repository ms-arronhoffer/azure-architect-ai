"""Tests for the deterministic cost optimization pipeline.

Mirrors the monkeypatch pattern used by `test_analyze_pipeline.py`: each
service function is replaced with a deterministic fake so the pipeline runs
without Azure SDK or OpenAI calls.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace

import pytest


async def _drain(gen: AsyncGenerator[dict, None]) -> list[dict]:
    events: list[dict] = []
    async for ev in gen:
        events.append(ev)
    return events


def _patch_narration(monkeypatch, *, captured: list[str] | None = None, text: str = "## TL;DR\nrun it"):
    """Replace the narration LLM call with a deterministic stub.

    If `captured` is given, the formatted prompt is appended to it so tests
    can assert on prompt content.
    """
    from services import cost_pipeline as cp_mod

    fake_client = SimpleNamespace()

    def fake_resolve(mode: str = "chat", provider: str = "azure", model=None, github_token=None):
        return fake_client, "fake-deployment"

    def fake_call_with_retry(fn, *, max_attempts: int = 2, model_name: str = ""):
        # Re-build the prompt the way _phase_narration does, by intercepting
        # the lambda's closure. Simpler: invoke fn() with a stubbed client.
        return fn()

    def fake_create(**kwargs):
        if captured is not None:
            messages = kwargs.get("messages") or []
            if messages:
                captured.append(messages[0].get("content", ""))
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text))]
        )

    fake_client.chat = SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    monkeypatch.setattr(cp_mod.openai_service, "resolve_client_and_model", fake_resolve)
    monkeypatch.setattr(cp_mod.openai_service, "call_with_retry", fake_call_with_retry)


@pytest.mark.asyncio
async def test_happy_path_with_engagement(monkeypatch):
    from services import cost_pipeline as cp_mod
    from services.cost_pipeline import CostLineItem, CostOptimizeRequest, stream_cost_pipeline

    engagement = SimpleNamespace(id="eng-123", subscription_ids=["sub-1"])

    async def fake_load_active():
        return engagement

    async def fake_estimate(items):
        return {"total_monthly_estimate": 1234.0, "line_items": items}

    async def fake_lookup(**kwargs):
        return {
            "service": kwargs["service"],
            "sku": kwargs["sku"],
            "monthly_estimate": 100.0,
        }

    def fake_carbon(items):
        return {"total_kgco2e_per_month": 42.5}

    def fake_reservations(sub_id, scope, lookback):
        return {
            "recommendations": [
                {
                    "sku": "Standard_D4s_v5",
                    "region": "eastus",
                    "payg_monthly": 200.0,
                    "reserved_monthly": 120.0,
                    "upfront_cost": 0.0,
                    "term_years": 1,
                }
            ]
        }

    def fake_rightsizing(sub_id):
        return {"vm_count": 3, "underutilised_count": 1}

    def fake_break_even(*, payg_monthly, reserved_monthly, upfront_cost, term_years):
        return {"break_even_months": 0, "lifetime_savings": 960.0}

    monkeypatch.setattr(cp_mod, "load_active", fake_load_active)
    monkeypatch.setattr(cp_mod, "estimate_architecture", fake_estimate)
    monkeypatch.setattr(cp_mod.retail_pricing_service, "lookup", fake_lookup)
    monkeypatch.setattr(cp_mod.carbon_service, "estimate_for_line_items", fake_carbon)
    monkeypatch.setattr(cp_mod.reservations_service, "recommend_reservations", fake_reservations)
    monkeypatch.setattr(cp_mod.rightsizing_service, "assess_vms", fake_rightsizing)
    monkeypatch.setattr(cp_mod.reservations_service, "break_even", fake_break_even)
    _patch_narration(monkeypatch, text="## TL;DR\nsavings opportunity")

    req = CostOptimizeRequest(items=[CostLineItem(service="vm", sku="Standard_D4s_v5")])
    events = await _drain(stream_cost_pipeline(req))

    phases_in_order = [(e["phase"], e["type"]) for e in events if e.get("phase")]
    started = [p for p, t in phases_in_order if t == "phase_started"]
    assert started == [
        "estimate",
        "live_price",
        "carbon",
        "reservations",
        "rightsizing",
        "break_even",
        "narration",
    ]
    completes = {p for p, t in phases_in_order if t == "phase_complete"}
    assert completes == {
        "estimate",
        "live_price",
        "carbon",
        "reservations",
        "rightsizing",
        "break_even",
        "narration",
    }

    final = [e for e in events if e.get("type") == "cost_optimization"]
    assert len(final) == 1
    payload = final[0]
    assert payload["engagement_id"] == "eng-123"
    assert payload["estimate"]["total_monthly_estimate"] == 1234.0
    assert payload["live_price"]["lookups"][0]["monthly_estimate"] == 100.0
    assert payload["carbon"]["total_kgco2e_per_month"] == 42.5
    assert payload["reservations"]["recommendations"][0]["sku"] == "Standard_D4s_v5"
    assert payload["rightsizing"]["underutilised_count"] == 1
    assert payload["break_even"]["analyses"][0]["lifetime_savings"] == 960.0
    assert "savings opportunity" in payload["report"]


@pytest.mark.asyncio
async def test_no_engagement_skips_phases(monkeypatch):
    from services import cost_pipeline as cp_mod
    from services.cost_pipeline import CostLineItem, CostOptimizeRequest, stream_cost_pipeline

    async def fake_load_active():
        return None

    async def fake_estimate(items):
        return {"total_monthly_estimate": 50.0, "line_items": items}

    async def fake_lookup(**kwargs):
        return {"service": kwargs["service"], "sku": kwargs["sku"], "monthly_estimate": 10.0}

    def fake_carbon(items):
        return {"total_kgco2e_per_month": 1.0}

    monkeypatch.setattr(cp_mod, "load_active", fake_load_active)
    monkeypatch.setattr(cp_mod, "estimate_architecture", fake_estimate)
    monkeypatch.setattr(cp_mod.retail_pricing_service, "lookup", fake_lookup)
    monkeypatch.setattr(cp_mod.carbon_service, "estimate_for_line_items", fake_carbon)
    _patch_narration(monkeypatch)

    req = CostOptimizeRequest(items=[CostLineItem(service="vm", sku="Standard_D2s_v5")])
    events = await _drain(stream_cost_pipeline(req))

    skips = {e["phase"]: e.get("reason") for e in events if e.get("type") == "phase_skipped"}
    assert skips.get("reservations") == "no_engagement"
    assert skips.get("rightsizing") == "no_engagement"
    assert skips.get("break_even") == "depends_on_reservations"

    completes = {e["phase"] for e in events if e.get("type") == "phase_complete"}
    assert {"estimate", "live_price", "carbon", "narration"}.issubset(completes)

    final = [e for e in events if e.get("type") == "cost_optimization"]
    assert len(final) == 1
    assert final[0]["engagement_id"] is None
    assert final[0]["reservations"] is None
    assert final[0]["rightsizing"] is None
    assert final[0]["break_even"] is None


@pytest.mark.asyncio
async def test_narration_prompt_includes_phase_state(monkeypatch):
    from services import cost_pipeline as cp_mod
    from services.cost_pipeline import CostLineItem, CostOptimizeRequest, stream_cost_pipeline

    async def fake_load_active():
        return None

    async def fake_estimate(items):
        return {"total_monthly_estimate": 777.0, "line_items": items}

    async def fake_lookup(**kwargs):
        return {"service": kwargs["service"], "sku": kwargs["sku"], "monthly_estimate": 42.0}

    def fake_carbon(items):
        return {"total_kgco2e_per_month": 9.9}

    monkeypatch.setattr(cp_mod, "load_active", fake_load_active)
    monkeypatch.setattr(cp_mod, "estimate_architecture", fake_estimate)
    monkeypatch.setattr(cp_mod.retail_pricing_service, "lookup", fake_lookup)
    monkeypatch.setattr(cp_mod.carbon_service, "estimate_for_line_items", fake_carbon)

    captured: list[str] = []
    _patch_narration(monkeypatch, captured=captured)

    req = CostOptimizeRequest(items=[CostLineItem(service="vm", sku="Standard_D2s_v5")])
    await _drain(stream_cost_pipeline(req))

    assert len(captured) == 1
    prompt = captured[0]
    assert "777" in prompt
    assert "9.9" in prompt
    # Skipped phases must serialize as null so the narrator can call them out
    parsed_block = prompt.split("Cost data:")[-1]
    assert '"reservations": null' in parsed_block
    assert '"rightsizing": null' in parsed_block


@pytest.mark.asyncio
async def test_service_error_continues_pipeline(monkeypatch):
    from services import cost_pipeline as cp_mod
    from services.cost_pipeline import CostLineItem, CostOptimizeRequest, stream_cost_pipeline

    async def fake_load_active():
        return None

    async def fake_estimate(items):
        return {"total_monthly_estimate": 10.0, "line_items": items}

    async def fake_lookup(**kwargs):
        return {"service": kwargs["service"], "sku": kwargs["sku"], "monthly_estimate": 1.0}

    def fake_carbon(items):
        raise RuntimeError("carbon backend exploded")

    monkeypatch.setattr(cp_mod, "load_active", fake_load_active)
    monkeypatch.setattr(cp_mod, "estimate_architecture", fake_estimate)
    monkeypatch.setattr(cp_mod.retail_pricing_service, "lookup", fake_lookup)
    monkeypatch.setattr(cp_mod.carbon_service, "estimate_for_line_items", fake_carbon)
    _patch_narration(monkeypatch)

    req = CostOptimizeRequest(items=[CostLineItem(service="vm", sku="Standard_D2s_v5")])
    events = await _drain(stream_cost_pipeline(req))

    failures = [e for e in events if e.get("type") == "phase_failed"]
    assert any(e["phase"] == "carbon" for e in failures)
    assert any("carbon backend exploded" in (e.get("error") or "") for e in failures)

    # Pipeline still reaches the final event with narration produced.
    final = [e for e in events if e.get("type") == "cost_optimization"]
    assert len(final) == 1
    assert final[0]["carbon"] is None
    assert final[0]["report"]  # narration ran


@pytest.mark.asyncio
async def test_live_price_phase_consumes_resolver_output():
    """The live_price phase routes through retail_pricing_service.lookup, which
    is now catalog-first: it must surface the resolved/matched SKU and a
    confidence score for each line item (not a silent cheapest-meter pick)."""
    from services import cost_pipeline as cp_mod
    from services import pricing_catalog
    from services.cost_pipeline import CostLineItem, CostOptimizeRequest

    pricing_catalog.clear_cache()
    req = CostOptimizeRequest(
        items=[CostLineItem(service="App Service", sku="P1v4", region="eastus")]
    )
    state: dict = {}
    _ = [ev async for ev in cp_mod._phase_live_price(req, state)]

    lookups = state["live_price"]["lookups"]
    assert len(lookups) == 1
    li = lookups[0]
    # The $9.49/mo Shared App trap must not win; the premium meter resolves.
    assert li["matched_sku"] == "P1 v4"
    assert li["monthly_estimate"] > 100
    assert li["confidence"] >= 0.9
    assert li["requested_sku"] == "P1v4"
