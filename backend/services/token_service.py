import asyncio
import time

from sqlalchemy import func, select

from config import settings
from db import TokenUsage, current_tenant_id, current_user_id, session_scope

# Reference to the application's main event loop, captured at startup. Used to
# schedule fire-and-forget usage writes from worker threads (e.g. LLM calls run
# via asyncio.to_thread in the cost/demo pipelines) where there is no running
# loop of their own.
_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Record the main event loop so thread-bound callers can schedule writes."""
    global _main_loop
    _main_loop = loop


async def record_usage(
    user_id: str,
    model: str,
    mode: str,
    prompt_tokens: int,
    completion_tokens: int,
    tenant_id: str | None = None,
) -> None:
    """Fire-and-forget: persist one token-usage record. Swallows all exceptions."""
    try:
        async with session_scope() as session:
            row = TokenUsage(
                user_id=user_id,
                model=model,
                mode=mode,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                created_at=int(time.time() * 1000),
            )
            # Pin the tenant explicitly when provided so attribution survives
            # being scheduled onto a different loop/thread, where the
            # request-scoped tenant ContextVar would otherwise be lost.
            if tenant_id is not None:
                row.tenant_id = tenant_id
            session.add(row)
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


def record_llm_usage(
    model: str,
    mode: str,
    prompt_tokens: int,
    completion_tokens: int,
    user_id: str | None = None,
) -> None:
    """Record token usage for an arbitrary LLM call, attributed to the current user.

    Resolves the user from the request-scoped ContextVar when not supplied, so
    calls made deep inside services (cost/demo pipelines, agent router,
    reranker, embeddings) are captured without re-plumbing the user id through
    every call site. Best-effort and never raises: background/system work with
    no user in scope is intentionally skipped to avoid noise.

    Safe to call from a worker thread (e.g. asyncio.to_thread): falls back to
    the captured main loop via run_coroutine_threadsafe when no loop is running
    on the current thread.
    """
    if not (prompt_tokens or completion_tokens):
        return
    uid = user_id or current_user_id()
    if not uid:
        return
    tenant_id = current_tenant_id()
    coro = record_usage(uid, model, mode, prompt_tokens, completion_tokens, tenant_id)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)  # noqa: RUF006 — fire-and-forget usage write
        return
    except RuntimeError:
        pass
    # No running loop on this thread (e.g. asyncio.to_thread worker). Hand off
    # to the main loop if it is available and running.
    if _main_loop is not None and _main_loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
            return
        except Exception:
            pass
    # Nowhere to schedule it — close the coroutine to avoid a warning.
    coro.close()


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

