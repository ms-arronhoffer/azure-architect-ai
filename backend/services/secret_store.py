"""Encrypted per-user secret storage backed by the UserSecret table.

Uses Fernet symmetric encryption. The key comes from settings.secret_encryption_key.
For single-user dev mode (auth disabled) the user_id is "default".
"""
from __future__ import annotations

import datetime as dt

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import UserSecret, select

DEFAULT_USER_ID = "default"


class SecretStoreError(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = settings.secret_encryption_key
    if not key:
        raise SecretStoreError(
            "secret_encryption_key not configured. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        raise SecretStoreError(f"Invalid secret_encryption_key: {e}") from e


async def set_secret(session: AsyncSession, user_id: str, name: str, value: str) -> None:
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    existing = await session.get(UserSecret, (user_id, name))
    if existing is None:
        session.add(
            UserSecret(
                user_id=user_id,
                name=name,
                value_encrypted=token,
                updated_at=dt.datetime.now(dt.UTC),
            )
        )
    else:
        existing.value_encrypted = token
        existing.updated_at = dt.datetime.now(dt.UTC)
    await session.commit()


async def get_secret(session: AsyncSession, user_id: str, name: str) -> str | None:
    row = await session.get(UserSecret, (user_id, name))
    if row is None:
        return None
    try:
        return _fernet().decrypt(row.value_encrypted.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


async def delete_secret(session: AsyncSession, user_id: str, name: str) -> bool:
    row = await session.get(UserSecret, (user_id, name))
    if row is None:
        return False
    await session.delete(row)
    await session.commit()
    return True


async def has_secret(session: AsyncSession, user_id: str, name: str) -> bool:
    row = (
        await session.execute(
            select(UserSecret.user_id).where(
                UserSecret.user_id == user_id, UserSecret.name == name
            )
        )
    ).first()
    return row is not None
