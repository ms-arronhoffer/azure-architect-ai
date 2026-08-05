"""The app must be serving requests before the MCP servers are ready.

uvicorn binds its listening socket only after lifespan startup returns, so
anything slow awaited there keeps a freshly rolled-out container unreachable.
Container Apps then fails the revision's health probes and keeps the previous
revision in service, which shows up as 404s on newly added API routes.
"""
from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_health_serves_while_mcp_is_still_initializing(monkeypatch):
    import httpx

    import main

    entered = asyncio.Event()
    release = asyncio.Event()

    async def _slow_init_mcp(stack):
        entered.set()
        await release.wait()

    monkeypatch.setattr(main, "init_mcp", _slow_init_mcp)
    monkeypatch.setattr(main.settings, "mcp_enabled", True)
    monkeypatch.setattr(main.settings, "rag_enabled", False)

    async def _noop_announcements(force_refresh: bool = False):
        return []

    async def _noop_lifecycle(force_refresh: bool = False):
        return {"models": [], "count": 0}

    from services import model_lifecycle_service, whats_new_service

    monkeypatch.setattr(whats_new_service, "fetch_announcements", _noop_announcements)
    monkeypatch.setattr(model_lifecycle_service, "fetch_lifecycle", _noop_lifecycle)

    # A regression (awaiting MCP init inline) would hang here instead of failing.
    async with asyncio.timeout(30):
        async with main.app.router.lifespan_context(main.app):
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/health")
            assert resp.status_code == 200
            await asyncio.wait_for(entered.wait(), timeout=5)
            assert not release.is_set()
            release.set()
