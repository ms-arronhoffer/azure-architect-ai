import asyncio
import time

from sqlalchemy import func, select

from config import settings
from db import TokenUsage, session_scope


async def record_usage(
    user_id: str,
    model: str,
    mode: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    """Fire-and-forget: persist one token-usage record. Swallows all exceptions."""
    try:
        async with session_scope() as session:
            session.add(TokenUsage(
                user_id=user_id,
                model=model,
                mode=mode,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                created_at=int(time.time() * 1000),
            ))
            await session.commit()
    except Exception:
        pass


def schedule_record_usage(
    user_id: str,
    model: str,
    mode: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    """Create an asyncio task to record usage. Call from inside an async context."""
    if prompt_tokens or completion_tokens:
        asyncio.create_task(record_usage(user_id, model, mode, prompt_tokens, completion_tokens))  # noqa: RUF006


_DAY_MS = 24 * 60 * 60 * 1000


async def daily_usage_tokens(user_id: str) -> int:
    """Sum prompt + completion tokens charged to this user in the last 24h."""
    cutoff = int(time.time() * 1000) - _DAY_MS
    try:
        async with session_scope() as session:
            stmt = select(
                func.coalesce(func.sum(TokenUsage.prompt_tokens + TokenUsage.completion_tokens), 0)
            ).where(TokenUsage.user_id == user_id, TokenUsage.created_at >= cutoff)
            row = (await session.execute(stmt)).scalar_one()
            return int(row or 0)
    except Exception:
        # Budget check must never crash a request — fail open.
        return 0


async def check_daily_budget(user_id: str) -> tuple[bool, int, int]:
    """Return (allowed, used_tokens, limit). Fails open on errors."""
    limit = settings.daily_token_budget_per_user
    if limit <= 0:
        return True, 0, 0
    used = await daily_usage_tokens(user_id)
    return used < limit, used, limit

