"""Tests for the quota_check phase in `_stream_pipeline`.

Monkeypatches `_stream_architecture` to a deterministic fake that emits
a `cost_estimate` event, and monkeypatches `mcp_service` + `engagement_context`
so the pipeline runs without needing the MCP server or a real engagement.
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from types import SimpleNamespace

import pytest


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _make_arch_stream_with_cost(line_items: list[dict]):
    """Fake `_stream_architecture` that emits a cost_estimate for the
    architecture mode and minimal output for other modes."""

    async def fake_stream(req) -> AsyncGenerator[str, None]:
        mode = req.mode
        if mode == "architecture":
            yield _sse({"type": "token", "content": "Arch text. "})
            yield _sse({
                "type": "cost_estimate",
                "estimate": {
                    "total_monthly_estimate": 1234.0,
                    "line_items": line_items,
                },
            })
        elif mode == "security":
            yield _sse({"type": "token", "content": "Sec text. "})
        elif mode == "waf":
            yield _sse({
                "type": "waf_pillar",
                "pillar": {"pillar": "Reliability", "score": 4, "findings": [], "recommendations": []},
            })
        yield _sse({"type": "done"})

    return fake_stream


async def _drain(gen: AsyncGenerator[str, None]) -> list[dict]:
    events: list[dict] = []
    async for chunk in gen:
        if not chunk.startswith("data: "):
            continue
        raw = chunk[6:].strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return events


def _fake_engagement(subs: list[str] | None, region: str | None = "eastus2"):
    if subs is None:
        return None
    return SimpleNamespace(
        id="eng-1",
        subscription_ids=subs,
        region_preference=region,
        reservation_commitments={},
    )


@pytest.mark.asyncio
async def test_happy_path_all_available(monkeypatch):
    """When MCP returns ample quota everywhere, no constraints recorded."""
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline
    from services import quota_service

    line_items = [{"service": "Compute", "sku": "Standard_D8s_v5", "region": "eastus2", "quantity": 4}]
    monkeypatch.setattr(analyze_mod, "_stream_architecture", _make_arch_stream_with_cost(line_items))
    monkeypatch.setattr(
        analyze_mod.engagement_context,
        "load_active",
        lambda: _async_value(_fake_engagement(["sub-1"])),
    )
    monkeypatch.setattr(quota_service.mcp_service, "is_mcp_available", lambda: True)

    async def fake_query(sub, sku, region):
        return {"available": 100, "raw": {}}

    monkeypatch.setattr(quota_service, "_query_quota", fake_query)
    # Bypass cache from earlier tests
    quota_service._cache.clear()

    req = AnalyzeRequest(requirements="Workload: T\nx", constraints="", region="eastus2")
    events = await _drain(_stream_pipeline(req))

    bundled = next(e for e in events if e.get("type") == "bundled_design")
    assert bundled["quota_constraints"] == []
    assert any(e.get("type") == "phase_complete" and e.get("_job") == "quota_check" for e in events)


@pytest.mark.asyncio
async def test_constrained_finds_alternative(monkeypatch):
    """eastus2 = 0 available, westus2 = 80 → alternative is westus2."""
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline
    from services import quota_service

    line_items = [{"service": "Compute", "sku": "Standard_NDv4", "region": "eastus2", "quantity": 4}]
    monkeypatch.setattr(analyze_mod, "_stream_architecture", _make_arch_stream_with_cost(line_items))
    monkeypatch.setattr(
        analyze_mod.engagement_context,
        "load_active",
        lambda: _async_value(_fake_engagement(["sub-1"], region="eastus2")),
    )
    monkeypatch.setattr(quota_service.mcp_service, "is_mcp_available", lambda: True)

    async def fake_query(sub, sku, region):
        if region == "eastus2":
            return {"available": 0, "raw": {}}
        if region == "westus2":
            return {"available": 80, "raw": {}}
        return {"available": 10, "raw": {}}

    monkeypatch.setattr(quota_service, "_query_quota", fake_query)
    quota_service._cache.clear()

    req = AnalyzeRequest(requirements="Workload: T\nx", constraints="", region="eastus2")
    events = await _drain(_stream_pipeline(req))

    bundled = next(e for e in events if e.get("type") == "bundled_design")
    constraints = bundled["quota_constraints"]
    assert len(constraints) == 1
    c = constraints[0]
    assert c["sku"] == "Standard_NDv4"
    assert c["region"] == "eastus2"
    assert c["available"] == 0
    assert any(a["region"] == "westus2" for a in c["alternatives"])

    # Confirm sizing/security prompts received the constraint injection.
    # Inspect events for the quota_constraint emission too.
    quota_events = [e for e in events if e.get("type") == "quota_constraint"]
    assert len(quota_events) == 1


@pytest.mark.asyncio
async def test_mcp_unavailable_skips_phase(monkeypatch):
    """When MCP is offline, pipeline emits phase_skipped and continues."""
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline
    from services import quota_service

    line_items = [{"service": "Compute", "sku": "Standard_D4s_v5", "region": "eastus", "quantity": 1}]
    monkeypatch.setattr(analyze_mod, "_stream_architecture", _make_arch_stream_with_cost(line_items))
    monkeypatch.setattr(
        analyze_mod.engagement_context,
        "load_active",
        lambda: _async_value(_fake_engagement(["sub-1"])),
    )
    monkeypatch.setattr(quota_service.mcp_service, "is_mcp_available", lambda: False)
    quota_service._cache.clear()

    req = AnalyzeRequest(requirements="Workload: T\nx", constraints="", region="eastus")
    events = await _drain(_stream_pipeline(req))

    skip = [e for e in events if e.get("type") == "phase_skipped" and e.get("_job") == "quota_check"]
    assert len(skip) == 1
    assert skip[0].get("reason") == "mcp_unavailable"

    # Pipeline still produces final bundled_design with empty constraints
    bundled = next(e for e in events if e.get("type") == "bundled_design")
    assert bundled["quota_constraints"] == []


@pytest.mark.asyncio
async def test_multi_subscription_picks_best(monkeypatch):
    """Among two subs (one exhausted, one with headroom), constraint reports
    the sub with most headroom — and is not a constraint at all if it suffices."""
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline
    from services import quota_service

    line_items = [{"service": "Compute", "sku": "Standard_D8s_v5", "region": "eastus2", "quantity": 4}]
    monkeypatch.setattr(analyze_mod, "_stream_architecture", _make_arch_stream_with_cost(line_items))
    monkeypatch.setattr(
        analyze_mod.engagement_context,
        "load_active",
        lambda: _async_value(_fake_engagement(["sub-empty", "sub-full"])),
    )
    monkeypatch.setattr(quota_service.mcp_service, "is_mcp_available", lambda: True)

    async def fake_query(sub, sku, region):
        if sub == "sub-empty":
            return {"available": 0, "raw": {}}
        return {"available": 50, "raw": {}}

    monkeypatch.setattr(quota_service, "_query_quota", fake_query)
    quota_service._cache.clear()

    req = AnalyzeRequest(requirements="Workload: T\nx", constraints="", region="eastus2")
    events = await _drain(_stream_pipeline(req))

    bundled = next(e for e in events if e.get("type") == "bundled_design")
    # sub-full has headroom; no constraint should be reported
    assert bundled["quota_constraints"] == []


def _async_value(v):
    """Return an awaitable resolving to v — handy for monkeypatching."""

    async def _coro():
        return v

    return _coro()
