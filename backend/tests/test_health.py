"""Smoke test for the FastAPI health endpoint.

`/api/modes` does not currently exist in `backend/routes/`, so that case is
skipped per spec instructions.
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("status") == "ok"


@pytest.mark.skip(reason="No /api/modes endpoint in backend/routes/")
async def test_modes(client):
    resp = await client.get("/api/modes")
    assert resp.status_code == 200
