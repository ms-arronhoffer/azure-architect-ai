"""Azure OpenAI embeddings client. Shares auth pattern with chat client.

Keeps a separate AzureOpenAI instance so chat-specific config (deployment, retries)
doesn't tangle with embedding calls.
"""
from __future__ import annotations

from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

from config import settings
from middleware.logging import get_logger
from services.openai_service import call_with_retry

log = get_logger("embeddings_service")

_client: AzureOpenAI | None = None


def _get_client() -> AzureOpenAI:
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
            provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )
            _client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                azure_ad_token_provider=provider,
                api_version=settings.azure_openai_api_version,
            )
    return _client


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embed a list of strings. Returns parallel list of vectors."""
    if not texts:
        return []
    client = _get_client()
    deployment = settings.azure_openai_deployment_embedding
    resp = call_with_retry(lambda: client.embeddings.create(model=deployment, input=texts))
    return [d.embedding for d in resp.data]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]
