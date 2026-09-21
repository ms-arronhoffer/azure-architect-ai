"""Every query now runs on gpt-5.6-sol, a reasoning deployment that rejects
Chat Completions. ``openai_service.chat_completion`` keeps the non-streaming
call sites (intake, improve, presentation, reranker, router, reports) working by
routing those deployments through the Responses API and handing back a
Chat-Completions-shaped result.
"""
from __future__ import annotations

from types import SimpleNamespace

from services import openai_service


class _ChatClient:
    """Records the Chat Completions kwargs it was called with."""

    def __init__(self):
        self.calls: list[dict] = []
        outer = self

        class _Completions:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return SimpleNamespace(choices=[], usage=None)

        self.chat = SimpleNamespace(completions=_Completions())


class _ResponsesClient:
    def __init__(self, resp):
        self.resp = resp
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.resp


def test_chat_family_uses_chat_completions():
    client = _ChatClient()
    openai_service.chat_completion(
        client,
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.3,
        max_completion_tokens=400,
        response_format={"type": "json_object"},
    )
    assert client.calls[0]["model"] == "gpt-4o-mini"
    assert client.calls[0]["temperature"] == 0.3
    assert client.calls[0]["max_completion_tokens"] == 400
    assert client.calls[0]["response_format"] == {"type": "json_object"}


def test_reasoning_model_routes_to_responses_api(monkeypatch):
    resp = SimpleNamespace(
        output_text="hello",
        output=[],
        usage=SimpleNamespace(input_tokens=5, output_tokens=7),
    )
    rclient = _ResponsesClient(resp)
    monkeypatch.setattr(
        openai_service,
        "get_responses_client",
        lambda _d: SimpleNamespace(responses=rclient),
    )

    out = openai_service.chat_completion(
        _ChatClient(),
        model="gpt-5.6-sol",
        messages=[
            {"role": "system", "content": "be terse"},
            {"role": "user", "content": "hi"},
        ],
        temperature=0.3,
        max_completion_tokens=400,
        response_format={"type": "json_object"},
    )

    kwargs = rclient.calls[0]
    assert kwargs["model"] == "gpt-5.6-sol"
    assert kwargs["instructions"] == "be terse"
    # Reasoning deployments reject `temperature` outright.
    assert "temperature" not in kwargs
    # Output budget leaves room for reasoning tokens before visible text.
    assert kwargs["max_output_tokens"] >= 400
    assert kwargs["text"] == {"format": {"type": "json_object"}}
    assert out.choices[0].message.content == "hello"
    assert out.choices[0].finish_reason == "stop"
    assert out.usage.input_tokens == 5


def test_reasoning_tool_call_is_normalized(monkeypatch):
    resp = SimpleNamespace(
        output_text="",
        output=[
            SimpleNamespace(
                type="function_call",
                call_id="call_1",
                name="generate_deck_outline",
                arguments='{"slides": []}',
            )
        ],
        usage=None,
    )
    rclient = _ResponsesClient(resp)
    monkeypatch.setattr(
        openai_service,
        "get_responses_client",
        lambda _d: SimpleNamespace(responses=rclient),
    )

    out = openai_service.chat_completion(
        _ChatClient(),
        model="gpt-5.6-sol",
        messages=[{"role": "user", "content": "deck please"}],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "generate_deck_outline",
                    "description": "",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
        tool_choice={"type": "function", "function": {"name": "generate_deck_outline"}},
        max_completion_tokens=4000,
    )

    kwargs = rclient.calls[0]
    assert kwargs["tools"][0]["name"] == "generate_deck_outline"
    assert kwargs["tool_choice"] == {"type": "function", "name": "generate_deck_outline"}
    call = out.choices[0].message.tool_calls[0]
    assert call.id == "call_1"
    assert call.function.name == "generate_deck_outline"
    assert call.function.arguments == '{"slides": []}'
    assert out.choices[0].finish_reason == "tool_calls"
