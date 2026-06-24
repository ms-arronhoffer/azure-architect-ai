"""Unit tests for the APScheduler integration in `services.scheduler`.

Confirms that:
- `start_scheduler()` is a no-op when `INGEST_ENABLED` is false (default).
- When enabled, the weekly ingest job is registered with the expected
  cron schedule (Sun 04:17) and id.
- `shutdown_scheduler()` clears the module-level singleton so the next
  `start_scheduler()` call rebuilds the scheduler cleanly.
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from config import settings
from services import scheduler as scheduler_module


@pytest_asyncio.fixture(autouse=True)
async def _reset_scheduler():
    """Ensure each test starts and ends with no active scheduler."""
    scheduler_module._scheduler = None
    yield
    await scheduler_module.shutdown_scheduler()


@pytest.mark.asyncio
async def test_start_scheduler_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", False)
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is None


@pytest.mark.asyncio
async def test_start_scheduler_registers_weekly_cron(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is not None

    jobs = {j.id: j for j in scheduler_module._scheduler.get_jobs()}
    assert {"refarch_ingest_weekly", "demo_ingest_weekly"}.issubset(jobs.keys())

    refarch = jobs["refarch_ingest_weekly"]
    assert refarch.max_instances == 1
    assert refarch.coalesce is True
    refarch_fields = {f.name: str(f) for f in refarch.trigger.fields}
    assert refarch_fields["day_of_week"] == "sun"
    assert refarch_fields["hour"] == "4"
    assert refarch_fields["minute"] == "17"

    demo = jobs["demo_ingest_weekly"]
    assert demo.max_instances == 1
    assert demo.coalesce is True
    demo_fields = {f.name: str(f) for f in demo.trigger.fields}
    assert demo_fields["day_of_week"] == "sun"
    assert demo_fields["hour"] == "4"
    assert demo_fields["minute"] == "42"


@pytest.mark.asyncio
async def test_start_scheduler_idempotent(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    first = scheduler_module._scheduler
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is first


@pytest.mark.asyncio
async def test_start_scheduler_registers_pricing_ingest_daily(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is not None

    jobs = {j.id: j for j in scheduler_module._scheduler.get_jobs()}
    # issubset (not strict equality) per the scheduler test convention.
    assert {"pricing_ingest_daily"}.issubset(jobs.keys())

    pricing = jobs["pricing_ingest_daily"]
    assert pricing.max_instances == 1
    assert pricing.coalesce is True
    fields = {f.name: str(f) for f in pricing.trigger.fields}
    assert fields["hour"] == "4"
    assert fields["minute"] == "53"


@pytest.mark.asyncio
async def test_shutdown_clears_singleton(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is not None
    await scheduler_module.shutdown_scheduler()
    assert scheduler_module._scheduler is None
