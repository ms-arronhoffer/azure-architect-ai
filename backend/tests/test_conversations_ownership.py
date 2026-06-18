"""Cross-user ownership checks on conversation routes.

Auth is disabled by default in tests. To exercise per-user logic we install
a FastAPI dependency override for `get_current_user` that reads the
`X-Test-User` header and synthesizes claims. `app.dependency_overrides` is
the only reliable way to substitute a `Depends(...)` target — patching the
module-level binding has no effect because FastAPI captured the original
callable at route-registration time.
"""
from __future__ import annotations

import time

import pytest
import pytest_asyncio
from fastapi import Request


def _claims_for_header(header_value: str | None) -> dict[str, str] | None:
    if not header_value:
        return None
    return {"oid": header_value, "sub": header_value}


@pytest_asyncio.fixture
async def auth_client():
    """Yield an httpx client whose `X-Test-User` header selects the principal."""
    import httpx

    from auth.entra import get_current_user
    from db import init_db
    from main import app

    async def fake_get_current_user(request: Request):
        return _claims_for_header(request.headers.get("X-Test-User"))

    app.dependency_overrides[get_current_user] = fake_get_current_user

    await init_db()
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _record(cid: str) -> dict:
    now = int(time.time() * 1000)
    return {
        "id": cid,
        "mode": "chat",
        "title": "x",
        "createdAt": now,
        "updatedAt": now,
        "messages": [],
        "structuredResult": None,
    }


@pytest.mark.asyncio
async def test_delete_other_users_conversation_returns_404(auth_client):
    cid = "own-delete-1"
    r = await auth_client.post("/api/conversations", json=_record(cid),
                                headers={"X-Test-User": "alice-oid"})
    assert r.status_code == 200, r.text

    r = await auth_client.delete(f"/api/conversations/{cid}",
                                  headers={"X-Test-User": "bob-oid"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_owner_can_delete_own_conversation(auth_client):
    cid = "own-delete-2"
    await auth_client.post("/api/conversations", json=_record(cid),
                            headers={"X-Test-User": "alice-oid"})
    r = await auth_client.delete(f"/api/conversations/{cid}",
                                  headers={"X-Test-User": "alice-oid"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_post_cannot_overwrite_other_users_conversation(auth_client):
    cid = "own-upsert-1"
    await auth_client.post("/api/conversations", json=_record(cid),
                            headers={"X-Test-User": "alice-oid"})
    # bob tries to overwrite by reusing alice's id
    payload = _record(cid)
    payload["title"] = "hijack"
    r = await auth_client.post("/api/conversations", json=payload,
                                headers={"X-Test-User": "bob-oid"})
    assert r.status_code == 404

    # alice's row is untouched
    r = await auth_client.get("/api/conversations",
                               headers={"X-Test-User": "alice-oid"})
    alice_rows = r.json()
    assert any(c["id"] == cid and c["title"] != "hijack" for c in alice_rows)


@pytest.mark.asyncio
async def test_list_conversations_scoped_per_user(auth_client):
    await auth_client.post("/api/conversations", json=_record("list-a"),
                            headers={"X-Test-User": "alice-oid"})
    await auth_client.post("/api/conversations", json=_record("list-b"),
                            headers={"X-Test-User": "bob-oid"})

    r = await auth_client.get("/api/conversations",
                               headers={"X-Test-User": "alice-oid"})
    ids = {c["id"] for c in r.json()}
    assert "list-a" in ids
    assert "list-b" not in ids


@pytest.mark.asyncio
async def test_clear_conversations_scoped_per_user(auth_client):
    await auth_client.post("/api/conversations", json=_record("clear-a"),
                            headers={"X-Test-User": "alice-oid"})
    await auth_client.post("/api/conversations", json=_record("clear-b"),
                            headers={"X-Test-User": "bob-oid"})

    r = await auth_client.delete("/api/conversations",
                                  headers={"X-Test-User": "alice-oid"})
    assert r.status_code == 200

    # alice's row gone, bob's still there
    r = await auth_client.get("/api/conversations",
                               headers={"X-Test-User": "bob-oid"})
    ids = {c["id"] for c in r.json()}
    assert "clear-b" in ids

    r = await auth_client.get("/api/conversations",
                               headers={"X-Test-User": "alice-oid"})
    ids = {c["id"] for c in r.json()}
    assert "clear-a" not in ids
