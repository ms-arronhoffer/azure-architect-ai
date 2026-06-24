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
  "recommended_tool": string,           // optional structured-tool token, see list below, or ""
  "reason": string                      // one short sentence
}

Agent meanings:
- architect: design, IaC, diagrams, WAF, AVM modules, landing zone, AI architecture.
- cost: pricing, reservations, savings plans, right-sizing, carbon, anomalies, TCO.
- operations: reliability, troubleshooting, DR, runbooks, monitoring, Service Health.
- compliance: posture, threat model, DevSecOps, regulatory framework mapping.
- engagement: intake, RFP, exec content, learning plans, "what's new" briefings.

recommended_tool — set ONLY when the user clearly wants a guided, structured flow,
and it must belong to the chosen agent. Otherwise use "". Allowed values:
- "cost-optimize"   (cost)        — right-sizing / cost optimization workflow
- "threatmodel"     (compliance)  — STRIDE threat modeling
- "drbc"            (operations)  — disaster recovery / business continuity design
- "reliability"     (operations)  — reliability / SLO design
- "runbookstudio"   (operations)  — operational runbook authoring
- "intake"          (engagement)  — requirements intake wizard
- "presentation"    (engagement)  — executive presentation builder
- "landingzone"     (architect)   — landing zone designer
- "namingstandards" (architect)   — naming standards generator

Prefer fewer fragments — only include one when it adds real depth."""


# ── Structured-tool recommendation ─────────────────────────────────────────
#
# The five agents handle most requests through chat, but several flows are far
# more intuitive in their bespoke, guided panels (structured questions, wizards,
# split-pane editors). When the user's intent clearly maps to one of those
# surfaces, the router recommends it so the frontend can offer a one-click
# launch chip — chat stays the default, structure is one click away.
#
# Each tool is owned by exactly one agent so a recommendation is only surfaced
# when it is coherent with the resolved agent (e.g. we never suggest the
# threat-model tool while the cost agent is active).
_TOOL_AGENT: dict[str, str] = {
    "cost-optimize": "cost",
    "threatmodel": "compliance",
    "drbc": "operations",
    "reliability": "operations",
    "runbookstudio": "operations",
    "intake": "engagement",
    "presentation": "engagement",
    "landingzone": "architect",
    "namingstandards": "architect",
}

# Ordered keyword bag — first match wins. Phrases are matched as substrings of
# the lower-cased message, so multi-word phrases are preferred over loose tokens.
_TOOL_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("cost-optimize", (
        "right-size", "rightsize", "right size", "rightsizing",
        "optimize cost", "optimise cost", "cost optimization", "cost optimisation",
        "reduce spend", "reduce cost", "lower cost", "savings plan", "reservation",
    )),
    ("threatmodel", (
        "threat model", "threat-model", "threatmodel", "stride",
        "attack surface", "threat register", "attack tree",
    )),
    ("drbc", (
        "disaster recovery", "dr plan", "dr strategy", "business continuity",
        "rto", "rpo", "failover", "backup and restore",
    )),
    ("reliability", (
        "reliability", "resiliency", "resilience", "availability zone",
        "slo", "sla target", "error budget",
    )),
    ("runbookstudio", (
        "runbook", "operational procedure", "incident playbook",
    )),
    ("intake", (
        "intake", "requirements gathering", "gather requirements",
        "scope a project", "new engagement", "discovery call", "rfp",
    )),
    ("presentation", (
        "presentation", "exec deck", "executive deck", "slide deck",
        "pitch deck", "briefing deck", "powerpoint", "pptx",
    )),
    ("landingzone", (
        "landing zone", "management group", "enterprise scale", "caf landing",
    )),
    ("namingstandards", (
        "naming convention", "naming standard", "resource naming",
    )),
]

# Direct legacy-mode → structured-tool mapping for the shim fast path.
_MODE_TOOL: dict[str, str] = {
    "finops": "cost-optimize",
    "cost": "cost-optimize",
    "rightsizing": "cost-optimize",
    "reservations": "cost-optimize",
    "threatmodel": "threatmodel",
    "securityposture": "threatmodel",
    "drbc": "drbc",
    "reliability": "reliability",
    "runbook": "runbookstudio",
    "intake": "intake",
    "rfp": "intake",
    "presentation": "presentation",
    "exec": "presentation",
    "landingzone": "landingzone",
}


def recommend_tool(message: str, agent: str) -> str:
    """Return a bespoke structured-tool token the user likely wants, or "".

    Only returns a tool whose owning agent matches ``agent`` so the suggestion
    is always coherent with the resolved agent. Returns "" when no keyword
    matches or the match belongs to a different agent.
    """
    text = (message or "").lower()
    for tool, keywords in _TOOL_KEYWORDS:
        if _TOOL_AGENT.get(tool) != agent:
            continue
        if any(kw in text for kw in keywords):
            return tool
    return ""


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
    rec_tool = obj.get("recommended_tool")
    rec_tool = rec_tool if isinstance(rec_tool, str) and rec_tool in _TOOL_AGENT else ""
    return {
        "agent": agent,
        "domain_fragments": frags,
        "suggested_tools": tools,
        "recommended_tool": rec_tool,
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
                max_completion_tokens=200,
                response_format={"type": "json_object"},
            )

        resp = openai_service.call_with_retry(
            _call, max_attempts=2, model_name=deployment, mode="router"
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = _parse_response(raw)
    except Exception as exc:
        log.warning("agent_router.fallback", error=str(exc))
        parsed = _fallback(message)

    # Keyword recommender backstops the LLM: if the classifier didn't name a
    # coherent structured tool, derive one from the message + resolved agent.
    if not parsed.get("recommended_tool"):
        parsed["recommended_tool"] = recommend_tool(
            message, parsed.get("agent", DEFAULT_AGENT)
        )

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
        "recommended_tool": _MODE_TOOL.get(mode, ""),
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


__all__ = ["recommend_tool", "route", "shim_legacy_mode"]
