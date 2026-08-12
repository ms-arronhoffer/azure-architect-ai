from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from auth import entra


def _sidecar_client(
    monkeypatch: pytest.MonkeyPatch,
    handler,
) -> None:
    client_type = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        entra.httpx,
        "AsyncClient",
        lambda **kwargs: client_type(transport=transport, **kwargs),
    )


@pytest.fixture(autouse=True)
def _sidecar_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(entra.settings, "entra_tenant_id", "tenant-id")
    monkeypatch.setattr(entra.settings, "entra_audience", "api://api-client-id")
    monkeypatch.setattr(entra.settings, "entra_auth_sidecar_url", "http://127.0.0.1:5000/")


@pytest.mark.asyncio
async def test_validate_token_uses_entra_sidecar(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://127.0.0.1:5000/Validate"
        assert request.headers["Authorization"] == "******"
        return httpx.Response(200, json={"claims": {"oid": "user-id", "aud": "api-client-id"}})

    _sidecar_client(monkeypatch, handler)
    claims = await entra.validate_token("access-token")

    assert claims["oid"] == "user-id"


@pytest.mark.asyncio
async def test_validate_token_maps_sidecar_rejection_to_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sidecar_client(monkeypatch, lambda request: httpx.Response(401))

    with pytest.raises(entra.AuthError, match="Invalid token"):
        await entra.validate_token("bad-token")


@pytest.mark.asyncio
async def test_validate_token_fails_closed_on_invalid_sidecar_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sidecar_client(monkeypatch, lambda request: httpx.Response(200, json={"unexpected": True}))

    with pytest.raises(HTTPException) as exc_info:
        await entra.validate_token("access-token")

    assert exc_info.value.status_code == 503
