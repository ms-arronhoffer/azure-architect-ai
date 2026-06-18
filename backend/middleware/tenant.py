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
"""
from __future__ import annotations

import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from db import engagement_id_var, tenant_id_var


def _tenant_from_request(request: Request) -> str:
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header or not header.lower().startswith("bearer "):
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


def _engagement_from_request(request: Request) -> str | None:
    value = request.headers.get("x-engagement-id") or request.headers.get("X-Engagement-Id")
    if not value:
        return None
    value = value.strip()
    return value or None


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        tenant_tok = tenant_id_var.set(_tenant_from_request(request))
        eng_tok = engagement_id_var.set(_engagement_from_request(request))
        try:
            return await call_next(request)
        finally:
            engagement_id_var.reset(eng_tok)
            tenant_id_var.reset(tenant_tok)
