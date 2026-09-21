import random
import time

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncAzureOpenAI,
    AsyncOpenAI,
    AzureOpenAI,
    OpenAI,
    RateLimitError,
)

from config import settings
from middleware.logging import get_logger
from observability import openai_tokens_histogram, tracer

log = get_logger("openai_service")

# Responses API requires api-version >= 2025-03-01-preview on Azure OpenAI.
# Kept separate from the default api_version so legacy Chat Completions paths
# stay on whatever the env declares.
RESPONSES_API_VERSION = "2025-03-01-preview"

# Per-deployment routing. Maps deployment names whose endpoint / api-version
# differ from the global settings to their override values. Looked up by
# `_route_for(deployment)`; cache key for the client also includes endpoint
# and api-version so swapping models doesn't reuse the wrong client.
_MODEL_ROUTES: dict[str, dict[str, str | None]] = {
    "gpt-5.4-pro": {
        "endpoint": settings.azure_openai_endpoint_gpt54pro,
        "api_version": settings.azure_openai_api_version_gpt54pro,
        "key": settings.azure_openai_key_gpt54pro,
    },
}


def _route_for(deployment: str | None) -> dict[str, str | None] | None:
    if not deployment:
        return None
    return _MODEL_ROUTES.get(deployment)


def _route_endpoint(deployment: str | None) -> str:
    route = _route_for(deployment)
    return (route or {}).get("endpoint") or settings.azure_openai_endpoint  # type: ignore[return-value]


def _route_api_version(deployment: str | None, default: str) -> str:
    route = _route_for(deployment)
    return (route or {}).get("api_version") or default  # type: ignore[return-value]


def _route_key(deployment: str | None) -> str | None:
    route = _route_for(deployment)
    if route is None:
        return settings.azure_openai_key
    # An explicit per-route key overrides the global one. When the route has
    # no key, fall back to the global key so AAD-only setups keep working.
    return route.get("key") or settings.azure_openai_key


_client_cache: dict[tuple[str, str, str, bool], AzureOpenAI | AsyncAzureOpenAI] = {}


def _build_client(
    *, endpoint: str, api_version: str, key: str | None, is_async: bool
) -> AzureOpenAI | AsyncAzureOpenAI:
    cache_key = (endpoint, api_version, key or "", is_async)
    cached = _client_cache.get(cache_key)
    if cached is not None:
        return cached
    cls: type[AzureOpenAI] | type[AsyncAzureOpenAI] = (
        AsyncAzureOpenAI if is_async else AzureOpenAI
    )
    if key:
        client = cls(azure_endpoint=endpoint, api_key=key, api_version=api_version)
    else:
        credential = DefaultAzureCredential()
        token_provider = get_bearer_token_provider(
            credential, "https://cognitiveservices.azure.com/.default"
        )
        client = cls(
            azure_endpoint=endpoint,
            azure_ad_token_provider=token_provider,
            api_version=api_version,
        )
    _client_cache[cache_key] = client
    return client

TOOL_INCOMPATIBLE_MODELS = {
    "llama-3.1-70b-instruct",
    "mistral-large",
    "phi-3.5-mini-instruct",
}

_RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}


def call_with_retry(fn, *, max_attempts: int = 4, base_delay: float = 0.5, max_delay: float = 8.0, model_name: str = "", mode: str = "system"):
    """Run an OpenAI SDK call with exponential backoff + jitter on transient errors.

    Honors a Retry-After header when the SDK exposes it. Re-raises on non-retryable
    errors or after attempts are exhausted. When the SDK response carries a
    `usage` block, the token counts are recorded against the current request user
    (see `token_service.record_llm_usage`) so usage from non-chat call sites is
    captured in the metrics dashboard.
    """
    with tracer.start_as_current_span(
        "openai.chat_completion",
        attributes={
            "gen_ai.system": "azure_openai",
            "gen_ai.request.model": model_name,
        },
    ) as span:
        attempt = 0
        while True:
            attempt += 1
            try:
                result = fn()
                usage = getattr(result, "usage", None)
                total = getattr(usage, "total_tokens", None) if usage is not None else None
                if total is not None:
                    try:
                        openai_tokens_histogram.record(int(total), {"model": model_name})
                        span.set_attribute("gen_ai.usage.total_tokens", int(total))
                    except Exception:
                        pass
                if usage is not None:
                    try:
                        from services.token_service import record_llm_usage
                        # Chat Completions exposes prompt/completion_tokens;
                        # the Responses API uses input/output_tokens.
                        prompt = int(
                            getattr(usage, "prompt_tokens", None)
                            or getattr(usage, "input_tokens", 0)
                            or 0
                        )
                        completion = int(
                            getattr(usage, "completion_tokens", None)
                            or getattr(usage, "output_tokens", 0)
                            or 0
                        )
                        record_llm_usage(model_name, mode, prompt, completion)
                    except Exception:
                        pass
                return result
            except RateLimitError as exc:
                retry_after = _retry_after_seconds(exc)
                if attempt >= max_attempts:
                    log.error("openai.retry_exhausted", attempts=attempt, error=str(exc))
                    raise
                delay = retry_after if retry_after is not None else _backoff(attempt, base_delay, max_delay)
                log.warning("openai.rate_limited", attempt=attempt, delay_s=delay)
                time.sleep(delay)
            except APIStatusError as exc:
                if exc.status_code not in _RETRYABLE_STATUSES or attempt >= max_attempts:
                    raise
                delay = _backoff(attempt, base_delay, max_delay)
                log.warning("openai.api_status_retry", attempt=attempt, status=exc.status_code, delay_s=delay)
                time.sleep(delay)
            except APIConnectionError as exc:
                if attempt >= max_attempts:
                    raise
                delay = _backoff(attempt, base_delay, max_delay)
                log.warning("openai.connection_retry", attempt=attempt, delay_s=delay, error=str(exc))
                time.sleep(delay)


def _backoff(attempt: int, base: float, cap: float) -> float:
    return min(cap, base * (2 ** (attempt - 1))) + random.uniform(0, 0.25)


def _retry_after_seconds(exc: Exception) -> float | None:
    resp = getattr(exc, "response", None)
    if resp is None:
        return None
    val = resp.headers.get("retry-after") if hasattr(resp, "headers") else None
    try:
        return float(val) if val else None
    except (TypeError, ValueError):
        return None


def transient_retry_delay(
    exc: Exception,
    attempt: int,
    *,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
) -> float | None:
    """Return seconds to wait before retrying a transient OpenAI error.

    Returns ``None`` when the error is not transient (e.g. 400/401) and should be
    surfaced to the caller immediately. Used by the streaming Chat Completions call
    sites, which don't route through :func:`call_with_retry` and would otherwise
    surface a single momentary 429 as a hard "rate limit" failure.
    """
    if isinstance(exc, RateLimitError):
        retry_after = _retry_after_seconds(exc)
        return retry_after if retry_after is not None else _backoff(attempt, base_delay, max_delay)
    if isinstance(exc, APIStatusError):
        if exc.status_code in _RETRYABLE_STATUSES:
            return _backoff(attempt, base_delay, max_delay)
        return None
    if isinstance(exc, APIConnectionError):
        return _backoff(attempt, base_delay, max_delay)
    return None


def get_client(deployment: str | None = None) -> AzureOpenAI:
    endpoint = _route_endpoint(deployment)
    api_version = _route_api_version(deployment, settings.azure_openai_api_version)
    key = _route_key(deployment)
    return _build_client(endpoint=endpoint, api_version=api_version, key=key, is_async=False)  # type: ignore[return-value]


def get_responses_client(deployment: str | None = None) -> AzureOpenAI:
    """Dedicated Azure OpenAI client pinned to an api-version that supports
    the Responses API. Required for codex / gpt-5 / o-series deployments,
    which reject Chat Completions outright. When `deployment` matches a
    per-deployment route, that route's endpoint/api-version/key wins."""
    endpoint = _route_endpoint(deployment)
    api_version = _route_api_version(deployment, RESPONSES_API_VERSION)
    key = _route_key(deployment)
    return _build_client(endpoint=endpoint, api_version=api_version, key=key, is_async=False)  # type: ignore[return-value]


def get_async_client(deployment: str | None = None) -> AsyncAzureOpenAI:
    """Async sibling of `get_client()`. Use for streaming endpoints — sync
    iteration over a streaming response blocks the event loop, which causes
    uvicorn's ASGI cancel scope to terminate the request mid-stream and the
    client sees a 200 with an empty body.
    """
    endpoint = _route_endpoint(deployment)
    api_version = _route_api_version(deployment, settings.azure_openai_api_version)
    key = _route_key(deployment)
    return _build_client(endpoint=endpoint, api_version=api_version, key=key, is_async=True)  # type: ignore[return-value]


def get_async_responses_client(deployment: str | None = None) -> AsyncAzureOpenAI:
    """Async client pinned to a Responses-API-capable api-version. Async sibling
    of `get_responses_client()`; required for codex / gpt-5 / o-series
    deployments, which reject Chat Completions outright."""
    endpoint = _route_endpoint(deployment)
    api_version = _route_api_version(deployment, RESPONSES_API_VERSION)
    key = _route_key(deployment)
    return _build_client(endpoint=endpoint, api_version=api_version, key=key, is_async=True)  # type: ignore[return-value]


def needs_responses_api(deployment: str | None) -> bool:
    """Detect codex / gpt-5 / o-series deployments. These reject Chat Completions
    entirely and must be called via the Responses API instead."""
    d = (deployment or "").lower()
    return (
        d.startswith("gpt-5")
        or "codex" in d
        or d.startswith("o1")
        or d.startswith("o3")
        or d.startswith("o4")
    )


class _ShimFunction:
    def __init__(self, name: str, arguments: str) -> None:
        self.name = name
        self.arguments = arguments


class _ShimToolCall:
    def __init__(self, call_id: str, name: str, arguments: str) -> None:
        self.id = call_id
        self.type = "function"
        self.function = _ShimFunction(name, arguments)


class _ShimMessage:
    def __init__(self, content: str, tool_calls: list[_ShimToolCall] | None) -> None:
        self.role = "assistant"
        self.content = content
        self.tool_calls = tool_calls or None


class _ShimChoice:
    def __init__(self, message: _ShimMessage, finish_reason: str) -> None:
        self.index = 0
        self.message = message
        self.finish_reason = finish_reason


class _ShimCompletion:
    """Chat-Completions-shaped view over a Responses API result."""

    def __init__(self, model: str, choices: list[_ShimChoice], usage) -> None:
        self.model = model
        self.choices = choices
        self.usage = usage


def _tool_choice_to_responses(tool_choice):
    """Translate a Chat Completions ``tool_choice`` into the Responses shape."""
    if isinstance(tool_choice, dict):
        fn = tool_choice.get("function") or {}
        name = fn.get("name") or tool_choice.get("name")
        if name:
            return {"type": "function", "name": name}
        return "auto"
    return tool_choice or "auto"


def _responses_to_completion(resp, model: str) -> _ShimCompletion:
    text = (getattr(resp, "output_text", None) or "").strip()
    tool_calls: list[_ShimToolCall] = []
    for item in getattr(resp, "output", None) or []:
        if getattr(item, "type", "") != "function_call":
            continue
        tool_calls.append(
            _ShimToolCall(
                getattr(item, "call_id", "") or getattr(item, "id", "") or "",
                getattr(item, "name", "") or "",
                getattr(item, "arguments", "") or "",
            )
        )
    if not text:
        chunks: list[str] = []
        for item in getattr(resp, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                piece = getattr(part, "text", None)
                if piece:
                    chunks.append(piece)
        text = "".join(chunks).strip()
    message = _ShimMessage(text, tool_calls)
    finish = "tool_calls" if tool_calls else "stop"
    return _ShimCompletion(model, [_ShimChoice(message, finish)], getattr(resp, "usage", None))


def chat_completion(
    client,
    *,
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice=None,
    response_format: dict | None = None,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
    reasoning_effort: str = "medium",
):
    """Non-streaming completion that works on both Azure API surfaces.

    Reasoning deployments (gpt-5 / codex / o-series) reject Chat Completions, so
    they are transparently routed through the Responses API and the result is
    wrapped in a Chat-Completions-shaped object — callers keep reading
    ``resp.choices[0].message.content`` / ``.tool_calls`` regardless of surface.
    ``temperature`` is dropped for reasoning deployments, which reject it.
    """
    if not needs_responses_api(model):
        kwargs: dict = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
        if response_format is not None:
            kwargs["response_format"] = response_format
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_completion_tokens is not None:
            kwargs["max_completion_tokens"] = max_completion_tokens
        return client.chat.completions.create(**kwargs)

    from services.streaming_llm import chat_messages_to_responses, tools_to_responses

    rclient = get_responses_client(model)
    instructions, inp = chat_messages_to_responses(messages)
    kwargs = {"model": model, "input": inp, "reasoning": {"effort": reasoning_effort}}
    if instructions:
        kwargs["instructions"] = instructions
    if tools:
        kwargs["tools"] = tools_to_responses(tools)
        kwargs["tool_choice"] = _tool_choice_to_responses(tool_choice)
    if response_format is not None:
        kwargs["text"] = {"format": response_format}
    if max_completion_tokens is not None:
        # Reasoning tokens are billed against the output budget before any
        # visible text is produced, so give the model headroom to finish.
        kwargs["max_output_tokens"] = max(max_completion_tokens * 4, 16_000)
    return _responses_to_completion(rclient.responses.create(**kwargs), model)


def get_deployment(mode: str) -> str:
    if mode == "review":
        return settings.azure_openai_deployment_eval
    if mode in ("architecture", "waf"):
        return settings.azure_openai_deployment_arch
    if mode == "demo-build":
        return settings.azure_openai_deployment_demo_build
    if mode == "pricing":
        return settings.azure_openai_deployment_pricing
    return settings.azure_openai_deployment_chat


def resolve_client_and_model(
    mode: str,
    provider: str = "azure",
    model: str = "",
    github_token: str = "",
) -> tuple[AzureOpenAI | OpenAI, str]:
    """Return (client, model_string) for the given provider/model combo."""
    if provider == "azure" or not provider:
        deployment = model or get_deployment(mode)
        return get_client(deployment), deployment

    if not github_token:
        raise ValueError("GitHub token not configured. Add your token in Settings.")

    base_url = (
        "https://api.githubcopilot.com"
        if provider == "github-copilot"
        else "https://models.inference.ai.azure.com"
    )
    client = OpenAI(api_key=github_token, base_url=base_url)
    model_str = model or "gpt-4o"
    return client, model_str


def resolve_async_client_and_model(
    mode: str,
    provider: str = "azure",
    model: str = "",
    github_token: str = "",
) -> tuple[AsyncAzureOpenAI | AsyncOpenAI, str]:
    """Async sibling of `resolve_client_and_model`. Used by streaming routes."""
    if provider == "azure" or not provider:
        deployment = model or get_deployment(mode)
        return get_async_client(deployment), deployment

    if not github_token:
        raise ValueError("GitHub token not configured. Add your token in Settings.")

    base_url = (
        "https://api.githubcopilot.com"
        if provider == "github-copilot"
        else "https://models.inference.ai.azure.com"
    )
    client = AsyncOpenAI(api_key=github_token, base_url=base_url)
    model_str = model or "gpt-4o"
    return client, model_str


def resolve_streaming_client(
    mode: str,
    provider: str = "azure",
    model: str = "",
    github_token: str = "",
) -> tuple[AsyncAzureOpenAI | AsyncOpenAI, str, bool]:
    """Return ``(client, deployment, use_responses)`` for a streaming tool loop.

    Reasoning deployments (gpt-5 / codex / o-series) on Azure reject Chat
    Completions and must stream via the Responses API, so this hands back a
    Responses-capable async client and ``use_responses=True`` for those. GitHub
    providers and gpt-4-family Azure deployments get the Chat Completions client.
    """
    if provider == "azure" or not provider:
        deployment = model or get_deployment(mode)
        if needs_responses_api(deployment):
            return get_async_responses_client(deployment), deployment, True
        return get_async_client(deployment), deployment, False

    client, deployment = resolve_async_client_and_model(mode, provider, model, github_token)
    return client, deployment, False

