"""Demo build SSE endpoint + ZIP download.

`POST /api/demo/build` launches the 6-phase demo pipeline as a *detached*
background job (see `services.demo_jobs`) and returns its `job_id` immediately.
The build keeps running on the server independent of any client connection, so
the user can navigate away from -- or reload -- the Demo Builder page without
aborting it.

Clients then:
  - ``GET  /api/demo/{job_id}/events``  -- SSE: replays buffered events, then
    streams live ones (reconnect-safe).
  - ``GET  /api/demo/{job_id}/status``  -- JSON snapshot for reconnecting after
    a full page reload.
  - ``POST /api/demo/{job_id}/cancel``  -- stop a running build.
  - ``GET  /api/demo/{job_id}/zip``     -- download the clone-and-run package.
"""
from __future__ import annotations

import io
import json
import zipfile
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth import require_user, user_id_from_claims
from middleware.logging import get_logger
from services import demo_jobs
from services.demo_pipeline import DemoBuildRequest

log = get_logger("demo")
router = APIRouter(prefix="/demo", tags=["demo"])


def _build_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in sorted(files.items()):
            zf.writestr(path, content)
    return buf.getvalue()


async def _sse(job_id: str) -> AsyncGenerator[str, None]:
    async for ev in demo_jobs.subscribe(job_id):
        yield f"data: {json.dumps(ev, default=str)}\n\n"


@router.post("/build")
async def demo_build(
    req: DemoBuildRequest, claims=Depends(require_user)
) -> dict[str, str]:
    """Start a detached demo build and return its job_id."""
    from db import session_scope
    from services.secret_store import get_secret

    user_id = user_id_from_claims(claims)
    async with session_scope() as session:
        github_token = await get_secret(session, user_id, "github_pat") or ""
    job_id = demo_jobs.start_job(req, github_token=github_token)
    return {"job_id": job_id}


@router.get("/{job_id}/events")
async def demo_events(job_id: str, _=Depends(require_user)) -> StreamingResponse:
    if demo_jobs.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="job_id not found or expired")
    return StreamingResponse(
        _sse(job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{job_id}/status")
async def demo_status(job_id: str, _=Depends(require_user)) -> dict:
    job = demo_jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job_id not found or expired")
    return job.snapshot()


@router.post("/{job_id}/cancel")
async def demo_cancel(job_id: str, _=Depends(require_user)) -> dict[str, bool]:
    cancelled = await demo_jobs.cancel_job(job_id)
    return {"cancelled": cancelled}


@router.get("/{job_id}/zip")
async def demo_zip(job_id: str, _=Depends(require_user)) -> StreamingResponse:
    job = demo_jobs.get_job(job_id)
    if job is None or not job.files:
        raise HTTPException(status_code=404, detail="job_id not found or expired")
    data = _build_zip(job.files)
    filename = f"{job.slug or 'demo'}.zip"
    return StreamingResponse(
        iter([data]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )
