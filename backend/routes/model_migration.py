"""Model Migration Advisor endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.model_iq_service import (
    compute_feasibility,
    estimate_ptu,
    get_benchmarks,
    get_models,
    get_ptu_supported_models,
    get_retirements,
    rank_replacements,
)

router = APIRouter(prefix="/model-migration", tags=["model-migration"])


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
