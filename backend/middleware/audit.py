"""Audit middleware: scans inbound JSON write requests for secrets and records
an append-only audit event per API call.

Behavior is governed by two flags in `config.settings`:

- `audit_log_enabled`: gates the entire middleware (registered/skipped at app
  build time).
- `audit_redaction_shadow_mode`: when True (default), secret hits are LOGGED
  but the request body is not mutated. When False, matched spans are replaced
  with `[REDACTED:<kind>]` before downstream handlers see them.

Implemented as a pure ASGI middleware (not BaseHTTPMiddleware) because we
need to swap the inbound `receive` callable so the downstream handler's
freshly-constructed `Request` object reads the (possibly redacted) body.
BaseHTTPMiddleware's two-Request-objects model makes body replacement
unreliable.

Only requests under `/api/*` with method in {POST, PUT, PATCH, DELETE} and a
JSON content-type are scanned for secrets; the audit row is still written
for all requests under `/api/*`.
"""
from __future__ import annotations

import contextlib
import time
from typing import Any

import jwt

from config import settings
from middleware.logging import get_logger, request_id_var
from services.audit_service import redact, scan_for_secrets, schedule_audit

_MAX_BODY_BYTES = 1_000_000  # 1 MB scan cap; oversize bodies still pass through
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _user_id_from_scope(scope: dict[str, Any]) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == b"authorization":
            header = value.decode("latin-1", errors="ignore")
            if header.lower().startswith("bearer "):
                token = header[7:].strip()
                try:
                    claims = jwt.decode(
                        token,
                        options={
                            "verify_signature": False,
                            "verify_aud": False,
                            "verify_exp": False,
                        },
                    )
                    return str(claims.get("oid") or claims.get("sub") or "anonymous")
                except Exception:
                    return "anonymous"
    return "anonymous"


def _client_ip_from_scope(scope: dict[str, Any]) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() == b"x-forwarded-for":
            return value.decode("latin-1", errors="ignore").split(",")[0].strip()
    client = scope.get("client")
    return client[0] if client else None


def _content_type_from_scope(scope: dict[str, Any]) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == b"content-type":
            return value.decode("latin-1", errors="ignore").lower()
    return ""


def _should_scan(scope: dict[str, Any]) -> bool:
    if scope.get("method") not in _WRITE_METHODS:
        return False
    if not (scope.get("path") or "").startswith("/api/"):
        return False
    ctype = _content_type_from_scope(scope)
    return "json" in ctype or "x-www-form-urlencoded" in ctype


class AuditMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path") or ""
        # Skip overhead for non-/api/* paths entirely (static files, /docs, etc.)
        if not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        # Buffer the request body so we can scan it and re-emit it downstream.
        body = b""
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                # http.disconnect mid-read — pass it through and bail.
                async def disconnected_receive(_msg: dict[str, Any] = message) -> dict[str, Any]:
                    return _msg
                await self.app(scope, disconnected_receive, send)
                return
            body += message.get("body") or b""
            more_body = message.get("more_body", False)

        secret_hits: list[str] = []
        new_body = body
        if _should_scan(scope) and 0 < len(body) <= _MAX_BODY_BYTES:
            secret_hits = scan_for_secrets(body)
            if secret_hits and not settings.audit_redaction_shadow_mode:
                new_body = redact(body)
        elif len(body) > _MAX_BODY_BYTES:
            get_logger("audit").warning(
                "audit.body_oversize", path=path, bytes=len(body),
            )

        sent = False

        async def wrapped_receive() -> dict[str, Any]:
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": new_body, "more_body": False}

        status_holder = {"code": 500}

        async def wrapped_send(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                status_holder["code"] = int(message.get("status") or 500)
            await send(message)

        start = time.perf_counter()
        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            if secret_hits:
                get_logger("audit").info(
                    "audit.secret_hit",
                    path=path,
                    method=scope.get("method"),
                    kinds=secret_hits,
                    shadow=settings.audit_redaction_shadow_mode,
                )
            with contextlib.suppress(Exception):
                schedule_audit(
                    user_id=_user_id_from_scope(scope),
                    request_id=request_id_var.get(),
                    method=scope.get("method") or "GET",
                    path=path,
                    status_code=status_holder["code"],
                    duration_ms=duration_ms,
                    secret_hit_kinds=secret_hits,
                    client_ip=_client_ip_from_scope(scope),
                )
