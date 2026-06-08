from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.strategy_service import stream_strategy
from services.openai_service import get_client, get_deployment

router = APIRouter()


class StrategyRequest(BaseModel):
    workload_name: str = ""
    workload_type: str = ""
    description: str = ""
    business_drivers: list[str] = []
    success_criteria: str = ""
    timeline: str = ""
    maturity: str = ""
    constraints: str = ""
    region: str = ""
    compliance: str = ""
    budget: str = ""
    team_size: str = ""


@router.post("/strategy")
async def create_strategy(req: StrategyRequest):
    client = get_client()
    deployment = get_deployment("architecture")
    return StreamingResponse(
        stream_strategy(req.model_dump(), client, deployment),
        media_type="text/event-stream",
    )
