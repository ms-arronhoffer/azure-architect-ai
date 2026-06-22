"""Tests for the detached demo-build job manager (services.demo_jobs).

The pipeline itself is stubbed with a tiny async generator so these tests
exercise the registry/subscribe/cancel mechanics in isolation.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest


def _patch_pipeline(monkeypatch, events: list[dict], *, delay: float = 0.0):
    from services import demo_jobs as dj

    async def fake_stream(req, github_token: str = "") -> AsyncGenerator[dict, None]:
        for ev in events:
            if delay:
                await asyncio.sleep(delay)
            yield ev

    monkeypatch.setattr(dj, "stream_demo_pipeline", fake_stream)


def _req():
    from services.demo_pipeline import DemoBuildRequest

    return DemoBuildRequest(demo_slug="my-demo", demo_title="My Demo")


@pytest.mark.asyncio
async def test_job_runs_and_buffers_events(monkeypatch):
    from services import demo_jobs as dj

    _patch_pipeline(
        monkeypatch,
        [
            {"type": "phase_started", "phase": "intake_normalize"},
            {
                "type": "demo_built",
                "spec": {"slug": "my-demo"},
                "manifest": [],
                "files": {"README.md": "# hi"},
            },
        ],
    )

    job_id = dj.start_job(_req())
    collected = [ev async for ev in dj.subscribe(job_id)]

    types = [e["type"] for e in collected]
    assert "phase_started" in types
    assert "demo_built" in types
    assert types[-1] == "done"

    job = dj.get_job(job_id)
    assert job is not None
    assert job.status == "done"
    # files are stripped off the wire event and cached on the job for ZIP.
    assert job.files == {"README.md": "# hi"}
    assert job.result is not None
    assert "files" not in job.result
    assert job.result["job_id"] == job_id


@pytest.mark.asyncio
async def test_late_subscriber_replays_then_streams(monkeypatch):
    from services import demo_jobs as dj

    _patch_pipeline(
        monkeypatch,
        [
            {"type": "phase_started", "phase": "build"},
            {"type": "phase_complete", "phase": "build"},
        ],
        delay=0.02,
    )

    job_id = dj.start_job(_req())
    await asyncio.sleep(0.03)  # let the first event(s) buffer
    collected = [ev async for ev in dj.subscribe(job_id)]
    types = [e["type"] for e in collected]
    # The subscriber attaches late but still sees every buffered + live event.
    assert types.count("phase_complete") == 1
    assert types[-1] == "done"


@pytest.mark.asyncio
async def test_cancel_stops_running_job(monkeypatch):
    from services import demo_jobs as dj

    _patch_pipeline(
        monkeypatch,
        [{"type": "phase_started", "phase": "build"} for _ in range(50)],
        delay=0.05,
    )

    job_id = dj.start_job(_req())
    await asyncio.sleep(0.02)
    cancelled = await dj.cancel_job(job_id)
    assert cancelled is True

    job = dj.get_job(job_id)
    assert job is not None
    assert job.status == "cancelled"


@pytest.mark.asyncio
async def test_unknown_job_subscribe_is_empty():
    from services import demo_jobs as dj

    assert [ev async for ev in dj.subscribe("does-not-exist")] == []
    assert dj.get_job("does-not-exist") is None
    assert await dj.cancel_job("does-not-exist") is False


def test_fallback_design_is_buildable():
    from services.demo_pipeline import _fallback_design

    spec = {
        "slug": "rag-demo",
        "title": "RAG Demo",
        "azure_services": ["Azure OpenAI", "Azure AI Search"],
        "key_features": ["streaming"],
        "description": "Grounded answers over PDFs",
    }
    design = _fallback_design(spec, [{"name": "Citations"}])
    assert design["slug"] == "rag-demo"
    assert design["azure_services"] == ["Azure OpenAI", "Azure AI Search"]
    assert design["degraded"] is True
    # Fields the build lanes rely on must be present and non-empty.
    for key in ("tech_stack", "app_files", "bicep_resources", "env_vars", "diagrams"):
        assert design[key]
