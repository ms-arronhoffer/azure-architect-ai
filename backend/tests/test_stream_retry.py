"""Streaming Chat Completions must retry transient 429/5xx before surfacing an error.

The streaming architecture/chat routes call ``client.chat.completions.create``
directly (not via ``openai_service.call_with_retry``), so a single momentary
rate-limit response used to surface immediately as a hard "Rate limit reached"
error. ``transient_retry_delay`` classifies which SDK errors are worth retrying.
"""
from __future__ import annotations

import os
from unittest.mock import MagicMock

# Ensure config can instantiate before importing the service under test.
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_KEY", "test-key")

from openai import (
    APIConnectionError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)

from services.error_sanitizer import sanitize_openai_error
from services.openai_service import transient_retry_delay


def _rate_limit_error(retry_after: str | None) -> RateLimitError:
    resp = MagicMock()
    resp.headers = {"retry-after": retry_after} if retry_after is not None else {}
    return RateLimitError("rate limited", response=resp, body=None)


def test_rate_limit_honors_retry_after_header():
    assert transient_retry_delay(_rate_limit_error("2"), 1) == 2.0


def test_rate_limit_falls_back_to_backoff():
    delay = transient_retry_delay(_rate_limit_error(None), 1)
    assert delay is not None
    # base_delay=0.5 with up to 0.25 jitter on the first attempt.
    assert 0.5 <= delay <= 0.76


def test_backoff_grows_with_attempt():
    first = transient_retry_delay(_rate_limit_error(None), 1)
    later = transient_retry_delay(_rate_limit_error(None), 3)
    assert later > first


def test_connection_error_is_retryable():
    exc = APIConnectionError(request=MagicMock())
    assert transient_retry_delay(exc, 1) is not None


def test_bad_request_is_not_retryable():
    exc = BadRequestError("bad", response=MagicMock(status_code=400), body=None)
    assert transient_retry_delay(exc, 1) is None


def test_auth_error_is_not_retryable():
    exc = AuthenticationError("unauthorized", response=MagicMock(status_code=401), body=None)
    assert transient_retry_delay(exc, 1) is None


def test_generic_rate_limit_message_is_sanitized():
    exc = Exception(
        "Your requests to gpt-5.6-sol in centralus have exceeded rate limit."
    )
    assert sanitize_openai_error(exc) == (
        "Rate limit reached. Please wait a moment and try again."
    )


def test_insufficient_quota_message_takes_precedence_over_http_429():
    exc = Exception("quota unavailable")
    exc.status_code = 429
    exc.code = "insufficient_quota"
    assert sanitize_openai_error(exc) == (
        "API quota exceeded. Please contact your administrator."
    )
