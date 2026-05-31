"""IaC emit endpoints — Terraform / ARM for a reference architecture."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_user
from data.reference_archs import REFERENCE_ARCHS
from services.iac import (
    PipelineConfig,
    emit_arm,
    emit_azure_devops,
    emit_github_actions,
    emit_terraform,
    module_from_reference_arch,
)

router = APIRouter(prefix="/iac", tags=["iac"])

_VALID_FORMATS = {"terraform", "arm"}
_VALID_PIPELINES = {"github-actions", "azure-devops"}


@router.get("/emit")
async def emit(
    reference_arch_id: str = Query(...),
    format: str = Query("terraform"),
    _=Depends(require_user),
) -> dict:
    fmt = format.lower()
    if fmt not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f"format must be one of {sorted(_VALID_FORMATS)}")
    arch = next((a for a in REFERENCE_ARCHS if a["id"] == reference_arch_id), None)
    if arch is None:
        raise HTTPException(status_code=404, detail=f"unknown reference_arch_id: {reference_arch_id}")
    module = module_from_reference_arch(arch)
    files = emit_terraform(module) if fmt == "terraform" else emit_arm(module)
    return {
        "reference_arch": {"id": arch["id"], "title": arch["title"]},
        "format": fmt,
        "files": files,
    }


@router.get("/pipeline")
async def pipeline(
    reference_arch_id: str = Query(...),
    iac_format: str = Query("terraform"),
    pipeline_type: str = Query("github-actions"),
    iac_path: str = Query("infra"),
    _=Depends(require_user),
) -> dict:
    iac_fmt = iac_format.lower()
    pipe = pipeline_type.lower()
    if iac_fmt not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f"iac_format must be one of {sorted(_VALID_FORMATS)}")
    if pipe not in _VALID_PIPELINES:
        raise HTTPException(status_code=400, detail=f"pipeline_type must be one of {sorted(_VALID_PIPELINES)}")
    arch = next((a for a in REFERENCE_ARCHS if a["id"] == reference_arch_id), None)
    if arch is None:
        raise HTTPException(status_code=404, detail=f"unknown reference_arch_id: {reference_arch_id}")
    cfg = PipelineConfig(
        name=f"deploy-{arch['id']}",
        iac_format=iac_fmt,  # type: ignore[arg-type]
        iac_path=iac_path,
    )
    try:
        files = emit_github_actions(cfg) if pipe == "github-actions" else emit_azure_devops(cfg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "reference_arch": {"id": arch["id"], "title": arch["title"]},
        "iac_format": iac_fmt,
        "pipeline_type": pipe,
        "files": files,
    }
