"""Structured JSON logging + per-request correlation IDs."""
import logging
import sys
import time
import uuid
from contextvars import ContextVar

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

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


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign a request ID, expose it on the response, and log request/response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        log = get_logger("http")
        start = time.perf_counter()
        log.info(
            "request.start",
            method=request.method,
            path=request.url.path,
            query=request.url.query or None,
        )
        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            log.exception(
                "request.error",
                method=request.method,
                path=request.url.path,
                duration_ms=duration_ms,
                error=str(exc),
            )
            request_id_var.reset(token)
            raise
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["x-request-id"] = rid
        log.info(
            "request.end",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        request_id_var.reset(token)
        return response
