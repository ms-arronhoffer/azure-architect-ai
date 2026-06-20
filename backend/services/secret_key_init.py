"""Fernet key bootstrap.

Production deploys are expected to supply ``SECRET_ENCRYPTION_KEY`` via Key
Vault. When the variable is missing (fresh stand-up, dev image, ops forgot the
secret) every call to :mod:`services.secret_store` would otherwise raise
``SecretStoreError`` and silently break PAT save.

This module bootstraps a key into a tiny ``system_config`` table the first
time the app starts without one, then mutates ``settings.secret_encryption_key``
in-process so the rest of the codebase finds it. The table lives outside the
ORM so it can be touched before ``init_db`` finishes and so it does not get
caught by the tenant filter.
"""
from __future__ import annotations

from cryptography.fernet import Fernet
from sqlalchemy import text

from config import settings
from db import _engine
from middleware.logging import get_logger

_KEY_NAME = "fernet_key"
_log = get_logger("secret_key_init")


async def ensure_secret_encryption_key() -> None:
    if settings.secret_encryption_key:
        return

    async with _engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS system_config ("
                "name VARCHAR(64) PRIMARY KEY, value TEXT NOT NULL)"
            )
        )
        row = (
            await conn.execute(
                text("SELECT value FROM system_config WHERE name = :n"),
                {"n": _KEY_NAME},
            )
        ).first()
        if row is None:
            key = Fernet.generate_key().decode("ascii")
            await conn.execute(
                text("INSERT INTO system_config (name, value) VALUES (:n, :v)"),
                {"n": _KEY_NAME, "v": key},
            )
            _log.warning(
                "secret_key.generated",
                detail="SECRET_ENCRYPTION_KEY not set; generated and stored in system_config. "
                "Set the env var via Key Vault for stronger separation.",
            )
        else:
            key = row[0]
            _log.info("secret_key.loaded_from_db")

    settings.secret_encryption_key = key
