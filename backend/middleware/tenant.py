"""Populates `db.tenant_id_var` (from JWT `tid`) and `db.engagement_id_var`
(from the `X-Engagement-Id` request header) for the duration of the request.

Runs *inside* `RequestContextMiddleware` (so request-scoped logging is set
up) but *outside* the route handler, so all SQLAlchemy ORM operations in
routes and SSE generators automatically scope to the caller's tenant via
the `do_orm_execute` listener in `db.py`, and cost/scan helpers can read
the active engagement without re-plumbing the request object.

Signature verification is NOT performed here — the actual auth check still
runs in `Depends(require_user)`. A forged token with a fake `tid` gets 401
before any data is returned. The ContextVars just act as query-scope keys.

Implemented as pure ASGI middleware (not BaseHTTPMiddleware) because
BaseHTTPMiddleware + StreamingResponse raises "No response returned."
when a client disconnects mid-stream (Starlette uses an internal anyio
memory stream that emits EndOfStream on disconnect). The /api/chat SSE
endpoint hit this exact failure mode.
"""
from __future__ import annotations

from typing import Any

import jwt

from db import engagement_id_var, tenant_id_var


def _tenant_from_headers(headers: list[tuple[bytes, bytes]]) -> str:
    for key, value in headers:
        if key.lower() == b"authorization":
            header = value.decode("latin-1", errors="ignore")
            if not header.lower().startswith("bearer "):
                return "default"
            token = header[7:].strip()
            try:
                claims = jwt.decode(
                    token,
                    options={"verify_signature": False, "verify_aud": False, "verify_exp": False},
                )
            except Exception:
                return "default"
            return str(claims.get("tid") or "default")
    return "default"


def _engagement_from_headers(headers: list[tuple[bytes, bytes]]) -> str | None:
    for key, value in headers:
        if key.lower() == b"x-engagement-id":
            decoded = value.decode("latin-1", errors="ignore").strip()
            return decoded or None
    return None


class TenantContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers") or []
        tenant_tok = tenant_id_var.set(_tenant_from_headers(headers))
        eng_tok = engagement_id_var.set(_engagement_from_headers(headers))
        try:
            await self.app(scope, receive, send)
        finally:
            engagement_id_var.reset(eng_tok)
            tenant_id_var.reset(tenant_tok)
