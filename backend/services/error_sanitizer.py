"""Sanitize Azure SDK / OpenAI error messages before returning them to clients.

Azure errors often embed subscription IDs, resource IDs, and internal paths.
This module strips those before the message reaches the browser.
"""

import re

# Patterns that reveal internal infrastructure details
_STRIP_PATTERNS = [
    # Azure subscription and resource IDs
    re.compile(r"/subscriptions/[0-9a-f-]{36}", re.IGNORECASE),
    re.compile(r"/resourceGroups/[^/\s'\"]+", re.IGNORECASE),
    re.compile(r"/providers/[^/\s'\"]+(?:/[^/\s'\"]+)*", re.IGNORECASE),
    # Azure correlation/request IDs in error bodies
    re.compile(r'"requestId"\s*:\s*"[^"]+"', re.IGNORECASE),
    re.compile(r'"correlationId"\s*:\s*"[^"]+"', re.IGNORECASE),
    # Fully-qualified Azure resource URIs
    re.compile(r"https://management\.azure\.com[^\s'\"]+", re.IGNORECASE),
    re.compile(r"https://[a-z0-9-]+\.openai\.azure\.com[^\s'\"]*", re.IGNORECASE),
]

_SAFE_OPENAI_ERRORS = {
    "content_filter": "The request was blocked by the content safety filter.",
    "context_length_exceeded": "The conversation is too long. Please start a new session.",
    "rate_limit_exceeded": "Rate limit reached. Please wait a moment and try again.",
    "insufficient_quota": "API quota exceeded. Please contact your administrator.",
    "model_not_found": "The requested model is not available.",
    "invalid_api_key": "Authentication failed. Please check your configuration.",
}


def sanitize_openai_error(exc: Exception) -> str:
    """Return a safe, human-readable message for an OpenAI/Azure SDK exception."""
    code = getattr(exc, "code", None) or ""
    raw = getattr(exc, "message", None) or str(exc)
    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
    details = f"{code} {raw}".lower()

    # Map well-known codes to friendly messages
    for key, msg in _SAFE_OPENAI_ERRORS.items():
        if key in details:
            return msg

    if status_code == 429 or "rate limit" in details or "too many requests" in details:
        return _SAFE_OPENAI_ERRORS["rate_limit_exceeded"]

    # Strip any internal identifiers
    sanitized = raw
    for pattern in _STRIP_PATTERNS:
        sanitized = pattern.sub("[redacted]", sanitized)

    # Truncate very long error messages (they usually contain the full raw response)
    if len(sanitized) > 200:
        sanitized = sanitized[:200] + "…"

    return sanitized or "An error occurred while calling the AI service."
