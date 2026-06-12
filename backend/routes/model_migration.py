"""Model Migration Advisor endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

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
