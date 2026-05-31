from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db import Conversation, get_session, select

router = APIRouter()


class ConversationRecord(BaseModel):
    id: str
    mode: str
    title: str
    createdAt: int
    updatedAt: int
    messages: list
    structuredResult: str | None = None


@router.get("/conversations")
async def list_conversations(session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            select(Conversation).order_by(Conversation.updated_at.desc())
        )
    ).scalars().all()
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


@router.post("/conversations", status_code=200)
async def upsert_conversation(
    record: ConversationRecord,
    session: AsyncSession = Depends(get_session),
):
    existing = await session.get(Conversation, record.id)
    if existing is None:
        session.add(
            Conversation(
                id=record.id,
                mode=record.mode,
                title=record.title,
                created_at=record.createdAt,
                updated_at=record.updatedAt,
                messages=record.messages,
                structured_result=record.structuredResult,
            )
        )
    else:
        existing.mode = record.mode
        existing.title = record.title
        existing.updated_at = record.updatedAt
        existing.messages = record.messages
        existing.structured_result = record.structuredResult
    await session.commit()
    return {"ok": True}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
):
    obj = await session.get(Conversation, conversation_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(obj)
    await session.commit()
    return {"ok": True}


@router.delete("/conversations")
async def clear_conversations(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Conversation))).scalars().all()
    for r in rows:
        await session.delete(r)
    await session.commit()
    return {"ok": True}
