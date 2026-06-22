"""In-memory background job registry for demo builds.

The demo pipeline (`stream_demo_pipeline`) is long-running (minutes) and the
user must be able to navigate away from the Demo Builder page — or even reload
— without losing or aborting the build. To achieve that, the build runs as a
detached `asyncio.Task` whose events are appended to a `DemoJob` record. SSE
clients *subscribe* to that record (replaying buffered events, then streaming
live ones) rather than driving the pipeline themselves. Disconnecting a
subscriber therefore never cancels the build.

Lifecycle:
  start_job(req, token) -> job_id        # launches the detached task
  get_job(job_id) -> DemoJob | None
  subscribe(job_id) -> async generator   # replay + live events
  cancel_job(job_id) -> bool

Jobs (and their cached file maps used for ZIP download) are TTL-evicted.
"""
from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

from middleware.logging import get_logger
from services.demo_pipeline import DemoBuildRequest, stream_demo_pipeline

log = get_logger("demo_jobs")

# Keep a finished build around long enough that a user can come back to the
# panel, see the result, and download the ZIP. Running jobs are never evicted.
_TTL_SECONDS = 60 * 60


@dataclass
class DemoJob:
    job_id: str
    status: str = "running"  # running | done | error | cancelled
    events: list[dict] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    slug: str = ""
    result: dict | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    task: asyncio.Task | None = None
    # Recreated on every append; awaiting the *captured* instance avoids the
    # lost-wakeup race between draining buffered events and sleeping.
    _waiter: asyncio.Event = field(default_factory=asyncio.Event)

    def _notify(self) -> None:
        self.updated_at = time.time()
        old = self._waiter
        self._waiter = asyncio.Event()
        old.set()

    def append(self, event: dict) -> None:
        self.events.append(event)
        self._notify()

    def finish(self, status: str, *, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self._notify()

    def snapshot(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "events": list(self.events),
            "result": self.result,
            "error": self.error,
            "slug": self.slug,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


_jobs: dict[str, DemoJob] = {}


def _evict_expired(now: float | None = None) -> None:
    cutoff = (now or time.time()) - _TTL_SECONDS
    stale = [
        jid
        for jid, job in _jobs.items()
        if job.status != "running" and job.updated_at < cutoff
    ]
    for jid in stale:
        _jobs.pop(jid, None)


def get_job(job_id: str) -> DemoJob | None:
    return _jobs.get(job_id)


async def _run(job: DemoJob, req: DemoBuildRequest, github_token: str) -> None:
    """Drive the pipeline to completion, buffering every event on the job."""
    try:
        async for ev in stream_demo_pipeline(req, github_token=github_token):
            if ev.get("type") == "demo_built":
                files = ev.pop("files", {}) or {}
                job.files = files
                job.slug = (ev.get("spec") or {}).get("slug") or req.demo_slug
                ev["job_id"] = job.job_id
                job.result = ev
            job.append(ev)
        job.append({"type": "done", "job_id": job.job_id})
        job.finish("done")
    except asyncio.CancelledError:
        job.append({"type": "cancelled", "job_id": job.job_id})
        job.finish("cancelled")
        raise
    except Exception as exc:  # pragma: no cover - pipeline already guards phases
        log.exception("demo_jobs.run_failed", job_id=job.job_id, error=str(exc))
        job.append(
            {"type": "phase_failed", "phase": "stream", "error": str(exc)}
        )
        job.append({"type": "done", "job_id": job.job_id})
        job.finish("error", error=str(exc))


def start_job(req: DemoBuildRequest, github_token: str = "") -> str:
    """Create a detached build task and return its job_id immediately."""
    _evict_expired()
    job_id = uuid.uuid4().hex
    job = DemoJob(job_id=job_id, slug=req.demo_slug)
    _jobs[job_id] = job
    job.task = asyncio.create_task(_run(job, req, github_token))
    return job_id


async def subscribe(job_id: str) -> AsyncGenerator[dict, None]:
    """Yield buffered events then stream live ones until the job ends."""
    job = _jobs.get(job_id)
    if job is None:
        return
    idx = 0
    while True:
        waiter = job._waiter
        while idx < len(job.events):
            yield job.events[idx]
            idx += 1
        if job.status != "running":
            return
        await waiter.wait()


async def cancel_job(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if job is None or job.task is None or job.task.done():
        return False
    job.task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await job.task
    return True
