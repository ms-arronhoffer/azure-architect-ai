"""Extract text from uploaded DOCX or PDF files."""

import io
import zipfile
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/parse")
async def parse_document(request: Request) -> JSONResponse:
    filename = request.headers.get("X-Filename", "upload")
    data = await request.body()

    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    lower = filename.lower()
    if lower.endswith(".pdf"):
        text = _extract_pdf(data)
    elif lower.endswith(".docx"):
        text = _extract_docx(data, filename)
    else:
        raise HTTPException(status_code=415, detail="Only .pdf and .docx files are supported.")

    return JSONResponse({"text": text, "filename": filename})


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise HTTPException(status_code=500, detail="pypdf not installed — run: python -m pip install pypdf")
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(p for p in parts if p.strip())
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}")


def _extract_docx(data: bytes, filename: str) -> str:
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{filename}' does not appear to be a valid .docx file "
                f"({len(data)} bytes received). "
                "If this is a legacy .doc file, open in Word and save as .docx."
            ),
        )
    try:
        from docx import Document
    except ImportError:
        raise HTTPException(status_code=500, detail="python-docx not installed.")
    try:
        doc = Document(io.BytesIO(data))
        parts = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n\n".join(parts)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read DOCX: {exc}")
