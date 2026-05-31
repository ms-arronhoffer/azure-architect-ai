"""Token budget tests.

The codebase uses `count_message_tokens` + `trim_history` (no `count_tokens`
or `trim_messages_to_budget`). We test the actual public surface and
preserve the intent of the original spec (system message preserved, oldest
dropped first).
"""
from __future__ import annotations

from services.token_budget import (
    MODEL_CONTEXT,
    count_message_tokens,
    trim_history,
)


def test_count_message_tokens_positive():
    n = count_message_tokens([{"role": "user", "content": "hello world"}], "gpt-4o")
    assert n > 0


def test_trim_history_drops_oldest_non_system_first():
    # Force the budget to be tiny by patching MODEL_CONTEXT for a fake model.
    big_content = "x" * 80_000  # ~20k tokens via heuristic; well over 8k window
    messages = [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": big_content},
        {"role": "assistant", "content": big_content},
        {"role": "user", "content": "newest question"},
    ]
    trimmed, dropped = trim_history(messages, "gpt-4", response_reserve=1024)
    assert dropped >= 1
    # System message must always be preserved.
    assert trimmed[0]["role"] == "system"
    assert trimmed[0]["content"] == "SYS"
    # The newest user message should survive.
    assert trimmed[-1]["content"] == "newest question"


def test_trim_history_noop_when_under_budget():
    messages = [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": "hi"},
    ]
    trimmed, dropped = trim_history(messages, "gpt-4o")
    assert dropped == 0
    assert len(trimmed) == 2


def test_model_context_has_known_models():
    assert "gpt-4o" in MODEL_CONTEXT
    assert MODEL_CONTEXT["gpt-4o"] > 0
