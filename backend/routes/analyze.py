import asyncio
import json
import re
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from limiter import limiter
from routes.architecture import ArchRequest, _stream_architecture

router = APIRouter()

_CONFIDENCE_FENCE_RE = re.compile(r"```confidence\s*\n.*?\n```", re.DOTALL | re.IGNORECASE)


class AnalyzeRequest(BaseModel):
    requirements: str
    constraints: str = ""
    region: str = ""
    compliance: list[str] = []
    budget_usd: float = 0


async def _relay_sse(
    gen: AsyncGenerator[str, None],
    job: str,
    *,
    phase: str | None = None,
    container: dict[str, Any] | None = None,
    yield_individually: bool = True,
    collected: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """Tag SSE chunks with _job and optional _phase. If container is given, accumulate token
    text and structured artifacts. If yield_individually=False, append tagged chunks to
    collected instead of yielding (caller batches them later).
    """
    if container is not None:
        container.setdefault("text", "")
        container.setdefault("artifacts", {})
        container.setdefault("waf_pillars", [])
        container.setdefault("confidence", [])

    async for chunk in gen:
        if not chunk.startswith("data: "):
            if yield_individually:
                yield chunk
            elif collected is not None:
                collected.append(chunk)
            continue
        raw = chunk[6:].strip()
        try:
            obj = json.loads(raw)
        except Exception:
            if yield_individually:
                yield chunk
            elif collected is not None:
                collected.append(chunk)
            continue
        obj["_job"] = job
        if phase:
            obj["_phase"] = phase
        if container is not None:
            etype = obj.get("type")
            if etype == "token":
                container["text"] += obj.get("content", "")
            elif etype == "runbook":
                container["artifacts"]["runbook"] = obj.get("markdown", "")
            elif etype == "bicep":
                container["artifacts"]["bicep"] = obj.get("code", "")
            elif etype == "bicep_preview":
                container["artifacts"]["bicep_preview"] = obj.get("preview")
            elif etype == "waf_pillar":
                pillar = obj.get("pillar")
                if pillar:
                    container["waf_pillars"].append(pillar)
            elif etype == "confidence":
                items = obj.get("items") or []
                if isinstance(items, list):
                    container["confidence"].extend(items)
                # Scrub the confidence fence from accumulated text so the
                # tab markdown doesn't show a raw JSON block to the user.
                container["text"] = _CONFIDENCE_FENCE_RE.sub("", container["text"]).rstrip() + "\n"
        tagged = f"data: {json.dumps(obj)}\n\n"
        if yield_individually:
            yield tagged
        elif collected is not None:
            collected.append(tagged)


async def _collect_tagged(gen: AsyncGenerator[str, None], job: str) -> list[str]:
    """Collect SSE chunks tagged with _job=<job> for batch emission (parallel mode)."""
    collected: list[str] = []
    async for _ in _relay_sse(gen, job, yield_individually=False, collected=collected):
        pass  # pragma: no cover
    return collected


async def _stream_analyze(req: AnalyzeRequest) -> AsyncGenerator[str, None]:
    arch_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="architecture",
        region=req.region,
        include_components=["diagram", "bicep", "runbook"],
    )
    waf_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="waf",
        region=req.region,
        existing_description=req.requirements,
    )
    security_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="security",
        region=req.region,
    )

    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'architecture', 'status': 'running'})}\n\n"
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'waf', 'status': 'running'})}\n\n"
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'security', 'status': 'running'})}\n\n"

    arch_task = asyncio.create_task(_collect_tagged(_stream_architecture(arch_req), "architecture"))
    waf_task = asyncio.create_task(_collect_tagged(_stream_architecture(waf_req), "waf"))
    security_task = asyncio.create_task(_collect_tagged(_stream_architecture(security_req), "security"))

    results = await asyncio.gather(arch_task, waf_task, security_task)

    for job, events in zip(["architecture", "waf", "security"], results, strict=True):
        for event in events:
            yield event
        yield f"data: {json.dumps({'type': 'analyze_status', 'job': job, 'status': 'done'})}\n\n"

    yield "data: {\"type\": \"done\"}\n\n"


@router.post("/analyze")
@limiter.limit("10/minute")
async def analyze(request: Request, req: AnalyzeRequest):
    return StreamingResponse(
        _stream_analyze(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_pipeline(req: AnalyzeRequest) -> AsyncGenerator[str, None]:
    workload_name = ""
    first_line = req.requirements.strip().splitlines()[0] if req.requirements.strip() else ""
    if first_line.lower().startswith("workload:"):
        workload_name = first_line.split(":", 1)[1].strip().split("(")[0].strip()

    arch_state: dict[str, Any] = {}
    security_state: dict[str, Any] = {}
    waf_state: dict[str, Any] = {}

    # 1. Architecture
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'architecture', 'status': 'running', '_phase': 'pipeline'})}\n\n"
    arch_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="architecture",
        region=req.region,
        include_components=["diagram", "bicep", "runbook"],
    )
    async for chunk in _relay_sse(_stream_architecture(arch_req), "architecture", phase="pipeline", container=arch_state):
        yield chunk
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'architecture', 'status': 'done', '_phase': 'pipeline'})}\n\n"

    arch_text = arch_state.get("text", "")

    # 2. Security — fed by architecture
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'security', 'status': 'running', '_phase': 'pipeline'})}\n\n"
    sec_priors = "\n\n## Prior Step — Architecture\n" + arch_text
    security_req = ArchRequest(
        requirements=req.requirements + sec_priors,
        constraints=req.constraints,
        mode="security",
        region=req.region,
        existing_description=arch_text,
    )
    async for chunk in _relay_sse(_stream_architecture(security_req), "security", phase="pipeline", container=security_state):
        yield chunk
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'security', 'status': 'done', '_phase': 'pipeline'})}\n\n"

    security_text = security_state.get("text", "")

    # 3. WAF — fed by all priors
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'waf', 'status': 'running', '_phase': 'pipeline'})}\n\n"
    waf_priors = sec_priors + "\n\n## Prior Step — Security\n" + security_text
    waf_req = ArchRequest(
        requirements=req.requirements + waf_priors,
        constraints=req.constraints,
        mode="waf",
        region=req.region,
        existing_description=arch_text + "\n\n" + security_text,
    )
    async for chunk in _relay_sse(_stream_architecture(waf_req), "waf", phase="pipeline", container=waf_state):
        yield chunk
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'waf', 'status': 'done', '_phase': 'pipeline'})}\n\n"

    # 4. Final bundled_design event
    bundled = {
        "type": "bundled_design",
        "workload_name": workload_name or "Workload",
        "generated_at": datetime.now(UTC).isoformat(),
        "architecture": {
            "text": arch_text,
            "runbook": arch_state.get("artifacts", {}).get("runbook", ""),
            "bicep": arch_state.get("artifacts", {}).get("bicep", ""),
            "bicep_preview": arch_state.get("artifacts", {}).get("bicep_preview"),
        },
        "sizing": {"text": ""},
        "security": {"text": security_text},
        "waf": {"pillars": waf_state.get("waf_pillars", [])},
        "confidence": (arch_state.get("confidence", []) or [])
            + (security_state.get("confidence", []) or [])
            + (waf_state.get("confidence", []) or []),
    }
    yield f"data: {json.dumps(bundled)}\n\n"
    yield "data: {\"type\": \"done\"}\n\n"


@router.post("/analyze/pipeline")
async def analyze_pipeline(req: AnalyzeRequest):
    return StreamingResponse(
        _stream_pipeline(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
