"""Audit middleware integration: shadow mode logs hits, doesn't mutate body."""
from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def client_with_db():
    from db import init_db
    await init_db()

    import httpx
    from main import app
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _drain_audit_tasks():
    """Audit inserts are fire-and-forget tasks — yield until they settle."""
    await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_audit_middleware_records_event(client_with_db):
    from db import AuditEvent, session_scope, select

    await client_with_db.post("/api/conversations", json={
        "id": "audit-rec-1", "mode": "chat", "title": "x",
        "createdAt": 1, "updatedAt": 1, "messages": [], "structuredResult": None,
    })
    await _drain_audit_tasks()

    async with session_scope() as s:
        rows = (await s.execute(
            select(AuditEvent)
            .where(AuditEvent.path == "/api/conversations")
            .execution_options(skip_tenant_filter=True)
        )).scalars().all()
    assert any(r.method == "POST" for r in rows)


@pytest.mark.asyncio
async def test_audit_middleware_detects_secret_in_body(client_with_db):
    from db import AuditEvent, session_scope, select

    leaky_token = "ghp_" + "a" * 36
    await client_with_db.post("/api/conversations", json={
        "id": "audit-hit-1", "mode": "chat",
        "title": f"please review token {leaky_token}",
        "createdAt": 1, "updatedAt": 1, "messages": [], "structuredResult": None,
    })
    await _drain_audit_tasks()

    async with session_scope() as s:
        rows = (await s.execute(
            select(AuditEvent)
            .where(AuditEvent.path == "/api/conversations")
            .execution_options(skip_tenant_filter=True)
        )).scalars().all()
    assert any("github_pat" in (r.secret_hit_kinds or []) for r in rows)


@pytest.mark.asyncio
async def test_audit_shadow_mode_preserves_body(client_with_db, monkeypatch):
    """In shadow mode (default), the title with the secret should be persisted
    UNREDACTED — proving the body wasn't mutated before the handler ran."""
    from config import settings
    monkeypatch.setattr(settings, "audit_redaction_shadow_mode", True)

    leaky_token = "ghp_" + "b" * 36
    title = f"prompt about {leaky_token}"
    await client_with_db.post("/api/conversations", json={
        "id": "audit-shadow-1", "mode": "chat", "title": title,
        "createdAt": 1, "updatedAt": 1, "messages": [], "structuredResult": None,
    })
    r = await client_with_db.get("/api/conversations")
    rows = r.json()
    assert any(c["id"] == "audit-shadow-1" and leaky_token in c["title"] for c in rows)
