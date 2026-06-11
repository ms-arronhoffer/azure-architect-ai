import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import require_metrics_role
from db import Conversation, get_session

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/metrics")
async def get_metrics(
    _: dict[str, Any] = Depends(require_metrics_role),
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    # Mode breakdown
    mode_rows = (await db.execute(
        select(Conversation.mode, func.count().label("count"))
        .group_by(Conversation.mode)
        .order_by(func.count().desc())
    )).all()
    mode_counts = [{"mode": r.mode, "count": r.count} for r in mode_rows]

    # DAU — last 30 days, bucketed by day (unix day = created_at // 86400)
    thirty_days_ago = int(time.time()) - 30 * 86400
    day_bucket = (Conversation.created_at // 86400 * 86400).label("day")
    dau_rows = (await db.execute(
        select(
            day_bucket,
            func.count(func.distinct(Conversation.user_id)).label("users"),
            func.count().label("conversations"),
        )
        .where(Conversation.created_at >= thirty_days_ago)
        .group_by(day_bucket)
        .order_by(day_bucket)
    )).all()
    dau = [{"day": r.day, "users": r.users, "conversations": r.conversations} for r in dau_rows]

    # Top users by conversation count
    user_rows = (await db.execute(
        select(Conversation.user_id, func.count().label("count"))
        .where(Conversation.user_id.isnot(None))
        .group_by(Conversation.user_id)
        .order_by(func.count().desc())
        .limit(20)
    )).all()
    top_users = [{"user_id": r.user_id, "count": r.count} for r in user_rows]

    total = await db.scalar(select(func.count()).select_from(Conversation)) or 0
    unique_users = await db.scalar(
        select(func.count(func.distinct(Conversation.user_id))).select_from(Conversation)
    ) or 0

    # Active today
    today_start = (int(time.time()) // 86400) * 86400
    active_today = await db.scalar(
        select(func.count(func.distinct(Conversation.user_id)))
        .where(Conversation.created_at >= today_start)
    ) or 0

    return {
        "total_conversations": total,
        "unique_users": unique_users,
        "active_today": active_today,
        "mode_breakdown": mode_counts,
        "dau_30d": dau,
        "top_users": top_users,
    }
