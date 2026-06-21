"""Per-engagement Azure subscription snapshot → RAG corpus.

Pulls resources, public IPs, open NSG rules, non-compliant policy states,
month-to-date cost shape, and (when MCP is up) Advisor recommendations
for every subscription on an engagement and indexes them as
``corpus="tenant_inventory"`` chunks scoped by ``engagement_id``.

Each fact becomes a small narrative document so the lexical (rapidfuzz)
side of `hybrid_search` has prose to score, with structured fields
(``resource_type``, ``region``, ``subscription_id``, …) preserved in
``doc_metadata`` for downstream filtering. Idempotent — `index_documents`
upserts by SHA1(``source_id``).

Failures in one subscription do not abort the rest; per-stage exceptions
are logged and counted into the returned summary.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
from typing import Any

from db import Engagement, session_scope
from middleware.logging import get_logger
from services import azure_scan_service, cost_service, mcp_service, security_posture_service
from services.rag_service import CORPUS_TENANT_INVENTORY, index_documents

_log = get_logger("tenant_inventory_ingest")

_MCP_ADVISOR_TIMEOUT_S = 15


def _resource_to_doc(engagement_id: str, sub_id: str, res: dict) -> dict[str, Any]:
    name = res.get("name") or "(unnamed)"
    rtype = res.get("type") or "unknown"
    region = res.get("location") or "unknown"
    rg = res.get("resourceGroup") or ""
    sku = res.get("sku") or {}
    sku_name = sku.get("name") if isinstance(sku, dict) else str(sku)
    tags = res.get("tags") or {}
    tag_pairs = ", ".join(f"{k}={v}" for k, v in tags.items()) if tags else "none"
    content_lines = [
        f"Resource {name} (type {rtype}) lives in {region} under resource group {rg} of subscription {sub_id}.",
    ]
    if sku_name:
        content_lines.append(f"SKU: {sku_name}.")
    content_lines.append(f"Tags: {tag_pairs}.")
    return {
        "source_id": f"resource::{res.get('id') or f'{sub_id}/{rtype}/{name}'}",
        "title": f"{name} ({rtype})",
        "url": None,
        "content": "\n".join(content_lines),
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "resource",
            "subscription_id": sub_id,
            "resource_id": res.get("id"),
            "resource_name": name,
            "resource_type": rtype,
            "region": region,
            "resource_group": rg,
            "sku": sku_name,
            "tags": tags,
        },
    }


def _public_ip_to_doc(engagement_id: str, sub_id: str, ip: dict) -> dict[str, Any]:
    name = ip.get("name") or "(unnamed)"
    addr = ip.get("ipAddress") or "unassigned"
    region = ip.get("location") or "unknown"
    rg = ip.get("resourceGroup") or ""
    content = (
        f"Public IP {name} ({addr}) is allocated in {region} under resource group {rg} "
        f"of subscription {sub_id}. Anything attached to it is reachable from the internet."
    )
    return {
        "source_id": f"public_ip::{ip.get('id') or f'{sub_id}/{name}'}",
        "title": f"Public IP {name} ({addr})",
        "url": None,
        "content": content,
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "public_ip",
            "subscription_id": sub_id,
            "resource_id": ip.get("id"),
            "resource_name": name,
            "ip_address": addr,
            "region": region,
            "resource_group": rg,
        },
    }


def _nsg_rule_to_doc(engagement_id: str, sub_id: str, rule: dict) -> dict[str, Any]:
    nsg = rule.get("name") or "(unnamed-nsg)"
    rule_name = rule.get("ruleName") or "(unnamed-rule)"
    port = rule.get("destinationPortRange") or "*"
    proto = rule.get("protocol") or "*"
    rg = rule.get("resourceGroup") or ""
    content = (
        f"NSG {nsg} has inbound rule {rule_name} allowing {proto} on port {port} "
        f"from any source (0.0.0.0/0). Resource group {rg}, subscription {sub_id}."
    )
    return {
        "source_id": f"nsg_rule::{sub_id}/{nsg}/{rule_name}",
        "title": f"Open NSG rule {nsg}/{rule_name} :{port}",
        "url": None,
        "content": content,
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "open_nsg_rule",
            "subscription_id": sub_id,
            "nsg_name": nsg,
            "rule_name": rule_name,
            "destination_port": port,
            "protocol": proto,
            "resource_group": rg,
        },
    }


def _policy_to_doc(engagement_id: str, sub_id: str, ps: dict) -> dict[str, Any]:
    policy_def = ps.get("policy_definition") or "(unknown)"
    assignment = ps.get("policy_assignment") or "(unknown)"
    resource_id = ps.get("resource_id") or ""
    rtype = ps.get("resource_type") or ""
    content = (
        f"Policy {policy_def} (assignment {assignment}) reports a non-compliant "
        f"resource of type {rtype} at {resource_id} in subscription {sub_id}."
    )
    return {
        "source_id": f"policy_state::{sub_id}/{assignment}/{resource_id}",
        "title": f"Non-compliant: {policy_def}",
        "url": None,
        "content": content,
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "policy_noncompliance",
            "subscription_id": sub_id,
            "policy_definition": policy_def,
            "policy_assignment": assignment,
            "resource_id": resource_id,
            "resource_type": rtype,
        },
    }


def _cost_summary_to_doc(engagement_id: str, sub_id: str, mtd: list[dict]) -> dict[str, Any] | None:
    if not mtd:
        return None
    total = sum(row.get("cost") or 0.0 for row in mtd)
    top = mtd[:5]
    top_lines = "; ".join(f"{r.get('service')}: {r.get('cost'):.2f}" for r in top if r.get("service"))
    currency = next((r.get("currency") for r in mtd if r.get("currency")), "USD")
    content = (
        f"Month-to-date Azure spend on subscription {sub_id} is approximately "
        f"{total:.2f} {currency}. Top services: {top_lines}."
    )
    return {
        "source_id": f"cost_mtd::{sub_id}",
        "title": f"MTD cost for {sub_id}",
        "url": None,
        "content": content,
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "cost_mtd",
            "subscription_id": sub_id,
            "total_cost": round(total, 2),
            "currency": currency,
            "top_services": top,
        },
    }


def _advisor_to_doc(engagement_id: str, sub_id: str, rec: dict) -> dict[str, Any] | None:
    rec_id = rec.get("id") or rec.get("name") or rec.get("recommendationId")
    if not rec_id:
        return None
    category = rec.get("category") or rec.get("Category") or "Advisor"
    impact = rec.get("impact") or rec.get("Impact") or "unknown"
    short = rec.get("shortDescription") or rec.get("description") or {}
    if isinstance(short, dict):
        problem = short.get("problem") or short.get("solution") or ""
    else:
        problem = str(short)
    content = (
        f"Azure Advisor {category} recommendation (impact {impact}) on subscription "
        f"{sub_id}: {problem or 'see Advisor portal for details'}."
    )
    return {
        "source_id": f"advisor::{sub_id}/{rec_id}",
        "title": f"Advisor: {category} ({impact})",
        "url": None,
        "content": content,
        "metadata": {
            "corpus_type": "tenant_inventory",
            "fact_kind": "advisor_recommendation",
            "subscription_id": sub_id,
            "category": category,
            "impact": impact,
            "recommendation_id": rec_id,
        },
    }


async def _gather_subscription(engagement_id: str, sub_id: str) -> tuple[list[dict], list[str]]:
    """Pull every fact source for one subscription. Returns (docs, errors)."""
    docs: list[dict] = []
    errors: list[str] = []

    async def _safe(label: str, fn, *args):
        try:
            return await asyncio.to_thread(fn, *args)
        except Exception as exc:
            errors.append(f"{label}:{type(exc).__name__}")
            _log.warning("tenant_inventory.stage_failed", stage=label, sub=sub_id, error=str(exc))
            return None

    resources = await _safe("list_resources", azure_scan_service.list_resources, sub_id) or []
    for res in resources:
        docs.append(_resource_to_doc(engagement_id, sub_id, res))

    public_ips = await _safe("list_public_ips", azure_scan_service.list_public_ips, sub_id) or []
    for ip in public_ips:
        docs.append(_public_ip_to_doc(engagement_id, sub_id, ip))

    open_rules = await _safe("list_open_nsg_rules", azure_scan_service.list_open_nsg_rules, sub_id) or []
    for rule in open_rules:
        docs.append(_nsg_rule_to_doc(engagement_id, sub_id, rule))

    policy_states = (
        await _safe("list_policy_states", security_posture_service.list_policy_states, sub_id) or []
    )
    for ps in policy_states:
        docs.append(_policy_to_doc(engagement_id, sub_id, ps))

    mtd = await _safe("query_mtd_by_service", cost_service.query_mtd_by_service, sub_id) or []
    cost_doc = _cost_summary_to_doc(engagement_id, sub_id, mtd)
    if cost_doc is not None:
        docs.append(cost_doc)

    if mcp_service.is_mcp_available():
        try:
            raw = await asyncio.wait_for(
                mcp_service.call_mcp_tool(
                    "mcp_advisor", {"subscription": sub_id, "operation": "recommendation_list"}
                ),
                timeout=_MCP_ADVISOR_TIMEOUT_S,
            )
            recs = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(recs, dict):
                recs = recs.get("recommendations") or recs.get("value") or []
            if isinstance(recs, list):
                for rec in recs:
                    if not isinstance(rec, dict):
                        continue
                    doc = _advisor_to_doc(engagement_id, sub_id, rec)
                    if doc is not None:
                        docs.append(doc)
        except TimeoutError:
            errors.append("advisor:timeout")
            _log.warning("tenant_inventory.advisor_timeout", sub=sub_id)
        except (ValueError, TypeError, RuntimeError) as exc:
            errors.append(f"advisor:{type(exc).__name__}")
            _log.warning("tenant_inventory.advisor_failed", sub=sub_id, error=str(exc))

    return docs, errors


async def ingest_engagement(engagement: Engagement) -> dict[str, Any]:
    """Snapshot every subscription on `engagement` into the tenant_inventory corpus.

    Returns ``{ok, engagement_id, subscriptions, docs_indexed, errors,
    duration_s}``. ``docs_indexed`` is the count returned by
    ``index_documents`` (upserts count as 1 each). ``errors`` is a flat
    list of per-stage failure tags so the caller can surface them on the
    SSE stream without crashing the run.
    """
    started = dt.datetime.now(dt.UTC)
    sub_ids = list(engagement.subscription_ids or [])
    if not sub_ids:
        return {
            "ok": True,
            "engagement_id": engagement.id,
            "subscriptions": 0,
            "docs_indexed": 0,
            "errors": ["no_subscription_ids"],
            "duration_s": 0.0,
        }

    all_docs: list[dict] = []
    all_errors: list[str] = []
    for sub_id in sub_ids:
        docs, errors = await _gather_subscription(engagement.id, sub_id)
        all_docs.extend(docs)
        all_errors.extend(errors)

    indexed = 0
    if all_docs:
        try:
            async with session_scope() as session:
                indexed = await index_documents(
                    session,
                    CORPUS_TENANT_INVENTORY,
                    all_docs,
                    replace=False,
                    engagement_id=engagement.id,
                )
        except Exception as exc:
            _log.exception("tenant_inventory.index_failed", engagement=engagement.id, error=str(exc))
            return {
                "ok": False,
                "engagement_id": engagement.id,
                "stage": "index",
                "error": str(exc),
                "subscriptions": len(sub_ids),
                "docs_indexed": 0,
                "errors": all_errors,
                "duration_s": (dt.datetime.now(dt.UTC) - started).total_seconds(),
            }

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "engagement_id": engagement.id,
        "subscriptions": len(sub_ids),
        "docs_indexed": indexed,
        "errors": all_errors,
        "duration_s": round(duration_s, 2),
    }
    _log.info("tenant_inventory.completed", **summary)
    return summary


async def ingest_all_active_engagements() -> dict[str, Any]:
    """Scheduler driver — run :func:`ingest_engagement` for every active
    engagement that has subscription IDs.

    Each engagement is processed sequentially to keep MCP / Resource
    Graph load bounded. Failures are captured per-engagement.
    """
    from sqlalchemy import select

    from db import Engagement as _Engagement

    started = dt.datetime.now(dt.UTC)
    results: list[dict[str, Any]] = []
    async with session_scope() as session:
        stmt = (
            select(_Engagement)
            .where(_Engagement.status == "active")
            .execution_options(skip_tenant_filter=True)
        )
        engagements = (await session.execute(stmt)).scalars().all()
    eligible = [e for e in engagements if e.subscription_ids]

    for eng in eligible:
        try:
            results.append(await ingest_engagement(eng))
        except Exception as exc:
            _log.exception("tenant_inventory.engagement_failed", engagement=eng.id, error=str(exc))
            results.append({"ok": False, "engagement_id": eng.id, "error": str(exc)})

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "engagements_processed": len(eligible),
        "results": results,
        "duration_s": round(duration_s, 2),
    }
    _log.info(
        "tenant_inventory.batch_completed",
        engagements_processed=len(eligible),
        duration_s=summary["duration_s"],
    )
    return summary


__all__ = [
    "ingest_all_active_engagements",
    "ingest_engagement",
]
