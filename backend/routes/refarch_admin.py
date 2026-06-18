"""Admin endpoint for manually triggering the MS Architecture Center ingest.

Separated from `routes/refarch.py` to keep the user-facing CRUD module free
of role-gated routes. Gated on `Metrics.Read` to match the existing admin
posture (see `routes/admin.py`).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from auth.entra import require_metrics_role
from services.refarch_ingest import run_ingest

router = APIRouter()


@router.post("/refarch/ingest")
async def trigger_ingest(_claims: dict[str, Any] = Depends(require_metrics_role)) -> dict[str, Any]:
    """Run the Learn Architecture Center ingest on-demand. Returns summary counts."""
    return await run_ingest()
