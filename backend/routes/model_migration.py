"""Model Migration Advisor endpoints."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import (
    MigrationJob,
    current_tenant_id,
    engagement_id_var,
    get_session,
    select,
)
from services.model_iq_bundle_service import (
    bundle_path_for,
    get_queue,
    normalize_formats,
    register_queue,
    run_bundle_job,
)
from services.model_iq_service import (
    analyze_retirement_report,
    compute_feasibility,
    estimate_ptu,
    get_benchmarks,
    get_live_models,
    get_models,
    get_ptu_supported_models,
    get_retirements,
    get_source_models,
    get_target_models,
    rank_replacements,
)
from services.report_document_service import (
    build_docx_report,
    build_pdf_report,
    build_pptx_report,
    generate_report_narrative,
)

router = APIRouter(prefix="/model-migration", tags=["model-migration"])

_background_tasks: set[asyncio.Task[Any]] = set()


class ScoreRequest(BaseModel):
    source: str
    target: str


class PtuRequest(BaseModel):
    model: str
    avg_input_tokens: int = 500
    avg_output_tokens: int = 200
    peak_rpm: int = 60
    hours_per_week: float = 168.0
    ptu_monthly_price: float = 0.0
    paygo_input_price: float | None = None
    paygo_output_price: float | None = None


class AnalyzeReportRequest(BaseModel):
    report: str


@router.get("/source-models")
def source_models() -> list[str]:
    try:
        return get_source_models()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/target-models/{model_id:path}")
def target_models(model_id: str) -> list[str]:
    try:
        return get_target_models(model_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/models")
def list_models() -> list[dict]:
    return get_models()


@router.get("/benchmarks")
def list_benchmarks() -> list[dict]:
    return get_benchmarks()


@router.get("/retirements")
def list_retirements() -> dict:
    return get_retirements()


@router.post("/score")
def score_migration(req: ScoreRequest) -> dict:
    result = compute_feasibility(req.source, req.target)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No evaluation data found for {req.source} → {req.target}",
        )
    return result


@router.get("/recommend/{model_id:path}")
def recommend_replacements(model_id: str) -> dict:
    replacements = rank_replacements(model_id)
    return {"source": model_id, "replacements": replacements}


@router.post("/ptu-estimate")
def ptu_estimate(req: PtuRequest) -> dict:
    try:
        return estimate_ptu(
            model=req.model,
            avg_input_tokens=req.avg_input_tokens,
            avg_output_tokens=req.avg_output_tokens,
            peak_rpm=req.peak_rpm,
            hours_per_week=req.hours_per_week,
            ptu_monthly_price=req.ptu_monthly_price,
            paygo_input_price=req.paygo_input_price,
            paygo_output_price=req.paygo_output_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/ptu-models")
def ptu_supported_models() -> list[str]:
    return get_ptu_supported_models()


@router.get("/live-models")
def live_models() -> list[str]:
    """Model IDs from Microsoft Learn, refreshed every 24 h."""
    try:
        return get_live_models()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/analyze-report")
def analyze_report(req: AnalyzeReportRequest) -> dict:
    """Analyze a tab-separated Azure OpenAI retirement report and return
    prioritized migration recommendations using migration advisor scoring."""
    try:
        return analyze_retirement_report(req.report)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ExportDocumentRequest(BaseModel):
    data: dict
    format: str = "pptx"


_MIME = {
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


@router.post("/export-document")
def export_document(req: ExportDocumentRequest) -> Response:
    """Generate a customer-facing PPTX, DOCX, or PDF from analyzed report data."""
    fmt = req.format.lower()
    if fmt not in _MIME:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")
    try:
        narrative = generate_report_narrative(req.data)
        if fmt == "docx":
            content = build_docx_report(req.data, narrative)
        elif fmt == "pdf":
            content = build_pdf_report(req.data, narrative)
        else:
            content = build_pptx_report(req.data, narrative)
        date_str = req.data.get("summary", {}).get("analysis_date", "report")
        filename = f"migration-report-{date_str}.{fmt}"
        return Response(
            content=content,
            media_type=_MIME[fmt],
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Async multi-format bundle jobs ─────────────────────────────────────────

_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB per file
_JOB_TTL_HOURS = 24
_BUNDLE_MIME = "application/zip"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


def _job_to_status(row: MigrationJob) -> dict[str, Any]:
    expires_at_ms = row.created_at + _JOB_TTL_HOURS * 3600 * 1000
    return {
        "job_id": row.id,
        "status": row.status,
        "formats": row.formats.split(",") if row.formats else [],
        "files": row.files_total,
        "files_done": row.files_done,
        "phase": row.phase,
        "error": row.error,
        "bundle_url": f"/api/model-migration/jobs/{row.id}/bundle.zip",
        "size_bytes": row.size_bytes,
        "created_at": row.created_at,
        "completed_at": row.completed_at,
        "expires_at": expires_at_ms,
    }


@router.post("/jobs", status_code=202)
async def create_job(
    files: list[UploadFile] = File(...),
    formats: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Submit 1-N retirement-report CSVs; returns a job envelope immediately.

    The actual analysis + document build runs in the background. Poll
    `/jobs/{id}` or subscribe to `/jobs/{id}/events` to track progress.
    """
    if not files:
        raise HTTPException(status_code=400, detail="at least one file is required")

    try:
        fmts = normalize_formats(formats)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_texts: list[str] = []
    for uf in files:
        blob = await uf.read()
        if len(blob) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"file {uf.filename!r} exceeds {_MAX_FILE_BYTES} bytes",
            )
        file_texts.append(blob.decode("utf-8", errors="replace"))

    job_id = uuid.uuid4().hex
    uid = _uid(claims)
    row = MigrationJob(
        id=job_id,
        status="pending",
        phase=None,
        formats=",".join(fmts),
        files_total=len(file_texts),
        files_done=0,
        user_id=uid,
        engagement_id=engagement_id_var.get(),
        created_at=_now_ms(),
    )
    session.add(row)
    await session.commit()

    queue = await register_queue(job_id)
    _bundle_task = asyncio.create_task(run_bundle_job(job_id, file_texts, fmts, queue))
    _background_tasks.add(_bundle_task)
    _bundle_task.add_done_callback(_background_tasks.discard)

    return {
        "job_id": job_id,
        "status": "pending",
        "formats": fmts,
        "sse_url": f"/api/model-migration/jobs/{job_id}/events",
        "status_url": f"/api/model-migration/jobs/{job_id}",
        "bundle_url": f"/api/model-migration/jobs/{job_id}/bundle.zip",
        "expires_at": row.created_at + _JOB_TTL_HOURS * 3600 * 1000,
    }


async def _load_job(
    session: AsyncSession, job_id: str, tenant_id: str
) -> MigrationJob:
    row = (
        await session.execute(
            select(MigrationJob)
            .where(MigrationJob.id == job_id)
            .where(MigrationJob.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return row


@router.get("/jobs/{job_id}")
async def job_status(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_job(session, job_id, current_tenant_id())
    return _job_to_status(row)


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> StreamingResponse:
    """SSE stream for a job. If the job is already finished, replay the
    terminal event from the DB row and close."""
    row = await _load_job(session, job_id, current_tenant_id())
    tenant_id = current_tenant_id()

    async def _gen():
        # Replay path: if terminal already exists, emit it and stop.
        if row.status in ("complete", "failed") and row.terminal_event:
            yield f"data: {json.dumps(row.terminal_event)}\n\n"
            return

        queue = await get_queue(job_id)
        if queue is None:
            # Race: orchestrator finished between our row read and queue
            # lookup. Re-load and replay terminal event.
            from db import session_scope

            async with session_scope() as s2:
                r2 = (
                    await s2.execute(
                        select(MigrationJob)
                        .where(MigrationJob.id == job_id)
                        .where(MigrationJob.tenant_id == tenant_id)
                    )
                ).scalar_one_or_none()
                if r2 is not None and r2.terminal_event:
                    yield f"data: {json.dumps(r2.terminal_event)}\n\n"
            return

        while True:
            event = await queue.get()
            if event is None:
                return
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/bundle.zip")
async def job_bundle(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
) -> FileResponse:
    from pathlib import Path

    row = await _load_job(session, job_id, current_tenant_id())
    if row.status in ("pending", "running"):
        raise HTTPException(status_code=404, detail="job not yet complete")
    if row.status == "failed":
        raise HTTPException(status_code=409, detail=row.error or "job failed")
    expected = bundle_path_for(job_id)
    path = Path(row.bundle_path) if row.bundle_path else expected
    if not path.exists():
        raise HTTPException(status_code=410, detail="bundle expired")

    from datetime import date as _date

    today = _date.today().isoformat()
    filename = f"migration-bundle-{today}-{job_id[:8]}.zip"
    return FileResponse(
        path=str(path),
        media_type=_BUNDLE_MIME,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
