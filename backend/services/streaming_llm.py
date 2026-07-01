"""Normalized tool-enabled streaming over Chat Completions *and* the Responses API.

The architecture / WAF streaming routes need to call reasoning deployments
(gpt-5 / codex / o-series) which reject Chat Completions and must go through the
Responses API — the same rule enforced elsewhere via
``openai_service.needs_responses_api``. Rather than fork the large tool-dispatch
loops per API surface, both are funneled through :func:`stream_tool_completion`,
which yields a single normalized event schema:

    {"type": "content", "text": str}                    # incremental assistant text
    {"type": "tool_call", "id": str, "name": str, "arguments": str}  # one per complete call
    {"type": "usage", "prompt": int, "completion": int}
    {"type": "finish", "reason": "tool_calls" | "stop"}

Transient 429 / 5xx failures on the initial request are retried with backoff so a
momentary rate-limit doesn't surface as a hard error mid-review.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

from openai import APIError, AuthenticationError, BadRequestError

from services import openai_service

_MAX_ATTEMPTS = 4


def _tools_to_responses(tools: list[dict] | None) -> list[dict]:
    """Flatten Chat Completions tool schemas into the Responses API shape."""
    out: list[dict] = []
    for tool in tools or []:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if not fn:
            continue
        out.append(
            {
                "type": "function",
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
            }
        )
    return out


def _content_to_responses(content: Any, *, assistant: bool) -> list[dict]:
    """Convert a Chat Completions message ``content`` into Responses input parts."""
    text_type = "output_text" if assistant else "input_text"
    if isinstance(content, str):
        return [{"type": text_type, "text": content}]
    parts: list[dict] = []
    for part in content or []:
        if not isinstance(part, dict):
            continue
        kind = part.get("type")
        if kind == "text":
            parts.append({"type": text_type, "text": part.get("text", "")})
        elif kind == "image_url":
            img = part.get("image_url") or {}
            url = img.get("url", "") if isinstance(img, dict) else str(img)
            entry: dict[str, Any] = {"type": "input_image", "image_url": url}
            if isinstance(img, dict) and img.get("detail"):
                entry["detail"] = img["detail"]
            parts.append(entry)
    return parts


def chat_messages_to_responses(messages: list[dict]) -> tuple[str, list[dict]]:
    """Translate Chat Completions ``messages`` into ``(instructions, input)`` for
    the Responses API. System messages become the instructions string; assistant
    tool calls and tool results become ``function_call`` / ``function_call_output``
    items so multi-round tool loops carry over faithfully."""
    instructions: list[str] = []
    inp: list[dict] = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        if role == "system":
            if isinstance(content, str) and content:
                instructions.append(content)
            continue
        if role == "tool":
            inp.append(
                {
                    "type": "function_call_output",
                    "call_id": msg.get("tool_call_id", ""),
                    "output": content if isinstance(content, str) else "",
                }
            )
            continue
        if role == "assistant":
            if isinstance(content, str) and content:
                inp.append({"role": "assistant", "content": _content_to_responses(content, assistant=True)})
            for tc in msg.get("tool_calls") or []:
                fn = tc.get("function", {})
                inp.append(
                    {
                        "type": "function_call",
                        "call_id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "arguments": fn.get("arguments", "") or "",
                    }
                )
            continue
        # user (or any other) role
        inp.append({"role": role or "user", "content": _content_to_responses(content, assistant=False)})
    return "\n\n".join(instructions), inp


async def _open_stream(make_stream):
    """Create a streaming response, retrying transient 429/5xx with backoff.

    ``make_stream`` is an async callable returning the stream object. Yields
    ``("status", message)`` before each retry and finally ``("stream", obj)`` or
    ``("error", message)``.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            stream = await make_stream()
            yield ("stream", stream)
            return
        except (BadRequestError, AuthenticationError, APIError) as exc:
            delay = (
                openai_service.transient_retry_delay(exc, attempt)
                if attempt < _MAX_ATTEMPTS
                else None
            )
            if delay is None:
                from services.error_sanitizer import sanitize_openai_error

                yield ("error", sanitize_openai_error(exc))
                return
            yield ("status", "Service busy, retrying...")
            await asyncio.sleep(delay)


async def _stream_chat(
    client, deployment, messages, tools, tool_choice, max_tokens
) -> AsyncGenerator[dict, None]:
    kwargs: dict[str, Any] = {
        "model": deployment,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_completion_tokens": max_tokens,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice

    async for kind, payload in _open_stream(lambda: client.chat.completions.create(**kwargs)):
        if kind == "status":
            yield {"type": "status", "message": payload}
            continue
        if kind == "error":
            yield {"type": "error", "message": payload}
            return
        stream = payload
        break
    else:  # pragma: no cover - _open_stream always yields terminal event
        return

    tool_calls_raw: dict[int, dict] = {}
    finish_reason: str | None = None
    async for chunk in stream:
        if getattr(chunk, "usage", None) is not None:
            yield {
                "type": "usage",
                "prompt": chunk.usage.prompt_tokens or 0,
                "completion": chunk.usage.completion_tokens or 0,
            }
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        finish_reason = chunk.choices[0].finish_reason or finish_reason
        if delta.content:
            yield {"type": "content", "text": delta.content}
        for tc in delta.tool_calls or []:
            idx = tc.index
            slot = tool_calls_raw.setdefault(idx, {"id": "", "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function:
                if tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function.arguments:
                    slot["arguments"] += tc.function.arguments

    for slot in tool_calls_raw.values():
        yield {"type": "tool_call", "id": slot["id"], "name": slot["name"], "arguments": slot["arguments"]}
    yield {"type": "finish", "reason": "tool_calls" if tool_calls_raw else (finish_reason or "stop")}


async def _stream_responses(
    client, deployment, messages, tools, tool_choice, max_tokens
) -> AsyncGenerator[dict, None]:
    instructions, inp = chat_messages_to_responses(messages)
    kwargs: dict[str, Any] = {
        "model": deployment,
        "input": inp,
        "stream": True,
        "max_output_tokens": max_tokens,
    }
    if instructions:
        kwargs["instructions"] = instructions
    if tools:
        kwargs["tools"] = _tools_to_responses(tools)
        kwargs["tool_choice"] = tool_choice

    async for kind, payload in _open_stream(lambda: client.responses.create(**kwargs)):
        if kind == "status":
            yield {"type": "status", "message": payload}
            continue
        if kind == "error":
            yield {"type": "error", "message": payload}
            return
        stream = payload
        break
    else:  # pragma: no cover
        return

    # item_id -> {"call_id", "name", "arguments"} for streamed function calls.
    calls: dict[str, dict] = {}
    async for event in stream:
        etype = getattr(event, "type", "")
        if etype == "response.output_text.delta":
            text = getattr(event, "delta", "") or ""
            if text:
                yield {"type": "content", "text": text}
        elif etype == "response.output_item.added":
            item = getattr(event, "item", None)
            if item is not None and getattr(item, "type", "") == "function_call":
                calls[getattr(item, "id", "")] = {
                    "call_id": getattr(item, "call_id", "") or "",
                    "name": getattr(item, "name", "") or "",
                    "arguments": getattr(item, "arguments", "") or "",
                }
        elif etype == "response.function_call_arguments.delta":
            item_id = getattr(event, "item_id", "")
            slot = calls.setdefault(item_id, {"call_id": "", "name": "", "arguments": ""})
            slot["arguments"] += getattr(event, "delta", "") or ""
        elif etype == "response.function_call_arguments.done":
            item_id = getattr(event, "item_id", "")
            slot = calls.setdefault(item_id, {"call_id": "", "name": "", "arguments": ""})
            slot["arguments"] = getattr(event, "arguments", slot["arguments"]) or slot["arguments"]
            if getattr(event, "name", None):
                slot["name"] = event.name
        elif etype == "response.completed":
            usage = getattr(getattr(event, "response", None), "usage", None)
            if usage is not None:
                yield {
                    "type": "usage",
                    "prompt": getattr(usage, "input_tokens", 0) or 0,
                    "completion": getattr(usage, "output_tokens", 0) or 0,
                }

    for slot in calls.values():
        yield {
            "type": "tool_call",
            "id": slot["call_id"],
            "name": slot["name"],
            "arguments": slot["arguments"],
        }
    yield {"type": "finish", "reason": "tool_calls" if calls else "stop"}


async def stream_tool_completion(
    client,
    deployment: str,
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    tool_choice: str = "auto",
    max_tokens: int = 8000,
    use_responses: bool | None = None,
) -> AsyncGenerator[dict, None]:
    """Yield normalized streaming events from Chat Completions or the Responses API.

    When ``use_responses`` is ``None`` the surface is chosen from the deployment
    name via :func:`openai_service.needs_responses_api`. ``client`` must match the
    chosen surface (an async Responses-capable client for reasoning models, an
    async Chat Completions client otherwise).
    """
    if use_responses is None:
        use_responses = openai_service.needs_responses_api(deployment)
    if use_responses:
        gen = _stream_responses(client, deployment, messages, tools, tool_choice, max_tokens)
    else:
        gen = _stream_chat(client, deployment, messages, tools, tool_choice, max_tokens)
    async for event in gen:
        yield event
