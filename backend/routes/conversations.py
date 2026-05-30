import json
import aiosqlite
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from db import DB_PATH

router = APIRouter()


class ConversationRecord(BaseModel):
    id: str
    mode: str
    title: str
    createdAt: int
    updatedAt: int
    messages: list


@router.get("/conversations")
async def list_conversations():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, mode, title, created_at, updated_at, messages FROM conversations ORDER BY updated_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "mode": r["mode"],
            "title": r["title"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
            "messages": json.loads(r["messages"]),
        }
        for r in rows
    ]


@router.post("/conversations", status_code=200)
async def upsert_conversation(record: ConversationRecord):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO conversations (id, mode, title, created_at, updated_at, messages)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                mode       = excluded.mode,
                title      = excluded.title,
                updated_at = excluded.updated_at,
                messages   = excluded.messages
            """,
            (
                record.id,
                record.mode,
                record.title,
                record.createdAt,
                record.updatedAt,
                json.dumps(record.messages),
            ),
        )
        await db.commit()
    return {"ok": True}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute(
            "DELETE FROM conversations WHERE id = ?", (conversation_id,)
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.delete("/conversations")
async def clear_conversations():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM conversations")
        await db.commit()
    return {"ok": True}
