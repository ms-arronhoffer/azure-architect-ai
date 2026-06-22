"""Demo build pipeline prompts.

Each module exposes a single template string with `{...}` placeholders. The
templates are derived from `demo-factory/.claude/commands/demo-factory.md`
phases 2-4, adapted for backend SSE orchestration (no human-in-the-loop,
strict JSON output from the build agents).
"""

from prompts.demo.architecture_design import ARCHITECTURE_DESIGN_PROMPT
from prompts.demo.code_agent import CODE_AGENT_PROMPT
from prompts.demo.docs_agent import DOCS_AGENT_PROMPT
from prompts.demo.infra_agent import INFRA_AGENT_PROMPT
from prompts.demo.recommendations import RECOMMENDATIONS_PROMPT

__all__ = [
    "ARCHITECTURE_DESIGN_PROMPT",
    "CODE_AGENT_PROMPT",
    "DOCS_AGENT_PROMPT",
    "INFRA_AGENT_PROMPT",
    "RECOMMENDATIONS_PROMPT",
]
