from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import get_current_user, user_id_from_claims
from db import Conversation, get_session, select

router = APIRouter()


def _uid(claims: dict[str, Any] | None) -> str:
    return user_id_from_claims(claims)


class ConversationRecord(BaseModel):
    id: str
    mode: str
    title: str
    createdAt: int
    updatedAt: int
    messages: list
    structuredResult: str | None = None


@router.get("/conversations")
async def list_conversations(
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
):
    user_id = _uid(claims)
    query = select(Conversation).where(Conversation.user_id == user_id).order_by(Conversation.updated_at.desc())
    rows = (await session.execute(query)).scalars().all()
    return [
        {
            "id": r.id,
            "mode": r.mode,
            "title": r.title,
            "createdAt": r.created_at,
            "updatedAt": r.updated_at,
            "messages": r.messages,
            "structuredResult": r.structured_result,
        }
        for r in rows
    ]


def _apply_update(row: Conversation, record: "ConversationRecord") -> None:
    row.mode = record.mode
    row.title = record.title
    row.updated_at = record.updatedAt
    row.messages = record.messages
    row.structured_result = record.structuredResult


@router.post("/conversations", status_code=200)
async def upsert_conversation(
    record: ConversationRecord,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
):
    user_id = _uid(claims)
    existing = await session.get(Conversation, record.id)
    if existing is not None:
        if existing.user_id and existing.user_id != user_id:
            # Don't leak existence of another user's conversation — 404, not 403.
            raise HTTPException(status_code=404, detail="Not found")
        _apply_update(existing, record)
        if existing.user_id is None:
            existing.user_id = user_id
        await session.commit()
        return {"ok": True}

    session.add(
        Conversation(
            id=record.id,
            mode=record.mode,
            title=record.title,
            created_at=record.createdAt,
            updated_at=record.updatedAt,
            messages=record.messages,
            structured_result=record.structuredResult,
            user_id=user_id,
        )
    )
    try:
        await session.commit()
    except IntegrityError:
        # Concurrent insert won the race — roll back and update the existing row.
        await session.rollback()
        existing = await session.get(Conversation, record.id)
        if existing is None:
            raise
        if existing.user_id and existing.user_id != user_id:
            raise HTTPException(status_code=404, detail="Not found") from None
        _apply_update(existing, record)
        await session.commit()
    return {"ok": True}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
):
    user_id = _uid(claims)
    obj = await session.get(Conversation, conversation_id)
    if obj is None or (obj.user_id and obj.user_id != user_id):
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(obj)
    await session.commit()
    return {"ok": True}


@router.delete("/conversations")
async def clear_conversations(
    session: AsyncSession = Depends(get_session),
    claims: dict[str, Any] | None = Depends(get_current_user),
):
    user_id = _uid(claims)
    query = select(Conversation).where(Conversation.user_id == user_id)
    rows = (await session.execute(query)).scalars().all()
    for r in rows:
        await session.delete(r)
    await session.commit()
    return {"ok": True}
