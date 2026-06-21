"""
Chat route — handles all 15 modes via a unified SSE streaming endpoint.
Tool calls are dispatched and their structured results emitted as typed SSE events.
"""

import asyncio
import contextlib
import json
import os
import traceback
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from openai import APIError, AuthenticationError, BadRequestError
from pydantic import BaseModel

from auth import require_user, user_id_from_claims
from limiter import limiter
from middleware.logging import get_logger
from models import ModelConfig
from observability import tool_calls_counter
from prompts.agents import DEFAULT_AGENT, get_agent_prompt
from prompts.domain_fragments import get_fragments
from prompts.system_prompt import get_system_prompt
from services import agent_router, engagement_context
from services.error_sanitizer import sanitize_openai_error
from services.mcp_service import call_mcp_tool, is_mcp_tool
from services.openai_service import (
    TOOL_INCOMPATIBLE_MODELS,
    resolve_async_client_and_model,
)
from services.pricing_service import estimate_architecture, validate_sku
from services.rag_service import cached_learn_search, cached_learn_search_full
from services.settings_service import load_settings
from services.token_service import schedule_record_usage
from tools.tool_definitions import get_tools_for_mode

router = APIRouter()
log = get_logger("chat")


def _unified_agents_enabled() -> bool:
    return os.getenv("UNIFIED_AGENTS", "").strip().lower() in {"1", "true", "yes", "on"}

# Modes that use the architecture route instead (handled by architecture.py)
ARCH_ROUTE_MODES = {"architecture", "waf", "review", "drbc"}

# Desk modes whose design_architecture tool call should produce a draw.io diagram
# (mirrors the diagram pane behavior in ArchitecturePanel for the desk experience).
DIAGRAM_ENABLED_MODES = frozenset({
    "netvnet", "netfirewall", "nethybrid", "netprivatelink", "netvwan", "netiac",
    "compsku", "compha", "compdr",
    "aifoundry", "airag", "aiagents", "aimlops", "aiiac",
    "datalake", "datawarehouse", "datalakehouse", "datastream", "dataiac",
    # Unified-agent tokens (UNIFIED_AGENTS=true). Defense-in-depth so any
    # agent that calls design_architecture emits the diagram SSE event.
    "architect", "cost", "operations", "compliance", "engagement",
})


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    mode: str = "qa"
    messages: list[ChatMessage]
    llm_config: ModelConfig | None = None
    attachments: list[str] | None = None


# Modes that get mandatory doc pre-retrieval before the LLM call.
# Each value is a base query that gets augmented with the user's message snippet.
PREFETCH_MODES: dict[str, str] = {
    "landingzone":  "Azure Cloud Adoption Framework landing zone management groups hub-spoke networking governance",
    "threatmodel":  "Azure threat modeling STRIDE security controls zero trust defender",
    "reliability":  "Azure reliability SLO SLA error budget site reliability engineering chaos engineering",
    "drbc":         "Azure disaster recovery business continuity failover RTO RPO geo-replication",
    "waf":          "Azure Well-Architected Framework reliability security cost operational excellence performance",
}

# Per-agent base queries for the unified-agents surface. When the router
# resolves a request to one of these agents we always prefetch — generic
# architect questions were previously falling through PREFETCH_MODES,
# leaving gpt-5.4 to freeball from training data.
AGENT_PREFETCH: dict[str, str] = {
    "architect":  "Azure reference architecture Well-Architected Framework AVM Bicep landing zone networking identity",
    "cost":       "Azure cost optimization pricing reserved instances savings plan FinOps Azure Advisor",
    "operations": "Azure operations monitoring Log Analytics Application Insights alerting SLO incident response",
    "compliance": "Azure compliance policy regulatory Microsoft Defender Purview Zero Trust governance",
    "engagement": "Azure engagement scope subscriptions regions reservation commitments tenant governance",
}


async def _prefetch_docs(mode: str, user_message: str, agent: str | None = None) -> dict:
    """Fetch Learn docs before the LLM call for structured-output modes
    or unified-agents requests.

    Returns ``{"citations": list[dict], "unknown": bool,
    "top_confidence": float, "source": str}`` so the caller can swap in
    honesty-mode prose when retrieval is weak.
    """
    base = AGENT_PREFETCH.get(agent or "") or PREFETCH_MODES.get(mode)
    if not base:
        return {"citations": [], "unknown": False, "top_confidence": 0.0, "source": "skipped"}
    snippet = user_message[:150].strip()
    query = f"{base} {snippet}".strip()
    return await cached_learn_search_full(query=query, top=5)


async def _stream_chat(mode: str, messages: list[dict], provider: str = "azure", model: str = "", github_token: str = "", attachments: list[str] | None = None, user_id: str = "default") -> AsyncGenerator[str, None]:
    # Emit a guaranteed first event so the client knows the stream is alive
    # even if setup raises before the LLM call. Without this, any uncaught
    # exception during routing / prefetch produces a 200 with empty body —
    # the browser shows the request as "succeeded" but no data ever arrives.
    yield f"data: {json.dumps({'type': 'stream_open', 'mode': mode})}\n\n"
    try:
        async for chunk in _stream_chat_impl(mode, messages, provider, model, github_token, attachments, user_id):
            yield chunk
    except BaseException as exc:
        # Diagnostic: catch BaseException (not just Exception) to surface
        # CancelledError / SystemExit / KeyboardInterrupt that would otherwise
        # bypass the wrapper and leave the ASGI response half-open.
        exc_type = type(exc).__name__
        exc_mro = [c.__name__ for c in type(exc).__mro__]
        tb = traceback.format_exc()
        log.error(
            "chat.stream_failed",
            mode=mode,
            error=str(exc),
            exc_type=exc_type,
            exc_mro=exc_mro,
            traceback=tb,
        )
        with contextlib.suppress(Exception):
            yield f"data: {json.dumps({'type': 'error', 'message': f'stream failed: {exc_type}: {exc}'})}\n\n"
        if isinstance(exc, asyncio.CancelledError):
            # Re-raise so the framework's cancel scope semantics still fire.
            raise


async def _stream_chat_impl(mode: str, messages: list[dict], provider: str = "azure", model: str = "", github_token: str = "", attachments: list[str] | None = None, user_id: str = "default") -> AsyncGenerator[str, None]:
    try:
        client, deployment = resolve_async_client_and_model(mode, provider, model, github_token)
    except ValueError as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return

    # Unified-agents path: replace mode-keyed system prompt with
    # engagement preamble + agent prompt + selected domain fragments.
    # Legacy modes flow through `shim_legacy_mode` so old `?mode=netvnet`
    # URLs continue to land on the right agent during the deprecation window.
    routing: dict | None = None
    preamble = ""
    resolved_agent: str | None = None
    if _unified_agents_enabled():
        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    last_user = content
                elif isinstance(content, list):
                    last_user = next(
                        (p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"),
                        "",
                    )
                break

        routing = agent_router.shim_legacy_mode(mode)
        if routing is None:
            history_hint_parts: list[str] = []
            for m in messages[-4:-1]:
                c = m.get("content", "")
                if isinstance(c, str) and c:
                    history_hint_parts.append(c[:120])
            history_hint = " | ".join(history_hint_parts)
            try:
                routing = agent_router.route(last_user, history_hint=history_hint)
            except Exception as exc:
                log.warning("agent_router.unavailable", error=str(exc))
                routing = {"agent": DEFAULT_AGENT, "domain_fragments": [], "suggested_tools": [], "reason": "router_unavailable"}

        with contextlib.suppress(Exception):
            preamble = await engagement_context.preamble_for_active()

        agent_name = routing.get("agent", DEFAULT_AGENT)
        resolved_agent = agent_name
        agent_prompt = get_agent_prompt(agent_name)
        fragments_block = get_fragments(routing.get("domain_fragments", []) or [])
        system_parts = [p for p in (preamble, agent_prompt, fragments_block) if p]
        system = "\n\n".join(system_parts)
        tools = [] if model in TOOL_INCOMPATIBLE_MODELS else get_tools_for_mode(agent_name)
        if not tools and model not in TOOL_INCOMPATIBLE_MODELS:
            # Tool buckets for the 5 agents aren't collapsed yet — fall back
            # to the legacy mode mapping so the assistant still has tools.
            tools = get_tools_for_mode(mode)
        with contextlib.suppress(Exception):
            yield f"data: {json.dumps({'type': 'agent_route', 'agent': agent_name, 'domain_fragments': routing.get('domain_fragments', []), 'reason': routing.get('reason', ''), 'engagement_scoped': bool(preamble)})}\n\n"
    else:
        system = get_system_prompt(mode)
        tools = [] if model in TOOL_INCOMPATIBLE_MODELS else get_tools_for_mode(mode)

    # Apply attachments to the last user message as a content array
    if attachments and messages:
        last = messages[-1]
        parts: list[dict] = [{"type": "text", "text": last["content"]}]
        for att in attachments:
            if att.startswith("data:image/"):
                parts.append({"type": "image_url", "image_url": {"url": att, "detail": "high"}})
            elif att.startswith("data:application/pdf"):
                parts.append({"type": "file", "file": {"filename": "attachment.pdf", "file_data": att}})
            else:
                parts[0]["text"] += f"\n\n{att}"
        messages = [*messages[:-1], {**last, "content": parts}]

    full_messages = [{"role": "system", "content": system}, *messages]
    citations: list[dict] = []

    # Mandatory pre-retrieval for structured output modes — inject into system message
    # so every response is anchored to real Learn articles, not just training knowledge.
    user_content = messages[-1].get("content", "") if messages else ""
    prefetch_bundle = await _prefetch_docs(mode, user_content, agent=resolved_agent)
    prefetched = prefetch_bundle["citations"]
    prompt_tokens = 0
    completion_tokens = 0
    if prefetched:
        citations.extend(prefetched)
        doc_block = "\n".join(
            f"- [{d['title']}]({d['url']}): {d['description']}"
            for d in prefetched
        )
        full_messages[0]["content"] += (
            f"\n\n## Retrieved Documentation (cite these URLs in your response)\n{doc_block}"
        )
        # Honesty mode: when reranker confidence is low, instruct the model
        # to lead with an "I'm not confident" caveat instead of presenting
        # the response as authoritative. Better for an architect to hear
        # "this is the closest match I found" than a hallucinated answer.
        if prefetch_bundle.get("unknown"):
            full_messages[0]["content"] += (
                "\n\n## Confidence Note\n"
                "Retrieval confidence is LOW for this question. "
                "Begin your response with a brief caveat such as "
                "\"I'm not confident this is fully current — the closest matches I found are:\" "
                "and explicitly suggest the user double-check against the cited sources. "
                "Do not invent specifics that aren't in the retrieved docs."
            )
            with contextlib.suppress(Exception):
                yield f"data: {json.dumps({'type': 'rag_unknown', 'top_confidence': prefetch_bundle.get('top_confidence', 0.0)})}\n\n"

    while True:
        kwargs: dict = {
            "model": deployment,
            "messages": full_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_completion_tokens": 8000,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        collected_content = ""
        tool_calls_raw: dict[int, dict] = {}
        finish_reason = None

        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if chunk.usage is not None:
                    prompt_tokens += chunk.usage.prompt_tokens or 0
                    completion_tokens += chunk.usage.completion_tokens or 0
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                finish_reason = chunk.choices[0].finish_reason

                if delta.content:
                    collected_content += delta.content
                    yield f"data: {json.dumps({'type': 'token', 'content': delta.content})}\n\n"

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_raw:
                            tool_calls_raw[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_raw[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_raw[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_raw[idx]["arguments"] += tc.function.arguments
        except (BadRequestError, AuthenticationError, APIError) as e:
            msg = sanitize_openai_error(e)
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
            return

        if finish_reason == "tool_calls" and tool_calls_raw:
            tool_calls_formatted = [
                {
                    "id": v["id"],
                    "type": "function",
                    "function": {"name": v["name"], "arguments": v["arguments"]},
                }
                for v in tool_calls_raw.values()
            ]
            full_messages.append({
                "role": "assistant",
                "content": collected_content or None,
                "tool_calls": tool_calls_formatted,
            })

            for tc in tool_calls_raw.values():
                name = tc["name"]
                args = _safe_json(tc["arguments"])
                with contextlib.suppress(Exception):
                    tool_calls_counter.add(1, {"tool_name": name})
                tool_result, sse_event = await _dispatch_tool(name, args)

                if name == "search_azure_docs" and isinstance(tool_result, list):
                    citations.extend(tool_result)

                if sse_event:
                    yield f"data: {json.dumps(sse_event)}\n\n"

                # Desk diagram emission: when an architecture-shaped desk mode
                # calls design_architecture, render the components/connections
                # via diagram_service and stream the mxfile XML.
                if name == "design_architecture" and mode in DIAGRAM_ENABLED_MODES:
                    components = args.get("components", [])
                    if components:
                        try:
                            from services.diagram_service import generate_diagram
                            diagram_xml = generate_diagram(
                                components=components,
                                connections=args.get("connections", []),
                                title=(args.get("title") or args.get("name") or "Architecture")[:60],
                            )
                            yield f"data: {json.dumps({'type': 'diagram', 'xml': diagram_xml})}\n\n"
                        except Exception as e:
                            yield f"data: {json.dumps({'type': 'error', 'message': f'Diagram error: {e}'})}\n\n"

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(tool_result if not isinstance(tool_result, list) else {"results": tool_result, "count": len(tool_result)}),
                })
        else:
            break

    if citations:
        yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"

    yield "data: [DONE]\n\n"

    schedule_record_usage(user_id, deployment, mode, prompt_tokens, completion_tokens)


async def _dispatch_tool(name: str, args: dict) -> tuple[object, dict | None]:
    """Execute a tool call. Returns (tool_result_for_llm, optional_sse_event)."""

    if is_mcp_tool(name):
        result_text = await call_mcp_tool(name, args)
        return result_text, None

    if name == "search_azure_docs":
        result = await cached_learn_search(
            query=args.get("query", ""),
            top=5,
        )
        return result, None

    if name == "compare_services":
        event = {
            "type": "service_comparison",
            "comparison": {
                "services": args.get("services", []),
                "use_case": args.get("use_case", ""),
                "comparison_rows": args.get("comparison_rows", []),
                "recommendation": args.get("recommendation", ""),
                "decision_tree": args.get("decision_tree", []),
            },
        }
        return {"status": "comparison_structured"}, event

    if name == "map_compliance":
        event = {
            "type": "compliance_result",
            "result": {
                "framework": args.get("framework", ""),
                "controls_met": args.get("controls_met", []),
                "gaps": args.get("gaps", []),
                "azure_policy_recommendations": args.get("azure_policy_recommendations", []),
                "shared_responsibility_notes": args.get("shared_responsibility_notes", ""),
            },
        }
        return {"status": "compliance_mapped"}, event

    if name == "assess_migration":
        event = {
            "type": "migration_assessment",
            "assessment": {
                "workload_name": args.get("workload_name", ""),
                "current_state": args.get("current_state", ""),
                "strategy": args.get("strategy", ""),
                "rationale": args.get("rationale", ""),
                "target_azure_services": args.get("target_azure_services", []),
                "effort_weeks": args.get("effort_weeks"),
                "risk_level": args.get("risk_level", ""),
                "wave": args.get("wave"),
                "key_steps": args.get("key_steps", []),
                "blockers": args.get("blockers", []),
            },
        }
        return {"status": "migration_assessed"}, event

    if name == "design_dr_strategy":
        event = {
            "type": "dr_strategy",
            "strategy": {
                "dr_pattern": args.get("dr_pattern", ""),
                "primary_region": args.get("primary_region", ""),
                "secondary_region": args.get("secondary_region", ""),
                "service_configs": args.get("service_configs", []),
                "failover_steps": args.get("failover_steps", []),
                "test_plan": args.get("test_plan", []),
                "estimated_monthly_dr_cost": args.get("estimated_monthly_dr_cost", ""),
            },
        }
        return {"status": "dr_designed"}, event

    if name == "generate_monitoring_config":
        event = {
            "type": "monitoring_config",
            "config": {
                "alert_rules": args.get("alert_rules", []),
                "kql_queries": args.get("kql_queries", []),
                "dashboard_widgets": args.get("dashboard_widgets", []),
                "bicep_alerts": args.get("bicep_alerts"),
            },
        }
        return {"status": "monitoring_configured"}, event

    if name == "estimate_costs":
        line_items = args.get("line_items", [])
        try:
            validated_items: list[dict] = []
            sku_warnings: list[str] = []
            for item in line_items:
                service = item.get("service", "")
                sku = item.get("sku", "")
                region = item.get("region", "eastus")
                if service and sku:
                    validation = await validate_sku(service, sku, region)
                    if not validation["valid"]:
                        sku_warnings.append(validation["message"])
                        suggestions = validation.get("suggestions", [])
                        if suggestions:
                            item = {**item, "sku": suggestions[0]}
                validated_items.append(item)

            estimate = await estimate_architecture(validated_items)
            estimate["optimization_tips"] = args.get("optimization_tips", [])
            if sku_warnings:
                estimate["sku_warnings"] = sku_warnings
            try:
                from services.engagement_context import load_active
                from services.reservations_service import apply_reservation_discounts
                eng = await load_active()
                if eng and getattr(eng, "reservation_commitments", None):
                    estimate = apply_reservation_discounts(
                        estimate, dict(eng.reservation_commitments or {})
                    )
            except Exception:
                pass
            event = {"type": "cost_estimate", "estimate": estimate}
            return {"status": "cost_estimated", "total": estimate["total_monthly_estimate"]}, event
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "live_price_lookup":
        from services import retail_pricing_service
        try:
            result = await retail_pricing_service.lookup(
                service=args.get("service", ""),
                sku=args.get("sku", ""),
                region=args.get("region", "eastus"),
                quantity=float(args.get("quantity", 1)),
                hours_per_month=float(args.get("hours_per_month", 730.0)),
            )
            return {"status": "priced", "monthly_estimate": result.get("monthly_estimate")}, {
                "type": "live_price",
                "result": result,
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "check_quota_alternatives":
        from services import engagement_context as _ec
        from services.quota_service import QuotaServiceUnavailable, check_quota_for_line_items
        try:
            items = args.get("items", []) or []
            preferred = args.get("preferred_region")
            eng = await _ec.load_active()
            sub_ids = list(eng.subscription_ids) if eng and eng.subscription_ids else []
            if not sub_ids:
                return {"status": "error", "message": "no subscriptions on active engagement"}, None
            result = await check_quota_for_line_items(items, sub_ids, preferred_region=preferred)
            return {
                "status": "quota_checked",
                "constraint_count": len(result.get("constraints", [])),
            }, {"type": "quota_alternatives", "result": result}
        except QuotaServiceUnavailable as e:
            return {"status": "unavailable", "message": str(e)}, None
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "analyze_reservations":
        import asyncio as _asyncio

        from services import reservations_service
        try:
            data = await _asyncio.to_thread(
                reservations_service.recommend_reservations,
                args.get("subscription_id"),
                args.get("scope", "Single"),
                int(args.get("lookback_days", 30)),
            )
            return {
                "status": "ri_analyzed",
                "recommendation_count": len(data.get("recommendations", [])),
            }, {"type": "reservation_recommendations", "data": data}
        except ValueError as e:
            return {"status": "error", "message": str(e)}, None
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "recommend_rightsizing":
        import asyncio as _asyncio

        from services import rightsizing_service
        try:
            data = await _asyncio.to_thread(
                rightsizing_service.assess_vms,
                args.get("subscription_id"),
                int(args.get("window_days", 14)),
                float(args.get("threshold_pct", rightsizing_service.UNDERUTIL_THRESHOLD)),
            )
            return {
                "status": "rightsizing_assessed",
                "underutilised_count": data.get("underutilised_count", 0),
            }, {"type": "rightsizing_findings", "data": data}
        except ValueError as e:
            return {"status": "error", "message": str(e)}, None
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "estimate_carbon":
        from services import carbon_service
        try:
            items = args.get("line_items", []) or []
            base = carbon_service.estimate_for_line_items(items)
            payload: dict = {"estimate": base}
            regions = args.get("compare_regions") or []
            if regions:
                payload["region_comparison"] = carbon_service.compare_regions(regions, items)
            return {
                "status": "carbon_estimated",
                "total_kgco2e_per_month": base.get("total_kgco2e_per_month"),
            }, {"type": "carbon_estimate", "data": payload}
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "compare_payg_vs_ri":
        from services import reservations_service
        try:
            data = reservations_service.break_even(
                payg_monthly=float(args.get("payg_monthly", 0)),
                reserved_monthly=float(args.get("reserved_monthly", 0)),
                upfront_cost=float(args.get("upfront_cost", 0)),
                term_years=int(args.get("term_years", 1)),
            )
            return {"status": "ri_compared", "recommendation": data["recommendation"]}, {
                "type": "ri_break_even",
                "data": data,
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}, None

    if name == "generate_learning_plan":
        event = {
            "type": "learning_plan",
            "plan": {
                "title": args.get("title", ""),
                "overview": args.get("overview", ""),
                "target_audience": args.get("target_audience", ""),
                "duration_days": args.get("duration_days", 1),
                "prerequisites": args.get("prerequisites", []),
                "learning_outcomes": args.get("learning_outcomes", []),
                "modules": args.get("modules", []),
            },
        }
        return {"status": "plan_generated"}, event

    if name == "generate_tco_report":
        event = {
            "type": "tco_report",
            "report": {
                "on_prem_items": args.get("on_prem_items", []),
                "azure_items": args.get("azure_items", []),
                "three_year_on_prem_total": args.get("three_year_on_prem_total", 0),
                "three_year_azure_total": args.get("three_year_azure_total", 0),
                "migration_cost_estimate": args.get("migration_cost_estimate"),
                "break_even_months": args.get("break_even_months"),
                "savings_percentage": args.get("savings_percentage"),
                "recommendations": args.get("recommendations", []),
            },
        }
        return {"status": "tco_generated"}, event

    if name == "design_network_topology":
        return {"status": "network_designed"}, {"type": "network_topology", "topology": {**args}}

    if name == "design_landing_zone":
        return {"status": "landing_zone_designed"}, {"type": "landing_zone_design", "design": {**args}}

    if name == "validate_resource_naming":
        from dataclasses import asdict

        from services.naming_service import validate_batch
        results = [asdict(r) for r in validate_batch(args.get("items", []))]
        return {"status": "names_validated", "results": results}, {
            "type": "naming_validation",
            "results": results,
        }

    if name == "suggest_resource_name":
        from services.naming_service import suggest_name
        suggestion = suggest_name(
            resource_type=args.get("resource_type", ""),
            workload=args.get("workload", "workload"),
            env=args.get("env", "dev"),
            region=args.get("region", "eastus2"),
            suffix=args.get("suffix"),
        )
        return {"status": "name_suggested", "name": suggestion}, {
            "type": "naming_suggestion",
            "name": suggestion,
            "inputs": {**args},
        }

    if name == "design_rbac_model":
        return {"status": "rbac_designed"}, {"type": "rbac_model", "model": {**args}}

    if name == "generate_threat_register":
        return {"status": "threat_register_generated"}, {"type": "threat_register", "register": {**args}}

    if name == "design_pipeline":
        return {"status": "pipeline_designed"}, {"type": "pipeline_design", "design": {**args}}

    if name == "define_slo_framework":
        return {"status": "slo_defined"}, {"type": "slo_framework", "framework": {**args}}

    if name == "recommend_sku":
        return {"status": "sku_recommended"}, {"type": "sku_recommendation", "recommendation": {**args}}

    if name == "compare_regions":
        return {"status": "regions_compared"}, {"type": "region_comparison", "comparison": {**args}}

    if name == "generate_practice_exam":
        return {"status": "exam_generated"}, {"type": "practice_exam_pack", "pack": {**args}}

    if name == "create_stakeholder_plan":
        return {"status": "plan_created"}, {"type": "stakeholder_plan", "plan": {**args}}

    if name == "submit_arb_design":
        return {"status": "arb_submission_proposed"}, {"type": "arb_submission_proposal", "proposal": {**args}}

    if name == "clear_arb_condition":
        return {"status": "arb_condition_clear_proposed"}, {"type": "arb_condition_action", "action": "clear", "payload": {**args}}

    if name == "waive_arb_condition":
        return {"status": "arb_condition_waive_proposed"}, {"type": "arb_condition_action", "action": "waive", "payload": {**args}}

    if name == "transition_arb_status":
        return {"status": "arb_status_transition_proposed"}, {"type": "arb_status_transition", "transition": {**args}}

    if name == "recommend_service":
        return {"status": "service_recommended"}, {"type": "decision_card", "card": {**args}}

    if name == "diagnose_issue":
        event = {"type": "diagnosis", "diagnosis": {**args}}
        return {"status": "diagnosis_received"}, event

    if name == "generate_kql_queries":
        event = {"type": "kql_queries", "queries": args.get("queries", [])}
        return {"status": "kql_received"}, event

    if name == "generate_remediation_runbook":
        event = {
            "type": "remediation_runbook",
            "steps": args.get("steps", []),
            "escalation_path": args.get("escalation_path", ""),
            "estimated_minutes": args.get("estimated_resolution_minutes", 0),
        }
        return {"status": "runbook_received"}, event

    if name == "plan_fabric_capacity":
        event = {"type": "fabric_capacity_plan", "plan": {**args}}
        return {"status": "capacity_planned"}, event

    if name == "generate_adf_pipeline":
        event = {"type": "adf_pipeline", "pipeline": {**args}}
        return {"status": "pipeline_generated"}, event

    if name == "design_medallion_schema":
        event = {"type": "medallion_schema", "design": {**args}}
        return {"status": "schema_designed"}, event

    if name == "design_architecture":
        # Diagram emission happens in _stream_chat (it needs `mode`).
        # Return a status so the LLM knows the design was accepted.
        return {
            "status": "design_received",
            "component_count": len(args.get("components", [])),
            "connection_count": len(args.get("connections", [])),
        }, None

    return {}, None


def _safe_json(s: str) -> dict:
    try:
        return json.loads(s)
    except Exception:
        return {}


@router.post("/chat")
@limiter.limit("60/minute")
async def chat(request: Request, req: ChatRequest, claims=Depends(require_user)):
    app_settings = await load_settings()
    mc = req.llm_config or app_settings.mode_models.get(req.mode)
    provider = mc.provider if mc else "azure"
    model = mc.model if mc else ""
    user_id = user_id_from_claims(claims)
    from fastapi import HTTPException

    from services.token_service import check_daily_budget
    allowed, used, limit = await check_daily_budget(user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"error": "daily_token_budget_exceeded", "used_tokens": used, "limit_tokens": limit},
        )
    messages = [m.model_dump() for m in req.messages]
    github_token = ""
    if provider in {"github-models", "github-copilot"}:
        from db import session_scope
        from services.secret_store import get_secret
        async with session_scope() as session:
            github_token = await get_secret(session, user_id, "github_pat") or ""
    return StreamingResponse(
        _stream_chat(req.mode, messages, provider, model, github_token, req.attachments or [], user_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
