"""Async orchestrator for multi-format Model IQ retirement bundles.

A `MigrationJob` row is created by the route, then this service drives:

    analyze → narrative → per-format build → zip

Events are pushed into a per-job `asyncio.Queue` so the SSE endpoint can
fan them out to a connected client. The terminal event (`job_complete`
or `job_failed`) is **also stamped onto the DB row** so a client that
connects after the job has finished can still replay the result.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import zipfile
from pathlib import Path
from typing import Any

from sqlalchemy import select

from db import MigrationJob, session_scope
from services.model_iq_service import analyze_retirement_reports
from services.report_document_service import (
    build_docx_report,
    build_pdf_report,
    build_pptx_report,
    generate_report_narrative,
)

log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

BUNDLE_DIR: Path = Path(__file__).resolve().parent.parent / "data" / "model_iq_bundles"
BUNDLE_DIR.mkdir(parents=True, exist_ok=True)

VALID_FORMATS: frozenset[str] = frozenset({"pptx", "docx", "pdf"})

_BUILDERS = {
    "pptx": build_pptx_report,
    "docx": build_docx_report,
    "pdf": build_pdf_report,
}

# ── SSE queue registry ─────────────────────────────────────────────────────

# Per-job event queue. Subscribers (SSE endpoints) register before the
# orchestrator starts emitting; the orchestrator pushes dict events and a
# final `None` sentinel to close the stream.
_queues: dict[str, asyncio.Queue[dict[str, Any] | None]] = {}
_queues_lock = asyncio.Lock()


async def register_queue(job_id: str) -> asyncio.Queue[dict[str, Any] | None]:
    """Create and return a fresh queue for a new job. Call before launching the task."""
    async with _queues_lock:
        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        _queues[job_id] = q
        return q


async def get_queue(job_id: str) -> asyncio.Queue[dict[str, Any] | None] | None:
    """Look up the live queue for a job, or None if the job has already finished."""
    async with _queues_lock:
        return _queues.get(job_id)


async def _drop_queue(job_id: str) -> None:
    async with _queues_lock:
        _queues.pop(job_id, None)


def _now_ms() -> int:
    return int(time.time() * 1000)


# ── Helpers ────────────────────────────────────────────────────────────────


def normalize_formats(raw: str | None) -> list[str]:
    """Parse a comma-separated `formats` form field.

    Returns the canonical sorted list. Raises ValueError on unknown values.
    """
    if not raw or not raw.strip():
        return sorted(VALID_FORMATS)
    parts = {p.strip().lower() for p in raw.split(",") if p.strip()}
    bad = parts - VALID_FORMATS
    if bad:
        raise ValueError(f"invalid format(s): {sorted(bad)}; valid={sorted(VALID_FORMATS)}")
    if not parts:
        raise ValueError("at least one format is required")
    return sorted(parts)


def bundle_path_for(job_id: str) -> Path:
    return BUNDLE_DIR / f"{job_id}.zip"


# ── Orchestrator ───────────────────────────────────────────────────────────


async def _emit(queue: asyncio.Queue[dict[str, Any] | None] | None, event: dict[str, Any]) -> None:
    if queue is not None:
        await queue.put(event)


async def _set_status(job_id: str, **patch: Any) -> None:
    """Patch a MigrationJob row by id, bypassing tenant scope for service writes."""
    async with session_scope() as s:
        row = (
            await s.execute(
                select(MigrationJob)
                .where(MigrationJob.id == job_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if row is None:
            log.warning("model_iq_bundle: missing job row %s", job_id)
            return
        for k, v in patch.items():
            setattr(row, k, v)
        await s.commit()


async def run_bundle_job(
    job_id: str,
    file_texts: list[str],
    formats: list[str],
    queue: asyncio.Queue[dict[str, Any] | None] | None = None,
) -> None:
    """Drive the full pipeline for one job. Always closes the queue with `None`."""
    formats = sorted({f.lower() for f in formats}) or sorted(VALID_FORMATS)
    terminal: dict[str, Any]
    try:
        await _set_status(job_id, status="running", phase="analyze")
        await _emit(queue, {
            "event": "job_started",
            "job_id": job_id,
            "formats": formats,
            "files": len(file_texts),
        })

        # Phase: analyze (per-file progress)
        for idx in range(len(file_texts)):
            await _emit(queue, {
                "event": "job_progress",
                "phase": "analyze",
                "files_done": idx,
                "files_total": len(file_texts),
            })
            await _set_status(job_id, files_done=idx)

        analysis = await asyncio.to_thread(analyze_retirement_reports, file_texts)
        await _set_status(job_id, files_done=len(file_texts))
        await _emit(queue, {
            "event": "job_progress",
            "phase": "analyze",
            "files_done": len(file_texts),
            "files_total": len(file_texts),
        })

        # Phase: narrative
        await _set_status(job_id, phase="narrative")
        await _emit(queue, {"event": "job_progress", "phase": "narrative"})
        narrative = await asyncio.to_thread(generate_report_narrative, analysis)

        # Phase: build (per format)
        await _set_status(job_id, phase="build")
        built: dict[str, bytes] = {}
        for fmt in formats:
            await _emit(queue, {"event": "job_progress", "phase": "build", "format": fmt})
            builder = _BUILDERS[fmt]
            built[fmt] = await asyncio.to_thread(builder, analysis, narrative)

        # Phase: zip
        await _set_status(job_id, phase="zip")
        await _emit(queue, {"event": "job_progress", "phase": "zip"})
        zip_path = bundle_path_for(job_id)
        await asyncio.to_thread(
            _write_bundle_zip,
            zip_path,
            analysis,
            narrative,
            built,
        )
        size = zip_path.stat().st_size

        terminal = {
            "event": "job_complete",
            "job_id": job_id,
            "size_bytes": size,
            "formats": formats,
        }
        await _set_status(
            job_id,
            status="complete",
            phase=None,
            bundle_path=str(zip_path),
            size_bytes=size,
            completed_at=_now_ms(),
            terminal_event=terminal,
        )
        await _emit(queue, terminal)

    except Exception as exc:  # noqa: BLE001 — top-level safety net
        log.exception("model_iq_bundle: job %s failed", job_id)
        terminal = {
            "event": "job_failed",
            "job_id": job_id,
            "error": str(exc),
        }
        try:
            await _set_status(
                job_id,
                status="failed",
                error=str(exc),
                completed_at=_now_ms(),
                terminal_event=terminal,
            )
        except Exception:  # noqa: BLE001
            log.exception("model_iq_bundle: failed to record failure for %s", job_id)
        await _emit(queue, terminal)

    finally:
        # Order: DB-write happened above, then close the queue.
        await _emit(queue, None)
        await _drop_queue(job_id)


def _write_bundle_zip(
    zip_path: Path,
    analysis: dict[str, Any],
    narrative: dict[str, Any],
    built: dict[str, bytes],
) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("analysis.json", json.dumps(analysis, indent=2, default=str))
        zf.writestr("narrative.json", json.dumps(narrative, indent=2, default=str))
        for fmt, blob in built.items():
            zf.writestr(f"report.{fmt}", blob)


# ── Cleanup ────────────────────────────────────────────────────────────────


async def purge_old_bundles(max_age_hours: int = 24) -> int:
    """Delete MigrationJob rows older than `max_age_hours` plus their ZIPs.

    Returns the number of rows removed. Designed to be called by the scheduler.
    """
    cutoff_ms = _now_ms() - max_age_hours * 3600 * 1000
    removed = 0
    async with session_scope() as s:
        rows = (
            await s.execute(
                select(MigrationJob)
                .where(MigrationJob.created_at < cutoff_ms)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalars().all()
        for row in rows:
            if row.bundle_path:
                try:
                    p = Path(row.bundle_path)
                    if p.exists():
                        await asyncio.to_thread(p.unlink)
                except Exception:  # noqa: BLE001
                    log.exception("model_iq_bundle: could not delete %s", row.bundle_path)
            await s.delete(row)
            removed += 1
        await s.commit()
    return removed
