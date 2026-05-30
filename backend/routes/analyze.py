import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routes.architecture import ArchRequest, _stream_architecture

router = APIRouter()


class AnalyzeRequest(BaseModel):
    requirements: str
    constraints: str = ""
    region: str = ""
    compliance: list[str] = []
    budget_usd: float = 0


async def _collect_stream(gen: AsyncGenerator[str, None], prefix: str) -> list[str]:
    events = []
    async for chunk in gen:
        if chunk.startswith("data: "):
            raw = chunk[6:].strip()
            try:
                obj = json.loads(raw)
                obj["_job"] = prefix
                events.append(f"data: {json.dumps(obj)}\n\n")
            except Exception:
                pass
    return events


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
    sizing_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="sizing",
        region=req.region,
    )
    security_req = ArchRequest(
        requirements=req.requirements,
        constraints=req.constraints,
        mode="security",
        region=req.region,
    )

    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'architecture', 'status': 'running'})}\n\n"
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'waf', 'status': 'running'})}\n\n"
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'sizing', 'status': 'running'})}\n\n"
    yield f"data: {json.dumps({'type': 'analyze_status', 'job': 'security', 'status': 'running'})}\n\n"

    arch_task = asyncio.create_task(
        _collect_stream(_stream_architecture(arch_req), "architecture")
    )
    waf_task = asyncio.create_task(
        _collect_stream(_stream_architecture(waf_req), "waf")
    )
    sizing_task = asyncio.create_task(
        _collect_stream(_stream_architecture(sizing_req), "sizing")
    )
    security_task = asyncio.create_task(
        _collect_stream(_stream_architecture(security_req), "security")
    )

    results = await asyncio.gather(arch_task, waf_task, sizing_task, security_task)

    for job_idx, (job, events) in enumerate(zip(
        ["architecture", "waf", "sizing", "security"], results
    )):
        for event in events:
            yield event
        yield f"data: {json.dumps({'type': 'analyze_status', 'job': job, 'status': 'done'})}\n\n"

    yield "data: {\"type\": \"done\"}\n\n"


@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    return StreamingResponse(
        _stream_analyze(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
