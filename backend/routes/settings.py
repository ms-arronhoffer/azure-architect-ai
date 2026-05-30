from fastapi import APIRouter
from models import UserSettings
from services.settings_service import load_settings, save_settings

router = APIRouter()


@router.get("/settings", response_model=UserSettings)
async def get_settings():
    return await load_settings()


@router.post("/settings", response_model=UserSettings)
async def post_settings(body: UserSettings):
    await save_settings(body)
    return body
