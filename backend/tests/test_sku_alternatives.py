"""Tests for sku_alternatives_service, the clarify accessor, and the new
chat tool dispatch branches (suggest_alternatives / request_clarification).

The Azure Retail API is monkeypatched with a deterministic fake so the tests
run hermetically.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _required_settings_env(monkeypatch):
    """Satisfy the single required Settings field so routes.chat imports.

    Settings.azure_openai_endpoint has no default; the dispatch branches under
    test never call the model, they only need the module to import.
    """
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")


@pytest.fixture
def fake_estimate(monkeypatch):
    """Install a fake pricing_service.estimate_line_item keyed by SKU."""
    from services import pricing_service

    # sku (lower) -> monthly estimate (None => unknown)
    by_sku: dict[str, float | None] = {}

    async def fake_estimate_line_item(
        service, sku="", quantity=1, hours_per_month=730.0, region="eastus"
    ):
        key = (sku or "").strip().lower()
        monthly = by_sku.get(key)
        return {
            "service": service,
            "sku": sku,
            "region": region,
            "quantity": quantity,
            "unit_price": (monthly / hours_per_month) if monthly else None,
            "monthly_estimate": monthly,
            "currency": "USD",
        }

    monkeypatch.setattr(pricing_service, "estimate_line_item", fake_estimate_line_item)
    return by_sku


# ── sku_alternatives_service ────────────────────────────────────────────────


def test_candidate_skus_intel_to_amd():
    from services import sku_alternatives_service as svc

    cands = [c["sku"] for c in svc._candidate_skus("Virtual Machines", "D8s_v5")]
    assert "D8as_v5" in cands
    # Space-separated retail form is preserved.
    cands_space = [c["sku"] for c in svc._candidate_skus("Virtual Machines", "D8s v5")]
    assert "D8as v5" in cands_space


def test_candidate_skus_unknown_returns_empty():
    from services import sku_alternatives_service as svc

    assert svc._candidate_skus("Virtual Machines", "B2ms") == []
    assert svc._candidate_skus("Virtual Machines", "") == []


@pytest.mark.asyncio
async def test_suggest_ranks_cheaper_first(fake_estimate):
    from services import sku_alternatives_service as svc

    fake_estimate["d8s_v5"] = 400.0
    fake_estimate["d8as_v5"] = 360.0  # AMD, ~10% cheaper

    result = await svc.suggest("Virtual Machines", "D8s_v5", region="eastus")

    assert result["baseline"]["monthly_estimate"] == 400.0
    assert result["alternative_count"] == 1
    assert result["cheaper_count"] == 1
    alt = result["alternatives"][0]
    assert alt["sku"] == "D8as_v5"
    assert alt["cheaper"] is True
    assert alt["delta_vs_baseline"] == -40.0
    assert alt["savings_pct"] == 10.0


@pytest.mark.asyncio
async def test_suggest_drops_unpriced_candidate(fake_estimate):
    from services import sku_alternatives_service as svc

    fake_estimate["d8s_v5"] = 400.0
    # D8as_v5 not in fake -> unavailable -> dropped, never fabricated.
    result = await svc.suggest("Virtual Machines", "D8s_v5", region="eastus")
    assert result["alternative_count"] == 0
    assert result["alternatives"] == []


@pytest.mark.asyncio
async def test_suggest_no_known_alternative(fake_estimate):
    from services import sku_alternatives_service as svc

    fake_estimate["b2ms"] = 60.0
    result = await svc.suggest("Virtual Machines", "B2ms", region="eastus")
    assert result["alternative_count"] == 0


# ── clarify accessor ────────────────────────────────────────────────────────


def test_clarify_for_vm_and_sql():
    from services import cost_catalog

    vm = cost_catalog.clarify_for("vm")
    assert any(q.get("key") == "size" and q.get("required") for q in vm)
    sql = cost_catalog.clarify_for("azure sql")
    assert any(q.get("key") == "engine" for q in sql)
    assert cost_catalog.clarify_for("Bandwidth") == []  # no clarify block


def test_public_catalog_exposes_clarify():
    from services import cost_catalog

    cat = cost_catalog.public_catalog()
    vm = next(s for s in cat["services"] if s["service"] == "Virtual Machines")
    assert vm["clarify"]


# ── dispatch branches ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dispatch_suggest_alternatives_event(fake_estimate):
    from routes.chat import _dispatch_tool

    fake_estimate["d8s_v5"] = 400.0
    fake_estimate["d8as_v5"] = 360.0

    result, event = await _dispatch_tool(
        "suggest_alternatives",
        {"service": "Virtual Machines", "sku": "D8s_v5", "region": "eastus"},
    )
    assert event is not None
    assert event["type"] == "cost_alternatives"
    assert event["alternatives"]["alternatives"][0]["sku"] == "D8as_v5"
    assert result["status"] == "alternatives_suggested"
    assert result["cheaper_count"] == 1


@pytest.mark.asyncio
async def test_dispatch_request_clarification_event():
    from routes.chat import _dispatch_tool

    questions = [
        {"question": "Relational or non-relational?", "options": ["Relational", "Cosmos DB"]},
    ]
    result, event = await _dispatch_tool(
        "request_clarification",
        {"questions": questions, "known_so_far": {"service": "database"}, "context": "Pricing a DB"},
    )
    assert event is not None
    assert event["type"] == "clarification_request"
    assert event["request"]["questions"] == questions
    assert event["request"]["known_so_far"] == {"service": "database"}
    assert result["status"] == "clarification_requested"
    assert result["question_count"] == 1
