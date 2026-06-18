"""Five agent prompts that replace the 84-mode catalog.

The original `system_prompt.MODE_TEMPLATES` is retained for the
compatibility shim; new chats go through these. Each prompt is the *base*
identity — the chat route splices in:

  1. Engagement preamble (from `engagement_context.preamble_for_active`).
  2. Selected domain fragments (from `prompts.domain_fragments`).
  3. The agent's own body (below).

So the bodies here intentionally do NOT repeat boilerplate about RAG
citations, JSON formatting, or tool calling — those live in the shared
preamble that the chat route prepends.
"""
from .architect import ARCHITECT_PROMPT
from .cost import COST_PROMPT
from .operations import OPERATIONS_PROMPT
from .compliance import COMPLIANCE_PROMPT
from .engagement import ENGAGEMENT_PROMPT

AGENTS: dict[str, str] = {
    "architect": ARCHITECT_PROMPT,
    "cost": COST_PROMPT,
    "operations": OPERATIONS_PROMPT,
    "compliance": COMPLIANCE_PROMPT,
    "engagement": ENGAGEMENT_PROMPT,
}

DEFAULT_AGENT = "architect"


def get_agent_prompt(agent: str) -> str:
    return AGENTS.get(agent, AGENTS[DEFAULT_AGENT])


__all__ = [
    "AGENTS",
    "ARCHITECT_PROMPT",
    "COMPLIANCE_PROMPT",
    "COST_PROMPT",
    "DEFAULT_AGENT",
    "ENGAGEMENT_PROMPT",
    "OPERATIONS_PROMPT",
    "get_agent_prompt",
]
