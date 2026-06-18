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

    jobs = scheduler_module._scheduler.get_jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert job.id == "refarch_ingest_weekly"
    assert job.max_instances == 1
    assert job.coalesce is True

    # CronTrigger field values are stored as a tuple of BaseField objects.
    fields = {f.name: str(f) for f in job.trigger.fields}
    assert fields["day_of_week"] == "sun"
    assert fields["hour"] == "4"
    assert fields["minute"] == "17"


@pytest.mark.asyncio
async def test_start_scheduler_idempotent(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    first = scheduler_module._scheduler
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is first


@pytest.mark.asyncio
async def test_shutdown_clears_singleton(monkeypatch):
    monkeypatch.setattr(settings, "ingest_enabled", True)
    scheduler_module.start_scheduler()
    assert scheduler_module._scheduler is not None
    await scheduler_module.shutdown_scheduler()
    assert scheduler_module._scheduler is None
