"""Tests for the pipeline orchestration in `routes/analyze.py`.

`_stream_architecture` is monkeypatched to emit a deterministic, mode-specific
SSE script so the pipeline tests do not require any Azure OpenAI calls.
"""
from __future__ import annotations

import json
from typing import AsyncGenerator

import pytest


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _make_fake_stream():
    """Returns a fake `_stream_architecture` that produces a small SSE script
    based on the `mode` field of the incoming ArchRequest.
    """

    captured_requests: list = []

    async def fake_stream(req) -> AsyncGenerator[str, None]:
        captured_requests.append(req)
        mode = req.mode

        if mode == "architecture":
            yield _sse({"type": "token", "content": "Architecture text. "})
            yield _sse({"type": "runbook", "markdown": "# Runbook\nstep 1"})
            yield _sse({"type": "bicep", "code": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}"})
        elif mode == "sizing":
            yield _sse({"type": "token", "content": "Sizing text. "})
        elif mode == "security":
            yield _sse({"type": "token", "content": "Security text. "})
        elif mode == "waf":
            yield _sse(
                {
                    "type": "waf_pillar",
                    "pillar": {
                        "pillar": "Reliability",
                        "score": 4,
                        "findings": ["zone redundancy missing"],
                        "recommendations": ["enable AZ"],
                    },
                }
            )
            yield _sse(
                {
                    "type": "waf_pillar",
                    "pillar": {
                        "pillar": "Security",
                        "score": 5,
                        "findings": [],
                        "recommendations": [],
                    },
                }
            )
        yield _sse({"type": "done"})

    return fake_stream, captured_requests


async def _drain(gen: AsyncGenerator[str, None]) -> list[dict]:
    events: list[dict] = []
    async for chunk in gen:
        if not chunk.startswith("data: "):
            continue
        raw = chunk[len("data: ") :].strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return events


@pytest.mark.asyncio
async def test_pipeline_runs_four_phases_in_order(monkeypatch):
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline

    fake_stream, _captured = _make_fake_stream()
    monkeypatch.setattr(analyze_mod, "_stream_architecture", fake_stream)

    req = AnalyzeRequest(requirements="Workload: TestApp\nFoo bar baz", constraints="", region="eastus")
    events = await _drain(_stream_pipeline(req))

    statuses = [(e["job"], e["status"]) for e in events if e.get("type") == "analyze_status"]
    assert statuses == [
        ("architecture", "running"),
        ("architecture", "done"),
        ("sizing", "running"),
        ("sizing", "done"),
        ("security", "running"),
        ("security", "done"),
        ("waf", "running"),
        ("waf", "done"),
    ]


@pytest.mark.asyncio
async def test_pipeline_injects_prior_context(monkeypatch):
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline

    fake_stream, captured = _make_fake_stream()
    monkeypatch.setattr(analyze_mod, "_stream_architecture", fake_stream)

    req = AnalyzeRequest(requirements="Workload: TestApp\nFoo bar", constraints="", region="eastus")
    await _drain(_stream_pipeline(req))

    by_mode = {r.mode: r for r in captured}
    assert "## Prior Step — Architecture" in by_mode["sizing"].requirements
    assert "## Prior Step — Architecture" in by_mode["security"].requirements
    assert "## Prior Step — Sizing" in by_mode["security"].requirements
    assert "## Prior Step — Security" in by_mode["waf"].requirements


@pytest.mark.asyncio
async def test_pipeline_emits_bundled_design(monkeypatch):
    from routes import analyze as analyze_mod
    from routes.analyze import AnalyzeRequest, _stream_pipeline

    fake_stream, _captured = _make_fake_stream()
    monkeypatch.setattr(analyze_mod, "_stream_architecture", fake_stream)

    req = AnalyzeRequest(requirements="Workload: TestApp\nFoo bar", constraints="", region="eastus")
    events = await _drain(_stream_pipeline(req))

    bundled = [e for e in events if e.get("type") == "bundled_design"]
    assert len(bundled) == 1
    b = bundled[0]
    assert b["workload_name"] == "TestApp"
    assert b["architecture"]["text"].strip() == "Architecture text."
    assert "Runbook" in b["architecture"]["runbook"]
    assert "Microsoft.Storage" in b["architecture"]["bicep"]
    assert b["sizing"]["text"].strip() == "Sizing text."
    assert b["security"]["text"].strip() == "Security text."
    assert isinstance(b["waf"]["pillars"], list)
    assert len(b["waf"]["pillars"]) == 2
    assert b["waf"]["pillars"][0]["pillar"] == "Reliability"


@pytest.mark.asyncio
async def test_relay_helper_tags_events_and_accumulates():
    from routes.analyze import _relay_sse

    async def gen():
        yield _sse({"type": "token", "content": "hello "})
        yield _sse({"type": "token", "content": "world"})
        yield _sse({"type": "runbook", "markdown": "rb"})
        yield _sse({"type": "bicep", "code": "param x string"})
        yield _sse({"type": "waf_pillar", "pillar": {"pillar": "Cost", "score": 3}})

    # 1) yield_individually path with container — tags _job/_phase and accumulates
    container: dict = {}
    chunks: list[str] = []
    async for chunk in _relay_sse(gen(), "architecture", phase="pipeline", container=container):
        chunks.append(chunk)
    objs = [json.loads(c[len("data: ") :].strip()) for c in chunks]
    assert all(o["_job"] == "architecture" for o in objs)
    assert all(o["_phase"] == "pipeline" for o in objs)
    assert container["text"] == "hello world"
    assert container["artifacts"]["runbook"] == "rb"
    assert container["artifacts"]["bicep"] == "param x string"
    assert container["waf_pillars"] == [{"pillar": "Cost", "score": 3}]

    # 2) collected path with no phase — appends to list, no yields
    collected: list[str] = []
    async for _ in _relay_sse(gen(), "waf", yield_individually=False, collected=collected):
        raise AssertionError("should not yield when yield_individually=False")
    assert len(collected) == 5
    tagged_objs = [json.loads(c[len("data: ") :].strip()) for c in collected]
    assert all(o["_job"] == "waf" for o in tagged_objs)
    assert all("_phase" not in o for o in tagged_objs)
