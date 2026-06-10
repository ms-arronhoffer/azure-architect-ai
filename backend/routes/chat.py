"""
Chat route — handles all 15 modes via a unified SSE streaming endpoint.
Tool calls are dispatched and their structured results emitted as typed SSE events.
"""

import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from openai import BadRequestError, AuthenticationError, APIError
from pydantic import BaseModel

from auth import require_user, user_id_from_claims
from models import ModelConfig
from observability import tool_calls_counter
from prompts.system_prompt import get_system_prompt
from services.docs_service import search_azure_docs
from services.rag_service import cached_learn_search
from services.mcp_service import call_mcp_tool, is_mcp_tool
from services.openai_service import TOOL_INCOMPATIBLE_MODELS, get_client, get_deployment, resolve_client_and_model
from services.pricing_service import estimate_architecture, validate_sku
from services.settings_service import load_settings
from tools.tool_definitions import get_tools_for_mode

router = APIRouter()

# Modes that use the architecture route instead (handled by architecture.py)
ARCH_ROUTE_MODES = {"architecture", "waf", "review", "drbc"}


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
    "sizing":       "Azure compute VM SKU sizing recommendations capacity planning performance tiers",
    "drbc":         "Azure disaster recovery business continuity failover RTO RPO geo-replication",
    "waf":          "Azure Well-Architected Framework reliability security cost operational excellence performance",
}


async def _prefetch_docs(mode: str, user_message: str) -> list[dict]:
    """Fetch Learn docs before the LLM call for structured-output modes."""
    base = PREFETCH_MODES.get(mode)
    if not base:
        return []
    snippet = user_message[:150].strip()
    query = f"{base} {snippet}".strip()
    return await cached_learn_search(query=query, top=5)


async def _stream_chat(mode: str, messages: list[dict], provider: str = "azure", model: str = "", github_token: str = "", attachments: list[str] | None = None) -> AsyncGenerator[str, None]:
    try:
        client, deployment = resolve_client_and_model(mode, provider, model, github_token)
    except ValueError as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return
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
        messages = messages[:-1] + [{**last, "content": parts}]

    full_messages = [{"role": "system", "content": system}] + messages
    citations: list[dict] = []

    # Mandatory pre-retrieval for structured output modes — inject into system message
    # so every response is anchored to real Learn articles, not just training knowledge.
    user_content = messages[-1].get("content", "") if messages else ""
    prefetched = await _prefetch_docs(mode, user_content)
    if prefetched:
        citations.extend(prefetched)
        doc_block = "\n".join(
            f"- [{d['title']}]({d['url']}): {d['description']}"
            for d in prefetched
        )
        full_messages[0]["content"] += (
            f"\n\n## Retrieved Documentation (cite these URLs in your response)\n{doc_block}"
        )

    while True:
        kwargs: dict = {
            "model": deployment,
            "messages": full_messages,
            "stream": True,
            "max_completion_tokens": 8000,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        collected_content = ""
        tool_calls_raw: dict[int, dict] = {}
        finish_reason = None

        try:
            stream = client.chat.completions.create(**kwargs)
            for chunk in stream:
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
            msg = getattr(e, "message", str(e))
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
                try:
                    tool_calls_counter.add(1, {"tool_name": name})
                except Exception:
                    pass
                tool_result, sse_event = await _dispatch_tool(name, args)

                if name == "search_azure_docs" and isinstance(tool_result, list):
                    citations.extend(tool_result)

                if sse_event:
                    yield f"data: {json.dumps(sse_event)}\n\n"

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
            event = {"type": "cost_estimate", "estimate": estimate}
            return {"status": "cost_estimated", "total": estimate["total_monthly_estimate"]}, event
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
        from services.naming_service import validate_batch
        from dataclasses import asdict
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

    return {}, None


def _safe_json(s: str) -> dict:
    try:
        return json.loads(s)
    except Exception:
        return {}


@router.post("/chat")
async def chat(req: ChatRequest, claims=Depends(require_user)):
    app_settings = await load_settings()
    mc = req.llm_config or app_settings.mode_models.get(req.mode)
    provider = mc.provider if mc else "azure"
    model = mc.model if mc else ""
    messages = [m.model_dump() for m in req.messages]
    github_token = ""
    if provider in {"github-models", "github-copilot"}:
        from db import session_scope
        from services.secret_store import get_secret
        user_id = user_id_from_claims(claims)
        async with session_scope() as session:
            github_token = await get_secret(session, user_id, "github_pat") or ""
    return StreamingResponse(
        _stream_chat(req.mode, messages, provider, model, github_token, req.attachments or []),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
