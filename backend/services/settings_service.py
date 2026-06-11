import asyncio
import json
import os
from pathlib import Path

from models import UserSettings

_DATA_DIR = Path("data")
SETTINGS_PATH = _DATA_DIR / "user_settings.json"
_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


async def load_settings() -> UserSettings:
    async with _get_lock():
        if not SETTINGS_PATH.exists():
            return UserSettings()
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            return UserSettings.model_validate(data)
        except Exception:
            return UserSettings()


async def save_settings(s: UserSettings) -> None:
    async with _get_lock():
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_PATH.with_suffix(".tmp")
        tmp.write_text(s.model_dump_json(indent=2), encoding="utf-8")
        os.replace(tmp, SETTINGS_PATH)
