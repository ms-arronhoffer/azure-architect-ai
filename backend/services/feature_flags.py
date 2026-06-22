"""Runtime feature-flag readers.

Centralizes flag resolution so routes (and the `/api/config` endpoint that the
frontend reads at runtime) agree on the same source of truth. Flags are read
from the process environment on each call so an operator can flip them without
a rebuild — only a backend restart with the new env value is required.
"""

import os

_FALSEY = {"0", "false", "no", "off"}


def unified_agents_enabled() -> bool:
    """Whether the 5-agent unified surface is active (opt-out default).

    Set ``UNIFIED_AGENTS=false`` (or ``0``/``no``/``off``) to fall back to the
    legacy 84-mode routing during the deprecation window. Anything else — including
    an unset variable — resolves to the unified surface.
    """
    return os.getenv("UNIFIED_AGENTS", "").strip().lower() not in _FALSEY
