"""Admin endpoint for manually triggering the Azure Retail pricing ingest.

Mirrors ``routes/refarch_admin.py``. Gated on ``Metrics.Read`` to match the
existing admin posture. Lets an operator refresh the local ``PricingMeter``
catalog on demand instead of waiting for the ``pricing_ingest_daily`` job.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from auth.entra import require_metrics_role
from services.pricing_ingest import run_ingest

router = APIRouter()


@router.post("/cost/pricing/ingest")
async def trigger_pricing_ingest(
    _claims: dict[str, Any] = Depends(require_metrics_role),
) -> dict[str, Any]:
    """Run the Azure Retail pricing catalog ingest on-demand. Returns counts."""
    return await run_ingest()
