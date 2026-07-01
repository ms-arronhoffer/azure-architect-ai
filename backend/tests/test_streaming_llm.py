"""The Architecture Review evaluation runs on gpt-5.4, a reasoning deployment that
only speaks the Responses API. ``streaming_llm.stream_tool_completion`` normalizes
Chat Completions *and* Responses API streams into one tool-loop event schema so the
architecture / WAF routes work on both surfaces.
"""
from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_KEY", "test-key")

from services.streaming_llm import (
    _tools_to_responses,
    chat_messages_to_responses,
    stream_tool_completion,
)

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "assess_waf_pillar",
            "description": "Assess a pillar.",
            "parameters": {"type": "object", "properties": {}},
        },
    }
]


class _AsyncStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


async def _collect(gen):
    return [ev async for ev in gen]


# --- Chat Completions path -------------------------------------------------

def _chat_chunk(*, content=None, tool=None, finish=None, usage=None):
    delta = SimpleNamespace(content=content, tool_calls=None)
    if tool is not None:
        idx, tid, name, args = tool
        fn = SimpleNamespace(name=name, arguments=args)
        delta.tool_calls = [SimpleNamespace(index=idx, id=tid, function=fn)]
    choice = SimpleNamespace(delta=delta, finish_reason=finish)
    return SimpleNamespace(choices=[choice], usage=usage)


@pytest.mark.asyncio
async def test_chat_path_normalizes_content_and_tool_calls():
    chunks = [
        _chat_chunk(content="Hello "),
        _chat_chunk(content="world"),
        _chat_chunk(tool=(0, "call_1", "assess_waf_pillar", '{"pillar":')),
        _chat_chunk(tool=(0, None, None, '"security"}')),
        _chat_chunk(finish="tool_calls",
                    usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5)),
    ]

    class _Client:
        class chat:
            class completions:
                @staticmethod
                async def create(**_):
                    return _AsyncStream(chunks)

    events = await _collect(
        stream_tool_completion(_Client(), "gpt-4.1", [{"role": "user", "content": "hi"}],
                               _TOOLS, use_responses=False)
    )
    kinds = [e["type"] for e in events]
    assert kinds.count("content") == 2
    tool = next(e for e in events if e["type"] == "tool_call")
    assert tool["id"] == "call_1"
    assert tool["name"] == "assess_waf_pillar"
    assert tool["arguments"] == '{"pillar":"security"}'
    usage = next(e for e in events if e["type"] == "usage")
    assert usage == {"type": "usage", "prompt": 10, "completion": 5}
    assert events[-1] == {"type": "finish", "reason": "tool_calls"}


# --- Responses API path ----------------------------------------------------

@pytest.mark.asyncio
async def test_responses_path_normalizes_content_and_tool_calls():
    events_in = [
        SimpleNamespace(type="response.output_text.delta", delta="Assess "),
        SimpleNamespace(type="response.output_text.delta", delta="now"),
        SimpleNamespace(
            type="response.output_item.added",
            item=SimpleNamespace(type="function_call", id="item_1",
                                 call_id="call_9", name="assess_waf_pillar", arguments=""),
        ),
        SimpleNamespace(type="response.function_call_arguments.delta",
                        item_id="item_1", delta='{"pillar":'),
        SimpleNamespace(type="response.function_call_arguments.done",
                        item_id="item_1", name="assess_waf_pillar",
                        arguments='{"pillar":"cost"}'),
        SimpleNamespace(
            type="response.completed",
            response=SimpleNamespace(
                usage=SimpleNamespace(input_tokens=20, output_tokens=8)),
        ),
    ]

    captured = {}

    class _Client:
        class responses:
            @staticmethod
            async def create(**kwargs):
                captured.update(kwargs)
                return _AsyncStream(events_in)

    events = await _collect(
        stream_tool_completion(_Client(), "gpt-5.4",
                               [{"role": "system", "content": "sys"},
                                {"role": "user", "content": "hi"}],
                               _TOOLS, use_responses=True)
    )
    # Responses API requires flattened tool schema + instructions carved out.
    assert captured["instructions"] == "sys"
    assert captured["tools"][0]["name"] == "assess_waf_pillar"
    assert "function" not in captured["tools"][0]

    tool = next(e for e in events if e["type"] == "tool_call")
    assert tool["id"] == "call_9"
    assert tool["name"] == "assess_waf_pillar"
    assert tool["arguments"] == '{"pillar":"cost"}'
    usage = next(e for e in events if e["type"] == "usage")
    assert usage == {"type": "usage", "prompt": 20, "completion": 8}
    assert events[-1] == {"type": "finish", "reason": "tool_calls"}


# --- Converters ------------------------------------------------------------

def test_tools_to_responses_flattens_schema():
    out = _tools_to_responses(_TOOLS)
    assert out == [{
        "type": "function",
        "name": "assess_waf_pillar",
        "description": "Assess a pillar.",
        "parameters": {"type": "object", "properties": {}},
    }]


def test_chat_messages_to_responses_round_trips_tool_loop():
    messages = [
        {"role": "system", "content": "you are helpful"},
        {"role": "user", "content": "review this"},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": "c1", "type": "function",
                         "function": {"name": "assess_waf_pillar", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": '{"status":"received"}'},
    ]
    instructions, inp = chat_messages_to_responses(messages)
    assert instructions == "you are helpful"
    assert {"type": "function_call", "call_id": "c1",
            "name": "assess_waf_pillar", "arguments": "{}"} in inp
    assert {"type": "function_call_output", "call_id": "c1",
            "output": '{"status":"received"}'} in inp


def test_chat_messages_to_responses_converts_image_parts():
    messages = [
        {"role": "user", "content": [
            {"type": "text", "text": "look"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,xxx", "detail": "high"}},
        ]},
    ]
    _, inp = chat_messages_to_responses(messages)
    parts = inp[0]["content"]
    assert parts[0] == {"type": "input_text", "text": "look"}
    assert parts[1]["type"] == "input_image"
    assert parts[1]["image_url"] == "data:image/png;base64,xxx"
    assert parts[1]["detail"] == "high"


# --- Deployment routing ----------------------------------------------------

def test_review_defaults_to_gpt54_via_responses_api():
    from services import openai_service

    # Evaluation (Architecture Review) resolves to the reasoning eval model.
    assert openai_service.get_deployment("review") == "gpt-5.4"
    assert openai_service.needs_responses_api("gpt-5.4") is True

    _, deployment, use_responses = openai_service.resolve_streaming_client("review")
    assert deployment == "gpt-5.4"
    assert use_responses is True


def test_gpt4_family_stays_on_chat_completions():
    from services import openai_service

    _, deployment, use_responses = openai_service.resolve_streaming_client("architecture")
    assert deployment == "gpt-4.1"
    assert use_responses is False


# --- Transient retry -------------------------------------------------------

@pytest.mark.asyncio
async def test_transient_error_retries_then_surfaces(monkeypatch):
    from openai import RateLimitError

    import services.streaming_llm as sl

    monkeypatch.setattr(sl.asyncio, "sleep", lambda *_: _noop())

    attempts = {"n": 0}

    def _err():
        from unittest.mock import MagicMock
        resp = MagicMock()
        resp.headers = {}
        resp.status_code = 429
        return RateLimitError("rate limited", response=resp, body=None)

    class _Client:
        class chat:
            class completions:
                @staticmethod
                async def create(**_):
                    attempts["n"] += 1
                    raise _err()

    events = await _collect(
        stream_tool_completion(_Client(), "gpt-4.1", [{"role": "user", "content": "hi"}],
                               _TOOLS, use_responses=False)
    )
    # Retries surface a status before the terminal error, and exhaust after
    # _MAX_ATTEMPTS rather than looping forever.
    assert attempts["n"] == sl._MAX_ATTEMPTS
    assert any(e["type"] == "status" for e in events)
    assert events[-1]["type"] == "error"


async def _noop():
    return None

