import asyncio
import time

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
