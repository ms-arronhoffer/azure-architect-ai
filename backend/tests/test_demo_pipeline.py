"""Tests for the demo build pipeline.

Mirrors the monkeypatch pattern from test_cost_pipeline.py: every LLM call
and external subprocess is stubbed so the pipeline runs hermetically.
"""
from __future__ import annotations

import contextlib
from collections.abc import AsyncGenerator
from types import SimpleNamespace

import pytest


async def _drain(gen: AsyncGenerator[dict, None]) -> list[dict]:
    events: list[dict] = []
    async for ev in gen:
        events.append(ev)
    return events


def _make_request(**overrides):
    from services.demo_pipeline import DemoBuildRequest

    base = {
        "demo_slug": "my-demo",
        "demo_title": "My Demo",
        "audience": "customer",
        "duration_minutes": 15,
        "target_persona": "platform engineer",
        "key_features": ["streaming", "managed identity"],
        "azure_services": ["Azure OpenAI", "App Service"],
    }
    base.update(overrides)
    return DemoBuildRequest(**base)


def _design_payload() -> dict:
    return {
        "slug": "my-demo",
        "title": "My Demo",
        "demo_archetype": "rag",
        "tech_stack": "react_ts",
        "azure_services": ["Azure OpenAI", "App Service"],
        "app_files": [{"path": "app.py", "purpose": "entry"}],
        "bicep_resources": ["Microsoft.CognitiveServices/accounts"],
        "env_vars": ["AZURE_OPENAI_ENDPOINT"],
        "key_features": ["streaming"],
        "wow_moment_implementation": "token-by-token SSE",
        "summary_bullets": ["a", "b"],
        "behind_the_scenes": [
            {"service": "Azure OpenAI", "role": "Generates the answer"},
        ],
        "live_activity": [
            {
                "step_id": "generate",
                "service": "Azure OpenAI",
                "stage": "Generating",
                "detail": "Streaming the answer",
                "duration_ms": 900,
            },
        ],
        "diagrams": [
            {"name": "component", "mermaid": "graph LR\n  A --> B"},
            {"name": "flow", "mermaid": "sequenceDiagram\n  A->>B: hi"},
        ],
    }


def _stub_llm_responses(monkeypatch, lane_failures: set[str] | None = None):
    """Stub demo_pipeline._llm_json with deterministic payloads per phase."""
    from services import demo_pipeline as dp_mod

    lane_failures = lane_failures or set()

    async def fake_llm_json(
        prompt: str,
        *,
        max_tokens: int = 4000,
        retry_on_parse: bool = True,
        phase: str = "default",
    ):
        if "designing improvements for a new Azure AI demo" in prompt:
            return {
                "recommendations": [
                    {"name": "SSE streaming", "rationale": "x", "implementation_hint": "y"}
                ]
            }
        if "architecture for a new Azure AI demo" in prompt:
            return _design_payload()
        if "production-quality application code" in prompt:
            if "code" in lane_failures:
                raise RuntimeError("code lane boom")
            return {
                "files": [
                    {"path": "app.py", "content": "print('hi')"},
                    {"path": "requirements.txt", "content": "flask>=3.1.0"},
                ]
            }
        if "Bicep infrastructure" in prompt:
            if "infra" in lane_failures:
                raise RuntimeError("infra lane boom")
            return {
                "files": [
                    {"path": "infra/main.bicep", "content": "// bicep"},
                    {"path": "infra/main.bicepparam", "content": "using 'main.bicep'"},
                ]
            }
        if "generating documentation" in prompt:
            if "docs" in lane_failures:
                raise RuntimeError("docs lane boom")
            return {
                "files": [
                    {"path": "README.md", "content": "# Demo"},
                    {
                        "path": "ARCHITECTURE.md",
                        "content": "# Arch\n\n```mermaid\ngraph LR\n  A --> B\n```\n",
                    },
                    {"path": "DEPLOYMENT.md", "content": "# Deploy"},
                    {"path": ".env.example", "content": "AZURE_OPENAI_ENDPOINT="},
                    {"path": ".gitignore", "content": ".env"},
                ]
            }
        raise AssertionError(f"unhandled prompt: {prompt[:120]}")

    monkeypatch.setattr(dp_mod, "_llm_json", fake_llm_json)


async def _no_engagement():
    return None


async def _empty_preamble() -> str:
    return ""


@pytest.mark.asyncio
async def test_happy_path(monkeypatch):
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch)
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)  # skip verify

    events = await _drain(stream_demo_pipeline(_make_request()))

    types = [e.get("type") for e in events]
    assert "demo_built" in types
    phases = [(e.get("phase"), e.get("type")) for e in events if "phase" in e]
    assert ("intake_normalize", "phase_complete") in phases
    assert ("recommendations", "phase_complete") in phases
    assert ("architecture_design", "phase_complete") in phases
    assert ("build", "phase_complete") in phases
    assert ("verify", "phase_skipped") in phases
    assert ("publish", "phase_skipped") in phases

    final = events[-1]
    assert final["type"] == "demo_built"
    paths = {entry["path"] for entry in final["manifest"]}
    for required in {
        "app.py",
        "requirements.txt",
        "infra/main.bicep",
        "infra/main.bicepparam",
        "README.md",
        "ARCHITECTURE.md",
        "DEPLOYMENT.md",
        ".env.example",
    }:
        assert required in paths


@pytest.mark.asyncio
async def test_parallel_build_one_fails(monkeypatch):
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch, lane_failures={"docs"})
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)

    events = await _drain(stream_demo_pipeline(_make_request()))
    phases = [(e.get("phase"), e.get("type")) for e in events if "phase" in e]

    assert ("build.code", "phase_complete") in phases
    assert ("build.infra", "phase_complete") in phases
    assert ("build.docs", "phase_failed") in phases
    # parent build still completes (one lane survives)
    assert ("build", "phase_complete") in phases
    # verify still runs (main.bicep was produced by the infra lane)
    assert ("verify", "phase_skipped") in phases


@pytest.mark.asyncio
async def test_az_cli_missing_skips_verify(monkeypatch):
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch)
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)

    events = await _drain(stream_demo_pipeline(_make_request()))
    skipped = [e for e in events if e.get("phase") == "verify" and e.get("type") == "phase_skipped"]
    assert skipped, "verify should have emitted phase_skipped"
    assert skipped[0]["reason"] == "az_cli_missing"


@pytest.mark.asyncio
async def test_publish_gated(monkeypatch):
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch)
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)
    monkeypatch.delenv("DEMO_FACTORY_PUBLISH", raising=False)

    events = await _drain(stream_demo_pipeline(_make_request(publish=True)))
    publish = [e for e in events if e.get("phase") == "publish"]
    assert publish[-1]["type"] == "phase_skipped"
    assert publish[-1]["reason"] == "publish_disabled"
    assert events[-1]["type"] == "demo_built"
    assert events[-1]["repo_url"] is None


@pytest.mark.asyncio
async def test_mermaid_extracted(monkeypatch):
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch)
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)

    events = await _drain(stream_demo_pipeline(_make_request()))
    final = events[-1]
    assert final["type"] == "demo_built"
    # Prefers design.diagrams (2 entries) over fallback ARCHITECTURE.md scrape.
    assert len(final["diagrams"]) >= 1
    assert any("mermaid" in d and d["mermaid"] for d in final["diagrams"])


@pytest.mark.asyncio
async def test_phase_routes_to_distinct_models(monkeypatch):
    """recommendations → mini, architecture_design → pro, build lanes → gpt-5.4."""
    from services import demo_pipeline as dp_mod

    captured: list[tuple[str, str]] = []

    async def fake_load_settings():
        return SimpleNamespace(mode_models={})

    monkeypatch.setattr(dp_mod, "load_settings", fake_load_settings)

    def fake_resolve(*, mode, provider, model, **_kw):
        captured.append((mode, model))
        return SimpleNamespace(), model or "fallback"

    monkeypatch.setattr(
        dp_mod.openai_service, "resolve_client_and_model", fake_resolve
    )
    # Short-circuit the actual LLM call after model resolution.
    monkeypatch.setattr(
        dp_mod.openai_service, "call_with_retry", lambda *a, **kw: None
    )
    monkeypatch.setattr(dp_mod, "_extract_responses_text", lambda _r: "{}")
    monkeypatch.setattr(
        dp_mod.openai_service, "get_responses_client", lambda _d: SimpleNamespace()
    )

    # Drive _llm_json directly with each phase and inspect the resolved model.
    for phase, expected in [
        ("recommendations", "gpt-5.4-mini"),
        ("architecture_design", "gpt-5.4-pro"),
        ("code", "gpt-5.4"),
        ("infra", "gpt-5.4"),
        ("docs", "gpt-5.4"),
    ]:
        captured.clear()
        with contextlib.suppress(Exception):
            await dp_mod._llm_json("{}", phase=phase, retry_on_parse=False)
        assert captured, f"resolve not called for phase {phase}"
        assert captured[0][1] == expected, f"{phase} → {captured[0][1]} (want {expected})"


@pytest.mark.asyncio
async def test_responses_incomplete_stream_recovers_partial(monkeypatch):
    """A truncated Responses stream (terminal `response.incomplete`, no
    `response.completed`) must not raise "Didn't receive a `response.completed`
    event." — the lane should recover the partial `output_text` so generated
    code still reaches the build instead of the whole lane being discarded."""
    from services import demo_pipeline as dp_mod

    async def fake_load_settings():
        return SimpleNamespace(mode_models={})

    monkeypatch.setattr(dp_mod, "load_settings", fake_load_settings)
    monkeypatch.setattr(
        dp_mod.openai_service,
        "resolve_client_and_model",
        lambda **_kw: (SimpleNamespace(), "gpt-5.4"),
    )
    monkeypatch.setattr(
        dp_mod.openai_service, "call_with_retry", lambda fn, **_kw: fn()
    )

    partial_json = '{"files": [{"path": "app.py", "content": "print(1)"}]}'
    incomplete_resp = SimpleNamespace(
        status="incomplete",
        output_text=partial_json,
        incomplete_details=SimpleNamespace(reason="max_output_tokens"),
    )

    class _Stream:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def __iter__(self):
            return iter([SimpleNamespace(type="response.incomplete", response=incomplete_resp)])

        def get_final_response(self):  # SDK would raise here for an incomplete stream
            raise RuntimeError("Didn't receive a `response.completed` event.")

    fake_client = SimpleNamespace(
        responses=SimpleNamespace(stream=lambda **_kw: _Stream())
    )
    monkeypatch.setattr(
        dp_mod.openai_service, "get_responses_client", lambda _d: fake_client
    )

    out = await dp_mod._llm_json("{}", phase="code", retry_on_parse=False)
    assert out == {"files": [{"path": "app.py", "content": "print(1)"}]}


@pytest.mark.asyncio
async def test_demo_built_carries_archetype_and_live_activity(monkeypatch):
    """The final demo_built payload exposes the archetype + live_activity script
    so the UI can render the in-app Activity Panel and mocked preview."""
    from services import demo_pipeline as dp_mod
    from services.demo_pipeline import stream_demo_pipeline

    _stub_llm_responses(monkeypatch)
    monkeypatch.setattr(dp_mod, "load_active", _no_engagement)
    monkeypatch.setattr(dp_mod, "preamble_for_active", _empty_preamble)
    monkeypatch.setattr(dp_mod.shutil, "which", lambda name: None)

    events = await _drain(stream_demo_pipeline(_make_request()))
    final = events[-1]
    assert final["type"] == "demo_built"
    assert final["demo_archetype"] == "rag"
    assert final["live_activity"], "live_activity script should be propagated"
    step = final["live_activity"][0]
    assert step["step_id"] == "generate"
    assert step["service"] == "Azure OpenAI"
    assert final["behind_the_scenes"][0]["service"] == "Azure OpenAI"

    # architecture_design completion event advertises the archetype + step count.
    arch_complete = [
        e for e in events
        if e.get("phase") == "architecture_design" and e.get("type") == "phase_complete"
    ]
    assert arch_complete
    assert arch_complete[-1]["demo_archetype"] == "rag"
    assert arch_complete[-1]["activity_step_count"] == 1


@pytest.mark.asyncio
async def test_fallback_design_includes_archetype_and_live_activity(monkeypatch):
    """When architecture_design fails, the synthesized fallback still carries the
    new contract fields so downstream build + UI stay coherent."""
    from services.demo_pipeline import _fallback_design

    fb = _fallback_design(
        {"slug": "d", "title": "Demo", "azure_services": ["Azure OpenAI"]},
        None,
    )
    assert fb["demo_archetype"]
    assert fb["live_activity"] and fb["live_activity"][0]["step_id"]
    assert fb["behind_the_scenes"][0]["service"] == "Azure OpenAI"
    # Component diagram node id matches the live_activity step_id (live highlight).
    assert fb["live_activity"][0]["step_id"] in fb["diagrams"][0]["mermaid"]


def test_prompts_embed_activity_contract():
    """The build/design prompts must encode the Azure Activity Protocol contract
    so generated demos surface live, service-attributed Azure activity."""
    from prompts.demo import (
        ARCHITECTURE_DESIGN_PROMPT,
        CODE_AGENT_PROMPT,
        DOCS_AGENT_PROMPT,
    )

    arch = ARCHITECTURE_DESIGN_PROMPT("{}", "[]", "")
    for token in ("demo_archetype", "live_activity", "behind_the_scenes", "step_id"):
        assert token in arch, f"architecture prompt missing {token!r}"

    code = CODE_AGENT_PROMPT("{}", "{}")
    for token in (
        "Azure Activity Protocol",
        "Azure Activity Panel",
        "demo_archetype",
        "?mock=1",
        "step_id",
    ):
        assert token in code, f"code prompt missing {token!r}"
    # The generic JSON-dump anti-pattern must be explicitly forbidden.
    assert "JSON.stringify" in code

    docs = DOCS_AGENT_PROMPT("{}", "{}")
    assert "Activity Panel" in docs
    assert "live_activity" in docs
