"""Shared SlowAPI rate limiter — keyed per authenticated user (falls back to IP)."""

from __future__ import annotations

import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _user_or_ip_key(request: Request) -> str:
    """Bucket by Entra claims (oid/sub) when a bearer token is present.

    The token signature is NOT verified here — the route's `require_user`
    dependency still does that. The unverified claim is only used as a
    stable bucket id; forged tokens are rejected before any handler runs.
    """
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if header and header.lower().startswith("bearer "):
        token = header[7:].strip()
        try:
            claims = jwt.decode(token, options={"verify_signature": False, "verify_aud": False, "verify_exp": False})
            key = claims.get("oid") or claims.get("sub")
            if key:
                return f"user:{key}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=_user_or_ip_key, default_limits=["200/minute"])
