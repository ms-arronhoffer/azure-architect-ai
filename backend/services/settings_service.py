import asyncio
import json
import os
from pathlib import Path

from models import UserSettings

SETTINGS_PATH = Path("user_settings.json")
_lock = asyncio.Lock()


async def load_settings() -> UserSettings:
    async with _lock:
        if not SETTINGS_PATH.exists():
            return UserSettings()
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            return UserSettings.model_validate(data)
        except Exception:
            return UserSettings()


async def save_settings(s: UserSettings) -> None:
    async with _lock:
        tmp = SETTINGS_PATH.with_suffix(".tmp")
        tmp.write_text(s.model_dump_json(indent=2), encoding="utf-8")
        os.replace(tmp, SETTINGS_PATH)
