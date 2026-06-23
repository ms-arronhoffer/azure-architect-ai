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


def call_with_retry(fn, *, max_attempts: int = 4, base_delay: float = 0.5, max_delay: float = 8.0, model_name: str = ""):
    """Run an OpenAI SDK call with exponential backoff + jitter on transient errors.

    Honors a Retry-After header when the SDK exposes it. Re-raises on non-retryable
    errors or after attempts are exhausted.
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


def get_deployment(mode: str) -> str:
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

