"""Runtime feature-flag readers.

Centralizes flag resolution so routes (and the `/api/config` endpoint that the
frontend reads at runtime) agree on the same source of truth. Flags are read
from the process environment on each call so an operator can flip them without
a rebuild — only a backend restart with the new env value is required.
"""

import os

_TRUTHY = {"1", "true", "yes", "on"}


def unified_agents_enabled() -> bool:
    """Whether the 5-agent unified surface is active (opt-in default).

    Set ``UNIFIED_AGENTS=true`` (or ``1``/``yes``/``on``) to enable the 5-agent
    unified surface. Anything else — including an unset variable — resolves to
    the legacy 84-mode routing.
    """
    return os.getenv("UNIFIED_AGENTS", "").strip().lower() in _TRUTHY


def custom_skills_enabled() -> bool:
    """Whether the per-user Custom Skills + Skill Showcase surface is active.

    On by default. Set ``CUSTOM_SKILLS`` to a falsy value (``false``/``0``/
    ``no``/``off``) to disable user-uploaded skill packages and the skill
    showcase. An unset or truthy value keeps the feature enabled.
    """
    raw = os.getenv("CUSTOM_SKILLS", "").strip().lower()
    if not raw:
        return True
    return raw in _TRUTHY
