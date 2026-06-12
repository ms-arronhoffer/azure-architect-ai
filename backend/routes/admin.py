import hashlib
import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from auth.entra import require_metrics_role
from db import Conversation, TokenUsage, get_session

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/metrics")
async def get_metrics(
    _: dict[str, Any] = Depends(require_metrics_role),
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    now = int(time.time())
    thirty_days_ago_ms = (now - 30 * 86400) * 1000
    seven_days_ago_ms = (now - 7 * 86400) * 1000
    today_start_ms = (now // 86400) * 86400 * 1000
    this_week_start_ms = (now - 7 * 86400) * 1000
    prev_week_start_ms = (now - 14 * 86400) * 1000

    # Mode breakdown
    mode_rows = (await db.execute(
        select(Conversation.mode, func.count().label("count"))
        .group_by(Conversation.mode)
        .order_by(func.count().desc())
    )).all()
    mode_counts = [{"mode": r.mode, "count": r.count} for r in mode_rows]

    # DAU — last 30 days, bucketed by day (updated_at reflects last activity, not just creation)
    day_bucket = (Conversation.updated_at // 86400000 * 86400000).label("day")
    dau_rows = (await db.execute(
        select(
            day_bucket,
            func.count(func.distinct(Conversation.user_id)).label("users"),
            func.count().label("conversations"),
        )
        .where(Conversation.updated_at >= thirty_days_ago_ms)
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
    top_users = [
        {"user_id": hashlib.sha256(r.user_id.encode()).hexdigest()[:16], "count": r.count}
        for r in user_rows
    ]

    total = await db.scalar(select(func.count()).select_from(Conversation)) or 0
    unique_users = await db.scalar(
        select(func.count(func.distinct(Conversation.user_id))).select_from(Conversation)
    ) or 0

    # Active users — union conversations + token usage so users with token activity but no
    # saved conversation record are still counted.
    async def _count_active(cutoff_ms: int) -> int:
        conv_q = select(Conversation.user_id.label("user_id")).where(
            Conversation.updated_at >= cutoff_ms,
            Conversation.user_id.isnot(None),
        )
        token_q = select(TokenUsage.user_id.label("user_id")).where(
            TokenUsage.created_at >= cutoff_ms,
            TokenUsage.user_id.isnot(None),
        )
        combined = union(conv_q, token_q).subquery()
        return await db.scalar(select(func.count()).select_from(combined)) or 0

    active_today = await _count_active(today_start_ms)
    weekly_active = await _count_active(seven_days_ago_ms)

    # Avg session duration in minutes (updated_at - created_at for conversations with >0 duration)
    avg_duration_ms = await db.scalar(
        select(func.avg(Conversation.updated_at - Conversation.created_at))
        .where(Conversation.updated_at > Conversation.created_at)
    ) or 0
    avg_duration_min = round(avg_duration_ms / 60000, 1)

    # Output rate — conversations that generated a structured result
    with_output = await db.scalar(
        select(func.count())
        .where(Conversation.structured_result.isnot(None))
        .select_from(Conversation)
    ) or 0
    output_rate_pct = round((with_output / total * 100) if total else 0, 1)

    # Week-over-week growth (conversations this week vs prior week)
    this_week = await db.scalar(
        select(func.count()).where(Conversation.created_at >= this_week_start_ms).select_from(Conversation)
    ) or 0
    prev_week = await db.scalar(
        select(func.count())
        .where(Conversation.created_at >= prev_week_start_ms)
        .where(Conversation.created_at < this_week_start_ms)
        .select_from(Conversation)
    ) or 0
    wow_pct = round(((this_week - prev_week) / prev_week * 100) if prev_week else 0, 1)

    # Token usage by model (last 30 days)
    model_token_rows = (await db.execute(
        select(
            TokenUsage.model,
            func.sum(TokenUsage.prompt_tokens).label("prompt"),
            func.sum(TokenUsage.completion_tokens).label("completion"),
        )
        .where(TokenUsage.created_at >= thirty_days_ago_ms)
        .group_by(TokenUsage.model)
        .order_by((func.sum(TokenUsage.prompt_tokens) + func.sum(TokenUsage.completion_tokens)).desc())
    )).all()
    token_by_model = [
        {
            "model": r.model,
            "prompt_tokens": int(r.prompt or 0),
            "completion_tokens": int(r.completion or 0),
        }
        for r in model_token_rows
    ]

    # Token usage by user (last 30 days, hashed)
    user_token_rows = (await db.execute(
        select(
            TokenUsage.user_id,
            func.sum(TokenUsage.prompt_tokens).label("prompt"),
            func.sum(TokenUsage.completion_tokens).label("completion"),
        )
        .where(TokenUsage.created_at >= thirty_days_ago_ms)
        .group_by(TokenUsage.user_id)
        .order_by((func.sum(TokenUsage.prompt_tokens) + func.sum(TokenUsage.completion_tokens)).desc())
        .limit(20)
    )).all()
    token_by_user = [
        {
            "user_id": hashlib.sha256(r.user_id.encode()).hexdigest()[:16],
            "prompt_tokens": int(r.prompt or 0),
            "completion_tokens": int(r.completion or 0),
        }
        for r in user_token_rows
    ]

    return {
        "total_conversations": total,
        "unique_users": unique_users,
        "active_today": active_today,
        "weekly_active": weekly_active,
        "avg_duration_min": avg_duration_min,
        "output_rate_pct": output_rate_pct,
        "wow_pct": wow_pct,
        "mode_breakdown": mode_counts,
        "dau_30d": dau,
        "top_users": top_users,
        "token_by_model": token_by_model,
        "token_by_user": token_by_user,
    }
