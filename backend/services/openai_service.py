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

_client: AzureOpenAI | None = None
_async_client: AsyncAzureOpenAI | None = None
_responses_client: AzureOpenAI | None = None

# Responses API requires api-version >= 2025-03-01-preview on Azure OpenAI.
# Kept separate from the default api_version so legacy Chat Completions paths
# stay on whatever the env declares.
RESPONSES_API_VERSION = "2025-03-01-preview"

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


def get_client() -> AzureOpenAI:
    global _client
    if _client is None:
        if settings.azure_openai_key:
            _client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_key,
                api_version=settings.azure_openai_api_version,
            )
        else:
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )
            _client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                azure_ad_token_provider=token_provider,
                api_version=settings.azure_openai_api_version,
            )
    return _client


def get_responses_client() -> AzureOpenAI:
    """Dedicated Azure OpenAI client pinned to an api-version that supports
    the Responses API. Required for codex / gpt-5 / o-series deployments,
    which reject Chat Completions outright."""
    global _responses_client
    if _responses_client is None:
        if settings.azure_openai_key:
            _responses_client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_key,
                api_version=RESPONSES_API_VERSION,
            )
        else:
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )
            _responses_client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                azure_ad_token_provider=token_provider,
                api_version=RESPONSES_API_VERSION,
            )
    return _responses_client


def get_async_client() -> AsyncAzureOpenAI:
    """Async sibling of `get_client()`. Use for streaming endpoints — sync
    iteration over a streaming response blocks the event loop, which causes
    uvicorn's ASGI cancel scope to terminate the request mid-stream and the
    client sees a 200 with an empty body.
    """
    global _async_client
    if _async_client is None:
        if settings.azure_openai_key:
            _async_client = AsyncAzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_key,
                api_version=settings.azure_openai_api_version,
            )
        else:
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )
            _async_client = AsyncAzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                azure_ad_token_provider=token_provider,
                api_version=settings.azure_openai_api_version,
            )
    return _async_client


def get_deployment(mode: str) -> str:
    if mode in ("architecture", "waf"):
        return settings.azure_openai_deployment_arch
    if mode == "demo-build":
        return settings.azure_openai_deployment_demo_build
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
        return get_client(), deployment

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
        return get_async_client(), deployment

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

