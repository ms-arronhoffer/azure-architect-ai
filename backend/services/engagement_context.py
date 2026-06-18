"""Render an Engagement row into a compact preamble that prefixes the
system prompt for any chat in that engagement's scope.

Target budget: ~400 tokens. Keeps the model anchored to the customer's
industry, compliance constraints, region preference, and reservation
commitments so cost/scan answers don't get re-asked every turn.

Honesty note: this preamble is *context*, not *authority*. The model
still cites RAG when making factual claims; the preamble exists so the
model knows which subscriptions to scope live tools to and what
regulatory boundary applies.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from db import Engagement, current_engagement_id, session_scope
from middleware.logging import get_logger

log = get_logger("engagement_context")


async def load_active() -> Engagement | None:
    """Load the engagement pointed to by `engagement_id_var`, or None."""
    eid = current_engagement_id()
    if not eid:
        return None
    return await load(eid)


async def load(engagement_id: str) -> Engagement | None:
    async with session_scope() as session:
        result = await session.execute(
            select(Engagement).where(Engagement.id == engagement_id)
        )
        return result.scalar_one_or_none()


def format_preamble(engagement: Engagement) -> str:
    """Render the engagement as a short Markdown block. Keep it dense —
    the model needs to absorb it without spending the user's token budget."""
    parts: list[str] = ["## Engagement Context"]
    parts.append(f"- **Customer**: {engagement.customer_name or engagement.name}")
    if engagement.industry:
        parts.append(f"- **Industry**: {engagement.industry}")
    if engagement.region_preference:
        parts.append(f"- **Preferred region**: {engagement.region_preference}")
    if engagement.compliance_frameworks:
        joined = ", ".join(str(f) for f in engagement.compliance_frameworks)
        parts.append(f"- **Compliance**: {joined}")
    subs = engagement.subscription_ids or []
    if subs:
        shown = ", ".join(subs[:3])
        suffix = f" (+{len(subs) - 3} more)" if len(subs) > 3 else ""
        parts.append(f"- **In-scope subscriptions**: {shown}{suffix}")
        parts.append(
            "- Cost, scan, right-sizing, and reservation tools must scope to "
            "these subscriptions unless the user explicitly overrides."
        )
    commits = engagement.reservation_commitments or {}
    if commits:
        commit_lines = ", ".join(f"{k}: {v}" for k, v in commits.items())
        parts.append(f"- **Existing reservations / savings plans**: {commit_lines}")
        parts.append(
            "- Apply reservation discounts when emitting cost estimates."
        )
    if engagement.notes:
        notes = engagement.notes.strip().replace("\n", " ")
        if len(notes) > 400:
            notes = notes[:397] + "…"
        parts.append(f"- **Notes**: {notes}")
    parts.append("")
    return "\n".join(parts)


async def preamble_for_active() -> str:
    """Return the formatted preamble for the active engagement, or "" when
    none is set. Safe to unconditionally concatenate into a system prompt.
    """
    eng = await load_active()
    if eng is None:
        return ""
    try:
        return format_preamble(eng)
    except Exception as exc:
        log.warning("engagement.preamble_failed", engagement_id=eng.id, error=str(exc))
        return ""


def to_dict(engagement: Engagement) -> dict[str, Any]:
    return {
        "id": engagement.id,
        "name": engagement.name,
        "customer_name": engagement.customer_name,
        "industry": engagement.industry,
        "compliance_frameworks": list(engagement.compliance_frameworks or []),
        "subscription_ids": list(engagement.subscription_ids or []),
        "region_preference": engagement.region_preference,
        "notes": engagement.notes,
        "reservation_commitments": dict(engagement.reservation_commitments or {}),
        "status": engagement.status,
        "user_id": engagement.user_id,
        "created_at": engagement.created_at,
        "updated_at": engagement.updated_at,
    }


__all__ = ["format_preamble", "load", "load_active", "preamble_for_active", "to_dict"]
