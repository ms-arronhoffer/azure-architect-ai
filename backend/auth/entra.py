"""Entra ID (Microsoft identity platform) JWT bearer validation.

When settings.auth_enabled is true, protected routes require a valid access token
issued by the configured tenant for the configured audience (API app reg client id
or app-id URI).

Validation:
- Fetch tenant OpenID config and JWKS (cached, 1h TTL)
- Verify RS256 signature using the kid from the token header
- Verify iss matches v2 endpoint, aud matches configured audience, exp/nbf
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient

from config import settings

_JWKS_CACHE: dict[str, tuple[float, PyJWKClient]] = {}
_OIDC_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_TTL_SECONDS = 3600.0


class AuthError(HTTPException):
    def __init__(self, detail: str):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _require_config() -> tuple[str, str]:
    tenant = settings.entra_tenant_id
    audience = settings.entra_audience
    if not tenant or not audience:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Entra ID auth is enabled but tenant or audience is not configured.",
        )
    return tenant, audience


async def _get_oidc_config(tenant: str) -> dict[str, Any]:
    now = time.time()
    cached = _OIDC_CACHE.get(tenant)
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]
    url = f"https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    _OIDC_CACHE[tenant] = (now, data)
    return data


def _jwks_client(jwks_uri: str) -> PyJWKClient:
    now = time.time()
    cached = _JWKS_CACHE.get(jwks_uri)
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]
    client = PyJWKClient(jwks_uri, cache_keys=True)
    _JWKS_CACHE[jwks_uri] = (now, client)
    return client


async def validate_token(token: str) -> dict[str, Any]:
    tenant, audience = _require_config()
    oidc = await _get_oidc_config(tenant)
    jwks = _jwks_client(oidc["jwks_uri"])
    try:
        signing_key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=audience,
            issuer=oidc["issuer"],
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise AuthError("Token expired") from e
    except jwt.InvalidAudienceError as e:
        raise AuthError("Invalid audience") from e
    except jwt.InvalidIssuerError as e:
        raise AuthError("Invalid issuer") from e
    except jwt.PyJWTError as e:
        raise AuthError(f"Invalid token: {e}") from e
    return claims


def _extract_bearer(request: Request) -> str | None:
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header or not header.lower().startswith("bearer "):
        return None
    return header[7:].strip() or None


async def get_current_user(request: Request) -> dict[str, Any] | None:
    """Return claims when auth is enabled and the token is valid, else None.

    When auth is disabled this dependency is a no-op and returns None so callers
    can treat the request as the single 'default' user.
    """
    if not settings.auth_enabled:
        return None
    token = _extract_bearer(request)
    if not token:
        raise AuthError("Missing bearer token")
    return await validate_token(token)


async def require_user(claims: dict[str, Any] | None = Depends(get_current_user)) -> dict[str, Any]:
    if claims is None:
        # auth disabled — synthesize a default principal
        return {"sub": "default", "preferred_username": "default"}
    return claims


def user_id_from_claims(claims: dict[str, Any] | None) -> str:
    if not claims:
        return "default"
    # Prefer the immutable object id (oid) over sub for cross-app stability.
    return str(claims.get("oid") or claims.get("sub") or "default")
