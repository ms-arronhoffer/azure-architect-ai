"""Shared pytest fixtures.

Tests are hermetic: no Azure calls, in-memory SQLite, telemetry disabled.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio

# Ensure backend/ is on sys.path so `import config`, `import db`, etc. work
# when pytest is invoked from the repo root or backend/.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


@pytest.fixture(autouse=True)
def disable_telemetry(monkeypatch):
    """Make sure no test ever spins up Application Insights."""
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")


@pytest.fixture
def tmp_sqlite_db(monkeypatch):
    """Point DATABASE_URL at an in-memory aiosqlite DB and create tables.

    Returns the URL string so the caller can reference it. Tables are created
    via SQLAlchemy `Base.metadata.create_all` (alembic upgrade head is the
    moral equivalent; we use create_all so the fixture doesn't depend on the
    alembic CLI being installed in the test environment).
    """
    url = "sqlite+aiosqlite:///:memory:"
    monkeypatch.setenv("DATABASE_URL", url)

    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    # Late import so monkeypatched env is respected.
    import db as db_module

    engine = create_async_engine(url, future=True)

    async def _create():
        async with engine.begin() as conn:
            await conn.run_sync(db_module.Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_create()) if False else asyncio.new_event_loop().run_until_complete(_create())
    return url, engine


@pytest_asyncio.fixture
async def client():
    """httpx.AsyncClient bound to the FastAPI app with lifespan on."""
    import httpx

    # Import lazily so tests that don't need the app aren't penalized by
    # FastAPI startup imports (which pull Azure SDK clients).
    from main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# Mark every async def test as asyncio without requiring asyncio_mode="auto"
# in pyproject (which we are instructed not to touch).
def pytest_collection_modifyitems(config, items):
    for item in items:
        if "asyncio" in item.keywords:
            continue
        if item.get_closest_marker("asyncio"):
            continue
        # Best-effort: only add the marker for async coroutine tests.
        if hasattr(item, "function"):
            import inspect

            if inspect.iscoroutinefunction(item.function):
                item.add_marker(pytest.mark.asyncio)
