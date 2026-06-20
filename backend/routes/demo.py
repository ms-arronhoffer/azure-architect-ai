"""Demo build SSE endpoint + ZIP download.

`POST /api/demo/build` streams the 6-phase demo pipeline. The final
`demo_built` event includes the in-memory file map keyed against the
generated `job_id` so the frontend can call `GET /api/demo/{job_id}/zip`
to download a clone-and-run package. ZIP cache is TTL-evicted at 15
minutes; entries are also dropped on first successful download.
"""
from __future__ import annotations

import io
import json
import time
import uuid
import zipfile
from collections.abc import AsyncGenerator
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth import require_user
from middleware.logging import get_logger
from services.demo_pipeline import DemoBuildRequest, stream_demo_pipeline

log = get_logger("demo")
router = APIRouter(prefix="/demo", tags=["demo"])

_ZIP_TTL_SECONDS = 15 * 60
_ZIP_CACHE: dict[str, tuple[float, dict[str, str], str]] = {}  # job_id -> (expires_at, files, slug)
_ZIP_LOCK = Lock()


def _evict_expired(now: float | None = None) -> None:
    cutoff = now or time.time()
    with _ZIP_LOCK:
        stale = [k for k, (exp, _, _) in _ZIP_CACHE.items() if exp < cutoff]
        for k in stale:
            _ZIP_CACHE.pop(k, None)


def _cache_files(job_id: str, files: dict[str, str], slug: str) -> None:
    with _ZIP_LOCK:
        _ZIP_CACHE[job_id] = (time.time() + _ZIP_TTL_SECONDS, dict(files), slug)


def _pop_cache(job_id: str) -> tuple[dict[str, str], str] | None:
    with _ZIP_LOCK:
        entry = _ZIP_CACHE.pop(job_id, None)
    if not entry:
        return None
    _, files, slug = entry
    return files, slug


def _build_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in sorted(files.items()):
            zf.writestr(path, content)
    return buf.getvalue()


async def _stream(req: DemoBuildRequest, job_id: str) -> AsyncGenerator[str, None]:
    """Wrap the pipeline so the final event includes job_id and the file map is
    stashed in the ZIP cache instead of being shipped over the wire twice."""
    try:
        async for ev in stream_demo_pipeline(req):
            if ev.get("type") == "demo_built":
                files = ev.pop("files", {}) or {}
                slug = (ev.get("spec") or {}).get("slug") or req.demo_slug
                if files:
                    _cache_files(job_id, files, slug)
                ev["job_id"] = job_id
            yield f"data: {json.dumps(ev, default=str)}\n\n"
        yield 'data: {"type": "done"}\n\n'
    except Exception as exc:  # pragma: no cover - defensive; pipeline already catches
        log.exception("demo.stream_failed", error=str(exc))
        yield f"data: {json.dumps({'type': 'phase_failed', 'phase': 'stream', 'error': str(exc)})}\n\n"


@router.post("/build")
async def demo_build(
    req: DemoBuildRequest, _=Depends(require_user)
) -> StreamingResponse:
    _evict_expired()
    job_id = uuid.uuid4().hex
    return StreamingResponse(
        _stream(req, job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{job_id}/zip")
async def demo_zip(job_id: str, _=Depends(require_user)) -> StreamingResponse:
    _evict_expired()
    entry = _pop_cache(job_id)
    if not entry:
        raise HTTPException(status_code=404, detail="job_id not found or expired")
    files, slug = entry
    data = _build_zip(files)
    filename = f"{slug}.zip"
    return StreamingResponse(
        iter([data]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )
