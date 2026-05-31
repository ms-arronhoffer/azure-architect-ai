"""Token counting + history trimming.

Uses tiktoken for accurate counts on OpenAI-family models. Falls back to a
char-based heuristic for unknown models so the guard never crashes a request.
"""
from __future__ import annotations

try:
    import tiktoken
except ImportError:  # pragma: no cover
    tiktoken = None  # type: ignore[assignment]

# Per-message overhead from the chat completions tokenization spec.
_PER_MESSAGE_TOKENS = 4
_PER_REPLY_TOKENS = 3

# Conservative model context windows. We always reserve room for the reply.
MODEL_CONTEXT: dict[str, int] = {
    "gpt-4.1": 128_000,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4": 8_192,
    "gpt-3.5-turbo": 16_385,
}

DEFAULT_CONTEXT = 32_000
DEFAULT_RESPONSE_RESERVE = 4_096


def _encoding(model: str):
    if tiktoken is None:
        return None
    try:
        return tiktoken.encoding_for_model(model)
    except (KeyError, ValueError):
        return tiktoken.get_encoding("cl100k_base")


def count_message_tokens(messages: list[dict], model: str) -> int:
    enc = _encoding(model)
    if enc is None:
        # Heuristic: ~4 chars per token.
        total_chars = sum(len(str(m.get("content") or "")) for m in messages)
        return total_chars // 4 + len(messages) * _PER_MESSAGE_TOKENS + _PER_REPLY_TOKENS
    total = _PER_REPLY_TOKENS
    for m in messages:
        total += _PER_MESSAGE_TOKENS
        for v in m.values():
            if v is None:
                continue
            total += len(enc.encode(str(v)))
    return total


def trim_history(
    messages: list[dict],
    model: str,
    response_reserve: int = DEFAULT_RESPONSE_RESERVE,
) -> tuple[list[dict], int]:
    """Drop oldest non-system messages until budget fits. Returns (trimmed, dropped)."""
    budget = MODEL_CONTEXT.get(model, DEFAULT_CONTEXT) - response_reserve
    if budget <= 0:
        return messages, 0

    system_msgs = [m for m in messages if m.get("role") == "system"]
    convo = [m for m in messages if m.get("role") != "system"]
    dropped = 0

    while convo and count_message_tokens(system_msgs + convo, model) > budget:
        convo.pop(0)
        dropped += 1

    return system_msgs + convo, dropped
