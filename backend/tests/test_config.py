"""Tests for the runtime client-config endpoint.

The `/api/config` endpoint lets the SPA read feature flags at runtime so they
can be flipped without a frontend rebuild.
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_config_unified_default(client, monkeypatch):
    """Unset UNIFIED_AGENTS resolves to the legacy surface (opt-in default)."""
    monkeypatch.delenv("UNIFIED_AGENTS", raising=False)
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json() == {"unified_agents": False}


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["false", "0", "no", "off", "OFF", " False ", "anything"])
async def test_config_unified_opt_out(client, monkeypatch, value):
    monkeypatch.setenv("UNIFIED_AGENTS", value)
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json() == {"unified_agents": False}


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["true", "1", "yes", "on", "TRUE", " On "])
async def test_config_unified_opt_in(client, monkeypatch, value):
    monkeypatch.setenv("UNIFIED_AGENTS", value)
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json() == {"unified_agents": True}
