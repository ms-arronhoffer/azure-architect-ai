"""Admin endpoint for manually triggering the awesome-azd Demo ingest.

Separated from `routes/demos.py` to keep the user-facing CRUD module free
of role-gated routes. Gated on `Metrics.Read` to match the existing admin
posture (see `routes/admin.py` and `routes/refarch_admin.py`).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from auth.entra import require_metrics_role
from services.demo_ingest import run_ingest

router = APIRouter()


@router.post("/demos/ingest")
async def trigger_ingest(_claims: dict[str, Any] = Depends(require_metrics_role)) -> dict[str, Any]:
    """Run the awesome-azd ingest on-demand. Returns summary counts."""
    return await run_ingest()
