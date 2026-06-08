from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from middleware.logging import get_logger
from services.openai_service import get_client, get_deployment
from services.whats_new_service import draft_customer_email, fetch_announcements, fetch_service_health

log = get_logger("whats_new_route")

router = APIRouter()


@router.get("/whats-new")
async def get_announcements(
    source: str | None = Query(default=None),
    refresh: bool = Query(default=False),
):
    announcements = await fetch_announcements(force_refresh=refresh)
    if source:
        announcements = [a for a in announcements if a["source"] == source]
    announcements.sort(key=lambda a: a.get("pub_date", ""), reverse=True)
    return {"announcements": announcements, "total": len(announcements)}


class DraftEmailRequest(BaseModel):
    announcement_ids: list[str]
    customer_context: str = ""


@router.post("/whats-new/draft-email")
async def draft_email(req: DraftEmailRequest):
    if not req.announcement_ids:
        raise HTTPException(status_code=400, detail="At least one announcement must be selected.")

    all_announcements = await fetch_announcements()
    id_set = set(req.announcement_ids)
    selected = [a for a in all_announcements if a["id"] in id_set]

    if not selected:
        raise HTTPException(status_code=404, detail="None of the specified announcement IDs were found.")

    client = get_client()
    deployment = get_deployment("qa")

    try:
        subject, body = await draft_customer_email(selected, req.customer_context, client, deployment)
    except Exception as exc:
        log.error("whats_new.draft_error", error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to generate email draft.")

    return {"subject": subject, "body": body}


@router.get("/service-health")
async def get_service_health(refresh: bool = Query(default=False)):
    incidents = await fetch_service_health(force_refresh=refresh)
    incidents.sort(key=lambda a: a.get("pub_date", ""), reverse=True)
    return {"incidents": incidents, "total": len(incidents)}
