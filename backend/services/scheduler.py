"""APScheduler integration for periodic background jobs.

Currently runs a single weekly job: the Microsoft Architecture Center
ingest (`services.refarch_ingest.run_ingest`). Gated on
`settings.ingest_enabled` — when false, `start_scheduler()` is a no-op so
local dev and tests don't accidentally hit the live Learn API.
"""
from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import settings
from middleware.logging import get_logger
from services.avm_ingest import run_ingest as avm_run_ingest
from services.azure_updates_ingest import run_ingest as azure_updates_run_ingest
from services.demo_ingest import run_ingest as demo_run_ingest
from services.refarch_ingest import run_ingest

_log = get_logger("scheduler")

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> None:
    """Start the global scheduler. Idempotent — no-op if already running."""
    global _scheduler
    if not settings.ingest_enabled:
        _log.info("scheduler.disabled", reason="ingest_enabled=false")
        return
    if _scheduler is not None:
        return
    sched = AsyncIOScheduler()
    sched.add_job(
        run_ingest,
        trigger=CronTrigger(day_of_week="sun", hour=4, minute=17),
        id="refarch_ingest_weekly",
        name="Weekly MS Architecture Center ingest",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    sched.add_job(
        demo_run_ingest,
        trigger=CronTrigger(day_of_week="sun", hour=4, minute=42),
        id="demo_ingest_weekly",
        name="Weekly awesome-azd ingest",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    sched.add_job(
        azure_updates_run_ingest,
        trigger=CronTrigger(hour=3, minute=23),
        id="azure_updates_ingest_daily",
        name="Daily Azure Updates RAG ingest",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    sched.add_job(
        avm_run_ingest,
        trigger=CronTrigger(day_of_week="mon", hour=5, minute=11),
        id="avm_ingest_weekly",
        name="Weekly Azure Verified Modules catalog ingest",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    sched.start()
    _scheduler = sched
    _log.info("scheduler.started", jobs=[j.id for j in sched.get_jobs()])


async def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    _log.info("scheduler.stopped")


__all__ = ["shutdown_scheduler", "start_scheduler"]
