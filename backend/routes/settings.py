from fastapi import APIRouter, HTTPException
from models import UserSettings
from services.settings_service import load_settings, save_settings
from middleware.logging import get_logger

router = APIRouter()
_log = get_logger("settings")


@router.get("/settings", response_model=UserSettings)
async def get_settings():
    return await load_settings()


@router.post("/settings", response_model=UserSettings)
async def post_settings(body: UserSettings):
    try:
        await save_settings(body)
    except Exception as exc:
        _log.error("settings.save_failed", error=str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save settings") from exc
    return body
