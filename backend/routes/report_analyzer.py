"""Report Analyzer — HLS CSA Org Tracker report generation endpoints."""

from datetime import date, datetime

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from services.report_analyzer_service import (
    build_org_report_pdf,
    compute_org_data,
    generate_org_report,
    generate_recommendations,
    render_report,
)

router = APIRouter(prefix="/report-analyzer", tags=["report-analyzer"])


@router.post("/generate")
async def generate_report(
    manager_list: UploadFile = File(...),
    acr_data: UploadFile = File(...),
    ou_data: UploadFile = File(...),
) -> dict:
    """Generate the org tracker report and AI recommendations from three input files.

    Returns:
        markdown: 9-section HLS CSA Org Tracker report
        recommendations_markdown: AI-generated action plan (empty string if LLM unavailable)
        generated: ISO timestamp
    """
    try:
        ml_bytes = await manager_list.read()
        acr_bytes = await acr_data.read()
        ou_bytes = await ou_data.read()

        today = date.today()
        ml_name = manager_list.filename or "manager_list.csv"
        acr_name = acr_data.filename or "acr_data.csv"
        ou_name = ou_data.filename or "ou_data.csv"

        org_scorecard, model_summary, month_col = compute_org_data(
            ml_bytes, ml_name,
            acr_bytes, acr_name,
            ou_bytes, ou_name,
            today,
        )

        markdown = render_report(
            org_scorecard, model_summary, today, month_col,
            ml_name, acr_name, ou_name,
        )

        try:
            recommendations_markdown = generate_recommendations(
                org_scorecard, model_summary, today
            )
        except Exception:
            recommendations_markdown = ""

        return {
            "markdown": markdown,
            "recommendations_markdown": recommendations_markdown,
            "generated": datetime.now(datetime.UTC).isoformat(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/generate/download")
async def generate_report_download(
    manager_list: UploadFile = File(...),
    acr_data: UploadFile = File(...),
    ou_data: UploadFile = File(...),
) -> Response:
    """Same as /generate but returns the markdown as a downloadable .md file."""
    try:
        ml_bytes = await manager_list.read()
        acr_bytes = await acr_data.read()
        ou_bytes = await ou_data.read()
        markdown = generate_org_report(
            manager_list_data=ml_bytes,
            manager_list_name=manager_list.filename or "manager_list.csv",
            acr_data=acr_bytes,
            acr_name=acr_data.filename or "acr_data.csv",
            ou_data=ou_bytes,
            ou_name=ou_data.filename or "ou_data.csv",
        )
        filename = f"hls-csa-org-tracker-{date.today().isoformat()}.md"
        return Response(
            content=markdown.encode("utf-8"),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class MarkdownToPdfRequest(BaseModel):
    markdown: str
    generated: str = ""


@router.post("/markdown-to-pdf")
def markdown_to_pdf(req: MarkdownToPdfRequest) -> Response:
    """Convert an already-generated org tracker markdown string to a PDF download."""
    try:
        pdf_bytes = build_org_report_pdf(req.markdown, req.generated)
        filename = f"hls-csa-org-tracker-{date.today().isoformat()}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

