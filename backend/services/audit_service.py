"""Inbound-request secret scanning + append-only audit log.

Operates in two modes, controlled by `settings.audit_redaction_shadow_mode`:

- Shadow (default): scan and LOG hits, but never mutate the request body.
- Enforce: replace matched spans with `[REDACTED:<kind>]` before handing
  the body to FastAPI handlers.

The scanner is intentionally conservative — false positives in shadow mode
just generate audit log noise; false positives in enforce mode would corrupt
legitimate prompts. Operators should run a week in shadow before flipping.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from db import AuditEvent, session_scope

# (kind, regex) — order matters only for overlap reporting; matches are deduped
# by kind in the audit log.
_PATTERNS: list[tuple[str, re.Pattern[bytes]]] = [
    ("jwt", re.compile(rb"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")),
    ("github_pat", re.compile(rb"\bghp_[A-Za-z0-9]{36}\b")),
    ("github_fine_grained_pat", re.compile(rb"\bgithub_pat_[A-Za-z0-9_]{82}\b")),
    ("aws_access_key", re.compile(rb"\bAKIA[0-9A-Z]{16}\b")),
    ("azure_storage_key", re.compile(rb"AccountKey=[A-Za-z0-9+/=]{64,}")),
    ("aoai_key", re.compile(rb"\b[a-f0-9]{32}\b")),  # 32-hex (low precision; shadow only by default)
    ("connection_string_password", re.compile(rb"(?i)Password=[^;\s\"']{4,}")),
    ("bearer_header_inline", re.compile(rb"(?i)Bearer\s+[A-Za-z0-9._\-]{20,}")),
]


def scan_for_secrets(body: bytes) -> list[str]:
    """Return distinct kinds matched. Empty list = clean."""
    if not body:
        return []
    hits: set[str] = set()
    for kind, pat in _PATTERNS:
        if pat.search(body):
            hits.add(kind)
    return sorted(hits)


def redact(body: bytes) -> bytes:
    """Replace every match with `[REDACTED:<kind>]`. Only call in enforce mode."""
    out = body
    for kind, pat in _PATTERNS:
        out = pat.sub(f"[REDACTED:{kind}]".encode(), out)
    return out


async def record_audit(
    user_id: str,
    request_id: str | None,
    method: str,
    path: str,
    status_code: int,
    duration_ms: int,
    secret_hit_kinds: list[str],
    client_ip: str | None,
) -> None:
    """Fire-and-forget audit insert. Swallows all exceptions."""
    try:
        async with session_scope() as session:
            session.add(AuditEvent(
                user_id=user_id,
                request_id=request_id,
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
                secret_hit_kinds=secret_hit_kinds,
                client_ip=client_ip,
                created_at=int(time.time() * 1000),
            ))
            await session.commit()
    except Exception:
        pass


def schedule_audit(*args: Any, **kwargs: Any) -> None:
    asyncio.create_task(record_audit(*args, **kwargs))  # noqa: RUF006
