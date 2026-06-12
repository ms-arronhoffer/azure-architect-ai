import hashlib
import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text, union
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

    # ── totals ────────────────────────────────────────────────────────────────
    total = await db.scalar(select(func.count()).select_from(Conversation)) or 0
    unique_users = await db.scalar(
        select(func.count(func.distinct(Conversation.user_id))).select_from(Conversation)
    ) or 0

    # ── active users (union conversations + token usage) ──────────────────────
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
    stickiness_pct = round((active_today / weekly_active * 100) if weekly_active else 0, 1)

    # ── session duration ──────────────────────────────────────────────────────
    avg_duration_ms = await db.scalar(
        select(func.avg(Conversation.updated_at - Conversation.created_at))
        .where(Conversation.updated_at > Conversation.created_at)
    ) or 0
    avg_duration_min = round(avg_duration_ms / 60000, 1)

    # ── output rate (all-up) ──────────────────────────────────────────────────
    with_output = await db.scalar(
        select(func.count())
        .where(Conversation.structured_result.isnot(None))
        .select_from(Conversation)
    ) or 0
    output_rate_pct = round((with_output / total * 100) if total else 0, 1)

    # ── week-over-week growth ─────────────────────────────────────────────────
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

    # ── engagement depth ──────────────────────────────────────────────────────
    # Average messages per conversation (json_array_length works in PostgreSQL + SQLite 3.38+)
    avg_msgs_raw = await db.scalar(
        select(func.avg(func.json_array_length(Conversation.messages)))
        .where(func.json_array_length(Conversation.messages) > 0)
    ) or 0
    avg_msgs_per_conv = round(float(avg_msgs_raw), 1)

    # Abandonment — conversations with ≤ 2 messages (≤ 1 user turn)
    abandoned = await db.scalar(
        select(func.count())
        .where(func.json_array_length(Conversation.messages) <= 2)
        .select_from(Conversation)
    ) or 0
    abandonment_rate_pct = round((abandoned / total * 100) if total else 0, 1)

    # ── retention ─────────────────────────────────────────────────────────────
    # New users — first conversation within last 7 days
    first_seen_sq = (
        select(
            Conversation.user_id,
            func.min(Conversation.created_at).label("first_seen"),
        )
        .where(Conversation.user_id.isnot(None))
        .group_by(Conversation.user_id)
        .subquery()
    )
    new_users_7d = await db.scalar(
        select(func.count())
        .select_from(first_seen_sq)
        .where(first_seen_sq.c.first_seen >= seven_days_ago_ms)
    ) or 0

    # Return rate — of users active 7-14 days ago, % who returned this week
    prev_week_active_users = (
        select(Conversation.user_id)
        .where(
            Conversation.updated_at >= prev_week_start_ms,
            Conversation.updated_at < this_week_start_ms,
            Conversation.user_id.isnot(None),
        )
        .distinct()
    )
    prev_week_user_count = await db.scalar(
        select(func.count()).select_from(prev_week_active_users.subquery())
    ) or 0
    returned_count = await db.scalar(
        select(func.count(func.distinct(Conversation.user_id)))
        .where(
            Conversation.updated_at >= this_week_start_ms,
            Conversation.user_id.isnot(None),
            Conversation.user_id.in_(prev_week_active_users),
        )
    ) or 0
    return_rate_7d = round((returned_count / prev_week_user_count * 100) if prev_week_user_count else 0, 1)

    # ── feature adoption ──────────────────────────────────────────────────────
    # Mode diversity — avg distinct modes used per user
    modes_per_user_sq = (
        select(
            Conversation.user_id,
            func.count(func.distinct(Conversation.mode)).label("mode_count"),
        )
        .where(Conversation.user_id.isnot(None))
        .group_by(Conversation.user_id)
        .subquery()
    )
    avg_diversity_raw = await db.scalar(
        select(func.avg(modes_per_user_sq.c.mode_count))
    ) or 1.0
    mode_diversity = round(float(avg_diversity_raw), 1)

    # Output rate per mode
    mode_output_rows = (await db.execute(
        select(
            Conversation.mode,
            func.count().label("total"),
            func.count(Conversation.structured_result).label("with_output"),
        )
        .group_by(Conversation.mode)
        .order_by(func.count().desc())
    )).all()
    output_rate_by_mode = [
        {
            "mode": r.mode,
            "total": r.total,
            "output_rate_pct": round((r.with_output / r.total * 100) if r.total else 0, 1),
        }
        for r in mode_output_rows
    ]

    # ── mode breakdown ────────────────────────────────────────────────────────
    mode_rows = (await db.execute(
        select(Conversation.mode, func.count().label("count"))
        .group_by(Conversation.mode)
        .order_by(func.count().desc())
    )).all()
    mode_counts = [{"mode": r.mode, "count": r.count} for r in mode_rows]

    # ── DAU 30d (union conversations + token usage) ───────────────────────────
    conv_day_q = select(
        (Conversation.updated_at // 86400000 * 86400000).label("day"),
        Conversation.user_id.label("user_id"),
    ).where(Conversation.updated_at >= thirty_days_ago_ms, Conversation.user_id.isnot(None))
    token_day_q = select(
        (TokenUsage.created_at // 86400000 * 86400000).label("day"),
        TokenUsage.user_id.label("user_id"),
    ).where(TokenUsage.created_at >= thirty_days_ago_ms, TokenUsage.user_id.isnot(None))
    combined_days = union(conv_day_q, token_day_q).subquery()
    dau_user_rows = (await db.execute(
        select(
            combined_days.c.day,
            func.count(func.distinct(combined_days.c.user_id)).label("users"),
        )
        .group_by(combined_days.c.day)
        .order_by(combined_days.c.day)
    )).all()
    conv_count_rows = (await db.execute(
        select(
            (Conversation.updated_at // 86400000 * 86400000).label("day"),
            func.count().label("conversations"),
        )
        .where(Conversation.updated_at >= thirty_days_ago_ms)
        .group_by(text("day"))
        .order_by(text("day"))
    )).all()
    conv_count_by_day = {r.day: r.conversations for r in conv_count_rows}
    dau = [
        {"day": r.day, "users": r.users, "conversations": conv_count_by_day.get(r.day, 0)}
        for r in dau_user_rows
    ]

    # ── top users ─────────────────────────────────────────────────────────────
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

    # ── token usage ───────────────────────────────────────────────────────────
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
        # totals
        "total_conversations": total,
        "unique_users": unique_users,
        "active_today": active_today,
        "weekly_active": weekly_active,
        "avg_duration_min": avg_duration_min,
        "output_rate_pct": output_rate_pct,
        "wow_pct": wow_pct,
        # engagement
        "avg_msgs_per_conv": avg_msgs_per_conv,
        "abandonment_rate_pct": abandonment_rate_pct,
        "stickiness_pct": stickiness_pct,
        # retention
        "new_users_7d": new_users_7d,
        "return_rate_7d": return_rate_7d,
        # feature adoption
        "mode_diversity": mode_diversity,
        "output_rate_by_mode": output_rate_by_mode,
        # tables
        "mode_breakdown": mode_counts,
        "dau_30d": dau,
        "top_users": top_users,
        "token_by_model": token_by_model,
        "token_by_user": token_by_user,
    }
