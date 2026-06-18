"""Structured JSON logging + per-request correlation IDs.

`RequestContextMiddleware` is implemented as pure ASGI (not `BaseHTTPMiddleware`)
because BaseHTTPMiddleware + `StreamingResponse` raises
`RuntimeError("No response returned.")` when a client disconnects mid-stream
(Starlette's internal anyio memory stream emits `EndOfStream` on disconnect).
The `/api/chat` SSE endpoint hit this exact failure mode.
"""
import logging
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Any

import structlog

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def _add_request_id(_, __, event_dict):
    event_dict["request_id"] = request_id_var.get()
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_request_id,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None):
    return structlog.get_logger(name) if name else structlog.get_logger()


def _header(headers: list[tuple[bytes, bytes]], name: bytes) -> str | None:
    for key, value in headers:
        if key.lower() == name:
            return value.decode("latin-1", errors="ignore")
    return None


class RequestContextMiddleware:
    """Assign a request ID, expose it on the response, and log request/response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers") or []
        rid = _header(headers, b"x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        log = get_logger("http")
        method = scope.get("method") or "GET"
        path = scope.get("path") or ""
        query = (scope.get("query_string") or b"").decode("latin-1", errors="ignore") or None
        start = time.perf_counter()
        log.info("request.start", method=method, path=path, query=query)

        status_holder = {"code": 500}
        rid_bytes = rid.encode("latin-1")

        async def wrapped_send(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                status_holder["code"] = int(message.get("status") or 500)
                resp_headers = list(message.get("headers") or [])
                resp_headers = [
                    (k, v) for (k, v) in resp_headers if k.lower() != b"x-request-id"
                ]
                resp_headers.append((b"x-request-id", rid_bytes))
                message = {**message, "headers": resp_headers}
            await send(message)

        try:
            await self.app(scope, receive, wrapped_send)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            log.exception(
                "request.error",
                method=method,
                path=path,
                duration_ms=duration_ms,
                error=str(exc),
            )
            request_id_var.reset(token)
            raise
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        log.info(
            "request.end",
            method=method,
            path=path,
            status=status_holder["code"],
            duration_ms=duration_ms,
        )
        request_id_var.reset(token)
