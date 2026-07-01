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

import contextlib
from collections import Counter
from typing import Any

from sqlalchemy import select

from db import Engagement, EngagementArtifact, RagDocument, current_engagement_id, session_scope
from middleware.logging import get_logger
from services.rag_service import CORPUS_TENANT_INVENTORY

log = get_logger("engagement_context")

# How many recent workspace artifacts to fold into the preamble. Keeps the
# recall dense enough to be useful without blowing the ~400-token budget.
_MAX_RECALL_ARTIFACTS = 8


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


async def inventory_snapshot(engagement_id: str) -> str | None:
    """Compact narrative summary of the engagement's tenant_inventory corpus.

    Returns a short line like "12 resources (top: VM×5, Storage×3) across
    eastus2/westus; 3 Key Vaults; 2 NSG rules open to 0.0.0.0/0; 4 policy
    findings; MTD $1,234.56 USD" — under ~200 tokens. Returns None when the
    engagement has no inventory yet so the caller can skip the section.
    """
    async with session_scope() as session:
        stmt = (
            select(RagDocument)
            .where(RagDocument.corpus == CORPUS_TENANT_INVENTORY)
            .where(RagDocument.engagement_id == engagement_id)
        )
        rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return None

    fact_kinds: Counter[str] = Counter()
    resource_types: Counter[str] = Counter()
    regions: Counter[str] = Counter()
    open_ports: Counter[str] = Counter()
    cost_total = 0.0
    currency: str | None = None
    advisor_high = 0
    policy_findings = 0
    for row in rows:
        meta = row.doc_metadata or {}
        kind = meta.get("fact_kind") or "unknown"
        fact_kinds[kind] += 1
        if kind == "resource":
            rtype = meta.get("resource_type") or "unknown"
            # Collapse to short last-segment label (e.g. Microsoft.Compute/virtualMachines → virtualMachines)
            short = rtype.rsplit("/", 1)[-1] if "/" in rtype else rtype
            resource_types[short] += 1
            if meta.get("region"):
                regions[meta["region"]] += 1
        elif kind == "open_nsg_rule":
            port = str(meta.get("destination_port") or "*")
            open_ports[port] += 1
        elif kind == "policy_noncompliance":
            policy_findings += 1
        elif kind == "advisor_recommendation":
            if (meta.get("impact") or "").lower() == "high":
                advisor_high += 1
        elif kind == "cost_mtd":
            with contextlib.suppress(TypeError, ValueError):
                cost_total += float(meta.get("total_cost") or 0.0)
            if not currency:
                currency = meta.get("currency")

    fragments: list[str] = []
    total_resources = fact_kinds.get("resource", 0)
    if total_resources:
        top_types = ", ".join(f"{name}×{count}" for name, count in resource_types.most_common(3))
        region_list = ", ".join(name for name, _ in regions.most_common(3)) or "unknown"
        fragments.append(f"{total_resources} resources (top: {top_types}) across {region_list}")
    public_ip_count = fact_kinds.get("public_ip", 0)
    if public_ip_count:
        fragments.append(f"{public_ip_count} public IPs")
    open_rule_count = fact_kinds.get("open_nsg_rule", 0)
    if open_rule_count:
        port_summary = ", ".join(f"port {p}" for p, _ in open_ports.most_common(3))
        fragments.append(f"{open_rule_count} NSG rules open to 0.0.0.0/0 ({port_summary})")
    if policy_findings:
        fragments.append(f"{policy_findings} non-compliant policy findings")
    if advisor_high:
        fragments.append(f"{advisor_high} high-impact Advisor recs")
    if cost_total > 0:
        fragments.append(f"MTD ~{cost_total:,.2f} {currency or 'USD'}")

    if not fragments:
        return None
    return "; ".join(fragments)


async def recent_artifacts(engagement_id: str, limit: int = _MAX_RECALL_ARTIFACTS) -> str | None:
    """Compact recall of tool outputs saved against the engagement.

    Returns a short Markdown block listing the most recent workspace artifacts
    (tool · title — summary) so any later tool run — cost, scan, naming,
    landing zone — recalls what earlier tools produced in the same engagement.
    Returns None when the workspace is empty so callers can skip the section.
    """
    async with session_scope() as session:
        rows = (
            (
                await session.execute(
                    select(EngagementArtifact)
                    .where(EngagementArtifact.engagement_id == engagement_id)
                    .order_by(EngagementArtifact.updated_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
    if not rows:
        return None
    lines = ["## Engagement Workspace (saved tool outputs)"]
    for row in rows:
        summary = (row.summary or "").strip().replace("\n", " ")
        if len(summary) > 160:
            summary = summary[:157] + "…"
        label = f"- **{row.tool}** · {row.title}"
        lines.append(f"{label} — {summary}" if summary else label)
    lines.append(
        "- These are prior outputs from this engagement; reuse them for "
        "continuity instead of re-deriving, and note when you build on them."
    )
    lines.append("")
    return "\n".join(lines)


async def preamble_for_active() -> str:
    """Return the formatted preamble for the active engagement, or "" when
    none is set. Safe to unconditionally concatenate into a system prompt.
    """
    eng = await load_active()
    if eng is None:
        return ""
    try:
        base = format_preamble(eng)
    except Exception as exc:
        log.warning("engagement.preamble_failed", engagement_id=eng.id, error=str(exc))
        return ""
    lines = base.rstrip("\n").split("\n")
    try:
        snapshot = await inventory_snapshot(eng.id)
    except Exception as exc:
        log.warning("engagement.inventory_snapshot_failed", engagement_id=eng.id, error=str(exc))
        snapshot = None
    if snapshot:
        # Insert before the trailing blank line so the preamble stays a single block.
        lines.append(f"- **Tenant Inventory Snapshot**: {snapshot}")
        lines.append(
            "- This snapshot is a per-engagement RAG corpus; full details are "
            "retrievable via citations when the design prompt needs them."
        )
    try:
        artifacts = await recent_artifacts(eng.id)
    except Exception as exc:
        log.warning("engagement.recent_artifacts_failed", engagement_id=eng.id, error=str(exc))
        artifacts = None
    lines.append("")
    if artifacts:
        lines.append(artifacts.rstrip("\n"))
        lines.append("")
    return "\n".join(lines)


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


__all__ = [
    "format_preamble",
    "inventory_snapshot",
    "load",
    "load_active",
    "preamble_for_active",
    "recent_artifacts",
    "recent_artifacts",
    "to_dict",
]
