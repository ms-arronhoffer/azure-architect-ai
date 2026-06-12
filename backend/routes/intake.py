import json

from fastapi import APIRouter
from pydantic import BaseModel

from services.openai_service import get_client, get_deployment

router = APIRouter()


class WorkloadSpecRequest(BaseModel):
    name: str = ""
    type: str = "web-app"
    criticality: str = "standard"
    businessOwner: str = ""
    peakUsers: int = 0
    avgRps: int = 0
    dataVolumeGb: int = 0
    latencyP99Ms: int = 500
    availabilitySla: str = "99.9"
    rtoHours: float = 4
    rpoHours: float = 1
    multiRegion: bool = False
    primaryRegion: str = ""
    drRegion: str = ""
    complianceFrameworks: list[str] = []
    dataClassification: str = "internal"
    identityModel: str = "workforce"
    networkIsolation: bool = False
    monthlyBudgetUsd: float = 0
    teamSize: str = ""
    cloudMaturity: str = "greenfield"
    currentInfrastructure: str = ""
    existingServices: list[str] = []
    integrations: str = ""
    migrationTimeline: str = ""
    regulatoryNotes: str = ""
    additionalNotes: str = ""


@router.post("/intake/validate")
async def validate_workload_spec(spec: WorkloadSpecRequest):
    client = get_client()
    deployment = get_deployment("chat")

    spec_summary = f"""
Workload: {spec.name} ({spec.type}, {spec.criticality})
Scale: {spec.peakUsers} peak users, {spec.avgRps} RPS, {spec.dataVolumeGb} GB
Reliability: {spec.availabilitySla}% SLA, RTO {spec.rtoHours}h, RPO {spec.rpoHours}h
Region: {spec.primaryRegion}{f', DR: {spec.drRegion}' if spec.drRegion else ''}
Multi-region: {spec.multiRegion}
Compliance: {', '.join(spec.complianceFrameworks) or 'None'}
Data classification: {spec.dataClassification}
Identity: {spec.identityModel}
Network isolation: {spec.networkIsolation}
Budget: ${spec.monthlyBudgetUsd:,.0f}/month
Team: {spec.teamSize}
Maturity: {spec.cloudMaturity}
Infrastructure: {spec.currentInfrastructure}
"""

    system_prompt = (
        "You are an Azure cloud architect reviewing a workload specification for contradictions, gaps, and risks. "
        "Identify specific issues such as: SLA targets that require active-active but multi-region is disabled, "
        "budget too low for stated compliance requirements, RTO shorter than RPO, "
        "HIPAA data classification without network isolation, mission-critical workload with no DR region, "
        "or similar contradictions. "
        "Respond with a JSON object: {\"notes\": [\"brief actionable note 1\", \"brief actionable note 2\"]} "
        "Return an empty notes array if the spec looks consistent. "
        "Keep each note under 100 characters. Return ONLY valid JSON."
    )

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Validate this workload spec:\n{spec_summary}"},
        ],
        max_completion_tokens=400,
        response_format={"type": "json_object"},
    )

    try:
        result = json.loads(response.choices[0].message.content or "{}")
        return {"notes": result.get("notes", [])}
    except Exception:
        return {"notes": []}
