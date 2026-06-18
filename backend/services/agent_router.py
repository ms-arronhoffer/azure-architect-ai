"""Lightweight classifier that picks the right agent + domain fragments
+ likely tools for an incoming user message.

Calls gpt-4o-mini (or whatever the chat deployment is) with a strict
JSON schema. Cached by SHA-256 of the prompt for 24 h — same question
typed twice doesn't burn classifier tokens twice.

Cost target: a single classification ≈ 200 prompt + 80 completion
tokens of gpt-4o-mini ≈ $0.0001. Negligible compared to the chat that
follows, but worth caching anyway because the same architect types the
same questions across the day.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from middleware.logging import get_logger
from prompts.agents import AGENTS, DEFAULT_AGENT
from prompts.domain_fragments import fragment_names
from services import openai_service

log = get_logger("agent_router")

_CACHE_TTL_SEC = 24 * 3600
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _cache_key(message: str, history_hint: str) -> str:
    h = hashlib.sha256()
    h.update(message.encode("utf-8"))
    h.update(b"\x00")
    h.update(history_hint.encode("utf-8"))
    return h.hexdigest()


def _fallback(message: str) -> dict[str, Any]:
    """Keyword-bag fallback when the LLM call fails. Mirrors the obvious
    routing the classifier would make so a degraded service still picks
    a sensible agent."""
    text = (message or "").lower()
    if any(k in text for k in ("cost", "price", "reservation", "savings plan",
                                "right-size", "rightsizing", "carbon", "tco", "$")):
        return {"agent": "cost", "domain_fragments": [], "suggested_tools": []}
    if any(k in text for k in ("incident", "outage", "down", "runbook", "rto",
                                "rpo", "service health", "alert", "monitor")):
        return {"agent": "operations", "domain_fragments": [], "suggested_tools": []}
    if any(k in text for k in ("compliance", "pci", "hipaa", "fedramp",
                                "iso 27001", "soc 2", "threat model", "stride",
                                "defender", "sentinel", "policy")):
        return {"agent": "compliance", "domain_fragments": [], "suggested_tools": []}
    if any(k in text for k in ("intake", "rfp", "proposal", "exec deck",
                                "presentation", "learning plan", "what's new",
                                "pptx", "briefing")):
        return {"agent": "engagement", "domain_fragments": [], "suggested_tools": []}
    return {"agent": DEFAULT_AGENT, "domain_fragments": [], "suggested_tools": []}


_CLASSIFIER_SYSTEM = """You are a routing classifier for an Azure architect copilot.

Pick exactly ONE agent and 0-3 domain fragments. Respond ONLY with a JSON object
matching this schema:

{
  "agent": "architect" | "cost" | "operations" | "compliance" | "engagement",
  "domain_fragments": [string, ...],   // 0-3, drawn from the provided list
  "suggested_tools": [string, ...],    // optional, hint at tool names that might be useful
  "reason": string                      // one short sentence
}

Agent meanings:
- architect: design, IaC, diagrams, WAF, AVM modules, landing zone, AI architecture.
- cost: pricing, reservations, savings plans, right-sizing, carbon, anomalies, TCO.
- operations: reliability, troubleshooting, DR, runbooks, monitoring, Service Health.
- compliance: posture, threat model, DevSecOps, regulatory framework mapping.
- engagement: intake, RFP, exec content, learning plans, "what's new" briefings.

Prefer fewer fragments — only include one when it adds real depth."""


def _build_user_prompt(message: str, history_hint: str) -> str:
    frags = ", ".join(fragment_names())
    history_block = f"\n\nRecent context: {history_hint}" if history_hint else ""
    return (
        f"Available domain_fragments: {frags}\n\n"
        f"User message:\n{message}{history_block}"
    )


def _parse_response(raw: str) -> dict[str, Any]:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        obj = json.loads(raw[start : end + 1])
    agent = str(obj.get("agent") or DEFAULT_AGENT).lower()
    if agent not in AGENTS:
        agent = DEFAULT_AGENT
    frags = obj.get("domain_fragments") or []
    if not isinstance(frags, list):
        frags = []
    known = set(fragment_names())
    frags = [str(f) for f in frags if isinstance(f, str) and f in known][:3]
    tools = obj.get("suggested_tools") or []
    if not isinstance(tools, list):
        tools = []
    tools = [str(t) for t in tools if isinstance(t, str)][:6]
    return {
        "agent": agent,
        "domain_fragments": frags,
        "suggested_tools": tools,
        "reason": str(obj.get("reason") or ""),
    }


def route(
    message: str,
    *,
    history_hint: str = "",
    model_override: str = "",
) -> dict[str, Any]:
    """Classify ``message`` into an agent + fragments + tool hints.

    Always returns a valid dict; on LLM failure, falls back to a keyword
    bag so the chat route never blocks on the router.
    """
    key = _cache_key(message or "", history_hint or "")
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SEC:
        return hit[1]

    try:
        client, deployment = openai_service.resolve_client_and_model(
            mode="chat", provider="azure", model=model_override
        )

        def _call():
            return client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": _CLASSIFIER_SYSTEM},
                    {"role": "user", "content": _build_user_prompt(message, history_hint)},
                ],
                temperature=0,
                max_tokens=200,
                response_format={"type": "json_object"},
            )

        resp = openai_service.call_with_retry(
            _call, max_attempts=2, model_name=deployment
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = _parse_response(raw)
    except Exception as exc:
        log.warning("agent_router.fallback", error=str(exc))
        parsed = _fallback(message)

    _cache[key] = (now, parsed)
    return parsed


def shim_legacy_mode(mode: str) -> dict[str, Any] | None:
    """Map a legacy `mode=` to an agent + fragments, for the deprecation
    window. Returns None when the mode isn't in the shim table — caller
    should fall back to the router."""
    table = _LEGACY_MODE_SHIM.get(mode)
    if not table:
        return None
    return {
        "agent": table[0],
        "domain_fragments": list(table[1]),
        "suggested_tools": [],
        "reason": f"legacy mode={mode}",
    }


# Selected high-traffic legacy modes. Anything not in the table falls through
# to the router. Routes are conservative: when in doubt, pick the architect
# agent and skip the fragment.
_LEGACY_MODE_SHIM: dict[str, tuple[str, tuple[str, ...]]] = {
    # Self-routing for the 5 agent tokens so they skip the LLM classifier.
    "architect": ("architect", ()),
    "operations": ("operations", ()),
    "engagement": ("engagement", ()),
    "architecture": ("architect", ()),
    "bicep": ("architect", ("iac_bicep",)),
    "terraform": ("architect", ("iac_terraform",)),
    "arm": ("architect", ("iac_bicep",)),
    "waf": ("architect", ()),
    "landingzone": ("architect", ("lz_caf",)),
    "netvnet": ("architect", ("network_vnet",)),
    "netdns": ("architect", ("network_dns",)),
    "netfw": ("architect", ("network_firewall",)),
    "compute_aks": ("architect", ("compute_aks",)),
    "compute_vm": ("architect", ("compute_vm",)),
    "appservice": ("architect", ("compute_appservice",)),
    "containerapps": ("architect", ("compute_containerapps",)),
    "data_sql": ("architect", ("data_sql",)),
    "data_cosmos": ("architect", ("data_cosmos",)),
    "data_fabric": ("architect", ("data_fabric",)),
    "ai_openai": ("architect", ("ai_openai",)),
    "ai_search": ("architect", ("ai_search",)),
    "ai_foundry": ("architect", ("ai_foundry",)),
    "finops": ("cost", ("cost_reservations", "cost_rightsizing")),
    "cost": ("cost", ()),
    "rightsizing": ("cost", ("cost_rightsizing",)),
    "reservations": ("cost", ("cost_reservations",)),
    "carbon": ("cost", ()),
    "reliability": ("operations", ("reliability_zones",)),
    "drbc": ("operations", ("reliability_dr",)),
    "troubleshooting": ("operations", ()),
    "runbook": ("operations", ()),
    "servicehealth": ("operations", ()),
    "monitoring": ("operations", ("observability_monitor",)),
    "securityposture": ("compliance", ("security_defender",)),
    "threatmodel": ("compliance", ()),
    "compliance": ("compliance", ()),
    "devsecops": ("compliance", ()),
    "intake": ("engagement", ()),
    "rfp": ("engagement", ()),
    "presentation": ("engagement", ()),
    "learning": ("engagement", ()),
    "whatsnew": ("engagement", ()),
    "exec": ("engagement", ()),
}


__all__ = ["route", "shim_legacy_mode"]
