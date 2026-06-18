"""
Architecture route — orchestrates multi-step architecture design and WAF assessments.
Streams typed SSE events including diagram, runbook, Bicep, and cost estimate.
"""

import json
import re
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from openai import APIError, AuthenticationError, BadRequestError
from pydantic import BaseModel

from auth import require_user, user_id_from_claims
from db import RefArch, select, session_scope
from limiter import limiter
from models import ModelConfig
from prompts.system_prompt import MODE_TEMPLATES
from services.bicep_service import build_and_preview as build_bicep_preview
from services.diagram_service import generate_diagram
from services.docs_service import search_azure_docs
from services.error_sanitizer import sanitize_openai_error
from services.mcp_service import call_mcp_tool, is_mcp_tool
from services.citation_service import enrich_recommendations
from services.openai_service import resolve_client_and_model
from services.pricing_service import estimate_architecture, get_regional_pricing_context
from services.refarch_match import match_spec
from services.runbook_service import build_runbook
from services.settings_service import load_settings
from services.token_service import schedule_record_usage
from tools.tool_definitions import get_tools_for_mode

router = APIRouter()

ARCHITECTURE_MODES = {"architecture", "waf", "review", "drbc", "network", "aiarchitecture", "dataplatform", "apim"}

# Modes that get prior architecture text injected from the caller — re-matching
# adds noise rather than signal, so skip the seed-prompt enrichment.
_REFARCH_SKIP_MODES = {"waf", "review"}
_REFARCH_INJECT_THRESHOLD = 0.4

_CONFIDENCE_INSTRUCTION = (
    "## Self-Rated Confidence (required)\n"
    "After producing the main response, append a fenced block of the form:\n"
    "```confidence\n"
    "[{\"dimension\": \"throughput_requirements\", \"score\": 1, \"rationale\": \"No SLO given; assumed 100 RPS\", \"suggested_question\": \"Expected peak RPS?\"}, ...]\n"
    "```\n"
    "Rate 0-5 your certainty in each *input dimension you used* (e.g., throughput, data_residency, "
    "compliance, budget, availability_target, recovery_targets, data_classes, identity_model). "
    "For any score ≤ 2, include a concise `suggested_question` the customer could answer to raise your confidence. "
    "Emit valid JSON inside the fence. Do not wrap in additional markdown."
)


_CONFIDENCE_FENCE_RE = re.compile(r"```confidence\s*\n(.*?)\n```", re.DOTALL | re.IGNORECASE)


def _extract_confidence_block(text: str) -> list[dict]:
    if not text:
        return []
    m = _CONFIDENCE_FENCE_RE.search(text)
    if not m:
        return []
    try:
        parsed = json.loads(m.group(1).strip())
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        dim = item.get("dimension")
        score = item.get("score")
        if not isinstance(dim, str) or not isinstance(score, (int, float)):
            continue
        entry = {
            "dimension": dim,
            "score": int(score),
            "rationale": item.get("rationale") or "",
        }
        sq = item.get("suggested_question")
        if isinstance(sq, str) and sq.strip():
            entry["suggested_question"] = sq
        out.append(entry)
    return out


def _spec_from_arch_request(req: "ArchRequest") -> dict:
    """Build a loose spec dict for `match_spec` from the incoming ArchRequest."""
    return {
        "description": req.requirements,
        "summary": req.constraints,
        "patterns": [req.pattern] if req.pattern and req.pattern != "custom" else [],
        "regions": [req.region] if req.region else [],
        "category": req.mode if req.mode in ("network", "aiarchitecture", "dataplatform", "apim") else "",
    }


def _arch_to_dict(row: RefArch) -> dict:
    return {
        "slug": row.slug,
        "title": row.title,
        "summary": row.summary,
        "category": row.category,
        "tags": row.tags or [],
        "services": row.services or [],
        "patterns": row.patterns or [],
        "waf_score": row.waf_score or {},
        "estimated_monthly": row.estimated_monthly or {},
        "complexity": row.complexity,
        "learn_url": row.learn_url,
        "source": row.source,
    }


def _refarch_seed_block(arch: dict) -> str:
    """Render the matched arch as a system-prompt addendum."""
    services = arch.get("services") or []
    patterns = arch.get("patterns") or []
    waf = arch.get("waf_score") or {}
    waf_line = ", ".join(f"{k} {v}/5" for k, v in waf.items()) if waf else ""
    parts = [
        "## Reference starting point",
        f"The closest Microsoft reference architecture for this workload is **{arch.get('title')}**.",
    ]
    if arch.get("learn_url"):
        parts.append(f"Source: {arch['learn_url']}")
    if arch.get("summary"):
        parts.append(f"Summary: {arch['summary']}")
    if patterns:
        parts.append(f"Patterns: {', '.join(patterns)}.")
    if services:
        parts.append(f"Key services: {', '.join(services)}.")
    if waf_line:
        parts.append(f"Baseline WAF scores: {waf_line}.")
    parts.append("Customise from this baseline rather than generating cold; preserve the WAF posture unless the requirements explicitly override it.")
    return "\n".join(parts)


async def _match_refarch_for_request(req: "ArchRequest") -> tuple[list[dict], dict | None]:
    """Return (top_matches, seed_arch) for a request.

    `top_matches` is a UI-friendly list (slug/title/score/signals); `seed_arch`
    is the full dict to inject into the prompt when score crosses the threshold,
    or None when no match is strong enough.
    """
    try:
        async with session_scope() as session:
            rows = (await session.execute(select(RefArch))).scalars().all()
    except Exception:
        return [], None
    if not rows:
        return [], None
    corpus = [_arch_to_dict(r) for r in rows]
    ranked = match_spec(_spec_from_arch_request(req), corpus, top_n=3)
    top_matches: list[dict] = []
    for r in ranked:
        a = r["arch"]
        top_matches.append({
            "slug": a.get("slug"),
            "title": a.get("title"),
            "summary": a.get("summary"),
            "learn_url": a.get("learn_url"),
            "source": a.get("source"),
            "score": r["score"],
            "signals": r["signals"],
        })
    seed = ranked[0]["arch"] if ranked and ranked[0]["score"] >= _REFARCH_INJECT_THRESHOLD else None
    return top_matches, seed


async def _enrich_pillar_with_citations(pillar: dict, cache: dict[str, str | None]) -> dict:
    """Replace `recommendations: [str, ...]` with `[{text, learn_url?}, ...]`
    via the MCP `documentation` tool. Falls back silently to the original
    list if enrichment fails or returns nothing useful.
    """
    if not isinstance(pillar, dict):
        return pillar
    recs = pillar.get("recommendations")
    if not isinstance(recs, list) or not recs:
        return pillar
    if not all(isinstance(r, str) for r in recs):
        # already enriched (or unexpected shape) — leave alone
        return pillar
    try:
        enriched = await enrich_recommendations(recs, cache)
    except Exception:
        return pillar
    if enriched:
        pillar["recommendations"] = enriched
    return pillar


class ArchRequest(BaseModel):
    requirements: str
    constraints: str = ""
    pattern: str = "custom"
    mode: str = "architecture"
    existing_description: str = ""
    attachments: list[str] = []
    include_components: list[str] = []  # e.g. ["diagram","runbook","bicep","cost","adr"]; empty = all
    region: str = ""
    llm_config: ModelConfig | None = None
    prior_messages: list[dict] = []  # iteration history: [{role: "user"|"assistant", content: "..."}]


async def _stream_architecture(req: ArchRequest, provider: str = "azure", model: str = "", github_token: str = "", user_id: str = "default") -> AsyncGenerator[str, None]:
    try:
        client, deployment = resolve_client_and_model("architecture", provider, model, github_token)
    except ValueError as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return
    mode = req.mode if req.mode in ARCHITECTURE_MODES else "architecture"
    system = MODE_TEMPLATES.get(mode, MODE_TEMPLATES["architecture"])
    tools = get_tools_for_mode(mode)
    usage_acc: dict[str, int] = {"prompt": 0, "completion": 0}
    citation_cache: dict[str, str | None] = {}

    if mode == "waf":
        yield f"data: {json.dumps({'type': 'status', 'message': 'Running WAF assessment...'})}\n\n"
        async for chunk in _stream_waf_assessment(req, client, deployment, system, usage_acc):
            yield chunk
        schedule_record_usage(user_id, deployment, mode, usage_acc["prompt"], usage_acc["completion"])
        return

    user_prompt = _build_prompt(req, mode)

    if req.attachments:
        parts: list[dict] = [{"type": "text", "text": user_prompt}]
        for att in req.attachments:
            if att.startswith("data:image/"):
                parts.append({"type": "image_url", "image_url": {"url": att, "detail": "high"}})
            else:
                parts[0]["text"] += f"\n\n{att}"
        user_content: object = parts
    else:
        user_content = user_prompt

    enriched_system = system
    if req.region:
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Fetching live pricing data...'})}\n\n"
            pricing_ctx = await get_regional_pricing_context(req.region)
            if pricing_ctx:
                enriched_system = system + "\n\n" + pricing_ctx
        except Exception:
            pass

    if mode not in _REFARCH_SKIP_MODES:
        yield f"data: {json.dumps({'type': 'status', 'message': 'Matching reference architectures...'})}\n\n"
        try:
            top_matches, seed_arch = await _match_refarch_for_request(req)
        except Exception:
            top_matches, seed_arch = [], None
        if top_matches:
            yield f"data: {json.dumps({'type': 'reference_match', 'matches': top_matches, 'seeded_slug': seed_arch.get('slug') if seed_arch else None})}\n\n"
        if seed_arch:
            enriched_system = enriched_system + "\n\n" + _refarch_seed_block(seed_arch)

    enriched_system = enriched_system + "\n\n" + _CONFIDENCE_INSTRUCTION

    full_messages = [{"role": "system", "content": enriched_system}]
    if req.prior_messages:
        for m in req.prior_messages:
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content:
                full_messages.append({"role": role, "content": content})
    full_messages.append({"role": "user", "content": user_content})

    citations: list[dict] = []
    arch_data: dict = {}

    while True:
        try:
            stream = client.chat.completions.create(
                model=deployment,
                messages=full_messages,
                tools=tools,
                tool_choice="auto",
                stream=True,
                stream_options={"include_usage": True},
                max_completion_tokens=8000,
            )
        except (BadRequestError, AuthenticationError, APIError) as e:
            msg = sanitize_openai_error(e)
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
            return

        collected_content = ""
        tool_calls_raw: dict[int, dict] = {}
        finish_reason = None

        for chunk in stream:
            if chunk.usage is not None:
                usage_acc["prompt"] += chunk.usage.prompt_tokens or 0
                usage_acc["completion"] += chunk.usage.completion_tokens or 0
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
                        tool_calls_raw[idx] = {"id": "", "name": "", "arguments": ""}
                    if tc.id:
                        tool_calls_raw[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls_raw[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls_raw[idx]["arguments"] += tc.function.arguments

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

                if name == "search_azure_docs":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Fetching docs...'})}\n\n"
                    result = await search_azure_docs(
                        query=args.get("query", ""), category=args.get("category", "")
                    )
                    citations.extend(result)

                elif name == "design_architecture":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Generating diagram...'})}\n\n"
                    arch_data = args
                    result = {"status": "design_received", "component_count": len(args.get("components", []))}

                elif name == "generate_bicep":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Generating Bicep IaC...'})}\n\n"
                    bicep_code = args.get('bicep_code', '')
                    yield f"data: {json.dumps({'type': 'bicep', 'code': bicep_code, 'target_scope': args.get('target_scope', 'resourceGroup'), 'param_file': args.get('param_file'), 'deploy_commands': args.get('deploy_commands', []), 'notes': args.get('notes', [])})}\n\n"
                    try:
                        preview = await build_bicep_preview(bicep_code)
                        yield f"data: {json.dumps({'type': 'bicep_preview', 'preview': preview})}\n\n"
                    except Exception as e:
                        yield f"data: {json.dumps({'type': 'bicep_preview', 'preview': {'valid': False, 'errors': [{'line': 0, 'col': 0, 'severity': 'Error', 'code': 'BCP_BUILD_FAIL', 'message': str(e)}], 'resources': [], 'total_count': 0, 'arm_template': None}})}\n\n"
                    result = {"status": "bicep_received"}

                elif name == "generate_terraform":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Generating Terraform module...'})}\n\n"
                    try:
                        from services.iac import blueprint_from_reference_arch, emit_terraform
                        bp = blueprint_from_reference_arch(args.get("pattern_name", ""))
                        files = emit_terraform(bp)
                        yield f"data: {json.dumps({'type': 'terraform_files', 'files': files, 'pattern_name': args.get('pattern_name', ''), 'notes': bp.notes})}\n\n"
                        result = {"status": "terraform_received", "file_count": len(files)}
                    except (KeyError, Exception) as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Terraform error: {e}'})}\n\n"

                elif name == "generate_arm":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Generating ARM template...'})}\n\n"
                    try:
                        from services.iac import blueprint_from_reference_arch, emit_arm
                        bp = blueprint_from_reference_arch(args.get("pattern_name", ""))
                        files = emit_arm(bp)
                        yield f"data: {json.dumps({'type': 'arm_files', 'files': files, 'pattern_name': args.get('pattern_name', ''), 'notes': bp.notes})}\n\n"
                        result = {"status": "arm_received", "file_count": len(files)}
                    except (KeyError, Exception) as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'ARM error: {e}'})}\n\n"

                elif name == "estimate_costs":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Fetching pricing data...'})}\n\n"
                    line_items = args.get("line_items", [])
                    try:
                        # Stream per-line cost_update events with running totals so the
                        # UI can show a live counter as items resolve, then emit the
                        # final cost_estimate. Keeps a single source-of-truth for the
                        # numbers (estimate_architecture aggregates the same per-item calls).
                        running_total = 0.0
                        per_item_results: list[dict] = []
                        from services.pricing_service import estimate_line_item
                        for item in line_items:
                            try:
                                est = await estimate_line_item(
                                    service=item.get("service", ""),
                                    sku=item.get("sku", ""),
                                    quantity=item.get("quantity", 1),
                                    hours_per_month=item.get("hours_per_month", 730),
                                    region=item.get("region", req.region or "eastus"),
                                )
                            except Exception:
                                continue
                            monthly = est.get("monthly_estimate") or 0
                            running_total += monthly
                            per_item_results.append(est)
                            yield f"data: {json.dumps({'type': 'cost_update', 'running_total_usd': round(running_total, 2), 'delta': {'service': est.get('service'), 'sku': est.get('sku'), 'monthly': monthly, 'quantity': est.get('quantity')}, 'region': est.get('region')})}\n\n"
                        # Final bundled estimate — reuse the aggregated path so totals,
                        # validation, and disclaimer stay identical to the non-streaming case.
                        estimate = await estimate_architecture(line_items)
                        estimate["optimization_tips"] = args.get("optimization_tips", [])
                        yield f"data: {json.dumps({'type': 'cost_estimate', 'estimate': estimate})}\n\n"
                        result = {"status": "cost_estimated", "total": estimate["total_monthly_estimate"]}
                    except Exception as e:
                        result = {"status": "error", "message": str(e)}

                elif name == "design_network_topology":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Building network topology...'})}\n\n"
                    try:
                        from services.diagram_service import generate_network_diagram
                        net_xml = generate_network_diagram(args)
                        topology_payload = {**args, "diagramXml": net_xml}
                    except Exception as e:
                        topology_payload = args
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Network diagram error: {e}'})}\n\n"
                    yield f"data: {json.dumps({'type': 'network_topology', 'topology': topology_payload})}\n\n"
                    result = {"status": "network_topology_received"}

                elif name == "assess_waf_pillar":
                    pillar_data = await _enrich_pillar_with_citations(args, citation_cache)
                    yield f"data: {json.dumps({'type': 'waf_pillar', 'pillar': pillar_data})}\n\n"
                    result = {"status": "received"}

                elif name == "generate_adr":
                    yield f"data: {json.dumps({'type': 'adr', 'data': args})}\n\n"
                    result = {"status": "adr_received"}

                elif name == "generate_project_timeline":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Generating project timeline...'})}\n\n"
                    from services.diagram_service import generate_gantt_xml
                    gantt_xml = generate_gantt_xml(
                        args.get("phases", []),
                        args.get("total_weeks", 12),
                        args.get("critical_path", [])
                    )
                    yield f"data: {json.dumps({'type': 'project_timeline', 'xml': gantt_xml, 'phases': args.get('phases', []), 'total_weeks': args.get('total_weeks', 12), 'notes': args.get('notes', '')})}\n\n"
                    result = {"status": "timeline_received"}

                elif name == "generate_cicd_pipeline":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Emitting CI/CD pipeline...'})}\n\n"
                    try:
                        from services.cicd_emitter import emit_azure_devops, emit_github_actions
                        platform = args.get("platform", "github_actions")
                        pattern = args.get("pattern_name", "")
                        environment = args.get("environment", "dev")
                        deploy_method = args.get("deploy_method", "bicep")
                        if platform == "azure_devops":
                            files = emit_azure_devops(pattern, environment, deploy_method)
                        else:
                            files = emit_github_actions(pattern, environment, deploy_method)
                        yield f"data: {json.dumps({'type': 'cicd_files', 'platform': platform, 'pattern_name': pattern, 'environment': environment, 'deploy_method': deploy_method, 'files': files})}\n\n"
                        result = {"status": "cicd_received", "file_count": len(files)}
                    except Exception as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'CI/CD error: {e}'})}\n\n"

                elif name == "design_cost_alerts":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Designing budget alerts...'})}\n\n"
                    try:
                        from services.cost_anomaly_service import design_budget_alerts
                        payload = design_budget_alerts(
                            subscription_id=args.get("subscription_id", ""),
                            monthly_budget=float(args.get("monthly_budget_usd", 0)),
                            alert_thresholds=args.get("alert_thresholds") or [50, 80, 100, 110],
                        )
                        yield f"data: {json.dumps({'type': 'cost_alerts', 'alerts': payload})}\n\n"
                        result = {"status": "cost_alerts_received"}
                    except Exception as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Cost alerts error: {e}'})}\n\n"

                elif name == "assess_security_posture":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Scoring security posture...'})}\n\n"
                    try:
                        from services.security_posture_service import (
                            list_defender_recommendations,
                            list_sentinel_incidents,
                            score_security_posture,
                        )
                        sub = args.get("subscription_id", "")
                        posture = score_security_posture(sub)
                        if args.get("include_recommendations", True):
                            posture["recommendations"] = list_defender_recommendations(sub, severity_min="Medium")
                        if args.get("include_incidents", False) and args.get("workspace_resource_id"):
                            posture["incidents"] = list_sentinel_incidents(
                                args["workspace_resource_id"], lookback_hours=24
                            )
                        yield f"data: {json.dumps({'type': 'security_posture', 'posture': posture})}\n\n"
                        result = {"status": "posture_received", "score": posture.get("score")}
                    except Exception as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Security posture error: {e}'})}\n\n"

                elif name == "compare_clouds":
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Comparing clouds...'})}\n\n"
                    try:
                        from services.multicloud_service import compare_services as _cmp_svc
                        from services.multicloud_service import decision_matrix
                        if args.get("workload_type"):
                            payload = decision_matrix(args["workload_type"], args.get("criteria", []))
                        else:
                            payload = _cmp_svc(args.get("azure_service", ""), args.get("target_clouds", []))
                        yield f"data: {json.dumps({'type': 'multicloud_comparison', 'comparison': payload})}\n\n"
                        result = {"status": "multicloud_received"}
                    except Exception as e:
                        result = {"status": "error", "message": str(e)}
                        yield f"data: {json.dumps({'type': 'error', 'message': f'Multicloud error: {e}'})}\n\n"

                elif is_mcp_tool(name):
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Consulting Azure docs...'})}\n\n"
                    result = await call_mcp_tool(name, args)

                else:
                    result = {}

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                })
        else:
            break

    # Post-LLM: generate diagram and runbook if we have arch data
    include = set(req.include_components) if req.include_components else {"diagram", "runbook", "bicep", "cost", "adr"}
    if arch_data.get("components"):
        if "diagram" in include:
            try:
                diagram_xml = generate_diagram(
                    components=arch_data["components"],
                    connections=arch_data.get("connections", []),
                    title=req.requirements[:60],
                )
                yield f"data: {json.dumps({'type': 'diagram', 'xml': diagram_xml})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': f'Diagram error: {e}'})}\n\n"

        if "runbook" in include:
            runbook_md = build_runbook(
                arch_name=req.requirements[:80],
                overview=arch_data.get("overview", req.requirements),
                components=arch_data.get("components", []),
                deployment_steps=arch_data.get("deployment_steps"),
            )
            yield f"data: {json.dumps({'type': 'runbook', 'markdown': runbook_md})}\n\n"

    if citations:
        yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"

    confidence_items = _extract_confidence_block(collected_content)
    if confidence_items:
        yield f"data: {json.dumps({'type': 'confidence', 'items': confidence_items})}\n\n"

    yield "data: [DONE]\n\n"

    schedule_record_usage(user_id, deployment, mode, usage_acc["prompt"], usage_acc["completion"])


async def _stream_waf_assessment(req: ArchRequest, client, deployment: str, system: str, usage_acc: dict[str, int] | None = None):
    desc = req.existing_description or req.requirements
    pillars = ["reliability", "security", "cost", "operational-excellence", "performance"]
    tools = get_tools_for_mode("waf")
    pillar_results: list[dict] = []
    citation_cache: dict[str, str | None] = {}

    for pillar in pillars:
        yield f"data: {json.dumps({'type': 'status', 'message': f'Assessing {pillar}...'})}\n\n"

        full_messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    f"Assess this architecture against the WAF {pillar} pillar and call assess_waf_pillar "
                    f"with your findings and a score 1-5.\n\nArchitecture: {desc}"
                ),
            },
        ]

        while True:
            stream = client.chat.completions.create(
                model=deployment,
                messages=full_messages,
                tools=tools,
                tool_choice="auto",
                stream=True,
                stream_options={"include_usage": True},
                max_completion_tokens=1500,
            )

            tool_calls_raw: dict[int, dict] = {}
            finish_reason = None
            collected = ""

            for chunk in stream:
                if chunk.usage is not None and usage_acc is not None:
                    usage_acc["prompt"] += chunk.usage.prompt_tokens or 0
                    usage_acc["completion"] += chunk.usage.completion_tokens or 0
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                finish_reason = chunk.choices[0].finish_reason
                if delta.content:
                    collected += delta.content
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_raw:
                            tool_calls_raw[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_raw[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_raw[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_raw[idx]["arguments"] += tc.function.arguments

            if finish_reason == "tool_calls" and tool_calls_raw:
                tool_calls_formatted = [
                    {"id": v["id"], "type": "function", "function": {"name": v["name"], "arguments": v["arguments"]}}
                    for v in tool_calls_raw.values()
                ]
                full_messages.append({"role": "assistant", "content": collected or None, "tool_calls": tool_calls_formatted})

                for tc in tool_calls_raw.values():
                    if tc["name"] == "assess_waf_pillar":
                        args = _safe_json(tc["arguments"])
                        args = await _enrich_pillar_with_citations(args, citation_cache)
                        pillar_results.append(args)
                        yield f"data: {json.dumps({'type': 'waf_pillar', 'pillar': args})}\n\n"
                        result = {"status": "received"}
                    else:
                        result = {}
                    full_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(result)})
            else:
                break

    yield f"data: {json.dumps({'type': 'waf_complete', 'pillars': pillar_results})}\n\n"
    yield "data: [DONE]\n\n"


def _build_prompt(req: ArchRequest, mode: str) -> str:
    iteration_nudge = (
        "This is a follow-up refinement to the architecture above. "
        "Apply the user's request below and re-run the full tool pipeline "
        "so every artifact (diagram, IaC, cost, runbook, WAF) stays consistent.\n\n"
        if req.prior_messages else ""
    )
    base = (
        f"**Requirements:** {req.requirements}\n"
        f"**Constraints:** {req.constraints or 'None specified'}\n"
        f"**Pattern:** {req.pattern}\n\n"
    )
    base = iteration_nudge + base
    if mode == "network":
        return (
            "Design an Azure network topology for the following requirements:\n\n"
            + base
            + "Call design_network_topology with a complete topology (VNets, subnets, NSG rules, private endpoints, DNS, firewall). "
            "Also call design_architecture so a diagram can be generated. "
            "Call generate_bicep with network IaC. Call estimate_costs for monthly networking budget. "
            "After tool calls, provide a detailed explanation of the design decisions."
        )
    if mode == "aiarchitecture":
        return (
            "Design an Azure AI/ML architecture for the following requirements:\n\n"
            + base
            + "Call search_azure_docs to find relevant AI reference architectures. "
            "Call design_architecture with the full component list including AI services, data stores, and supporting infrastructure. "
            "Call generate_bicep with production-ready IaC. Call estimate_costs for monthly AI workload budget. "
            "Call generate_adr to document the primary AI architecture decision (e.g. RAG vs fine-tuning, model selection). "
            "After tool calls, provide a detailed explanation of the AI architecture."
        )
    if mode == "dataplatform":
        return (
            "Design an Azure data platform architecture for the following requirements:\n\n"
            + base
            + "Call search_azure_docs to find relevant data platform reference architectures (Fabric, Synapse, Databricks). "
            "Call design_architecture with the full component list including ingestion, storage (medallion layers), processing, governance, and serving layers. "
            "Call generate_bicep with production-ready IaC for the key data resources. "
            "Call estimate_costs for monthly data platform budget. "
            "After tool calls, provide a detailed explanation of the data architecture and medallion layer design."
        )
    if mode == "apim":
        return (
            "Design an Azure API Management architecture for the following requirements:\n\n"
            + base
            + "Call search_azure_docs to find relevant APIM best practices and policy documentation. "
            "Call design_architecture with the full APIM topology (gateway, backends, consumers, security components). "
            "Call generate_bicep with APIM resource deployment including key policy XML. "
            "Call estimate_costs for monthly APIM cost (tier, units, bandwidth). "
            "After tool calls, provide a detailed explanation of the API management design decisions."
        )
    if mode == "review":
        attachment_note = (
            f"\n\nNote: {len(req.attachments)} file(s) have been uploaded for analysis "
            "(diagrams will be analyzed visually; architecture files as text)."
            if req.attachments else ""
        )
        return (
            "Conduct a thorough architecture review (red team + WAF assessment) of the following:\n\n"
            + base
            + attachment_note
            + "\nSearch for best practices, then provide findings with severity ratings."
        )
    if mode == "drbc":
        return (
            "Design a comprehensive DR/BC strategy for this workload:\n\n"
            + base
            + "Call design_dr_strategy with your recommendation. Include a full failover runbook."
        )
    include = set(req.include_components) if req.include_components else {"diagram", "runbook", "bicep", "cost", "adr", "gantt", "waf"}
    tool_instructions = ["Call search_azure_docs to find relevant reference architectures."]
    if "diagram" in include or "runbook" in include:
        tool_instructions.append(
            "Call design_architecture with a complete component list including tier assignments."
        )
    if "bicep" in include:
        tool_instructions.append("Call generate_bicep with production-ready IaC.")
    if "cost" in include:
        tool_instructions.append("Call estimate_costs for monthly budget.")
    if "adr" in include:
        tool_instructions.append("Call generate_adr to document the primary architectural decision.")
    if "gantt" in include:
        tool_instructions.append(
            "Call generate_project_timeline with realistic implementation phases (id, name, "
            "start_week, duration_weeks, owner, dependencies, is_milestone), total_weeks, and "
            "critical_path so an implementation Gantt chart can be rendered."
        )
    if "waf" in include:
        tool_instructions.append(
            "Call assess_waf_pillar exactly five times — once for each Well-Architected pillar "
            "('reliability', 'security', 'cost', 'operational-excellence', 'performance') — with "
            "a 1-5 score, key findings, and recommendations grounded in this architecture."
        )
    if "network" in include:
        tool_instructions.append(
            "Call design_network_topology with a complete network topology: topology_type, "
            "vnets (each with name, cidr, region, subnets[name/cidr/purpose]), nsg_rules, "
            "private_endpoints, dns_design, firewall. Make CIDR ranges, subnet purposes, and "
            "NSG rules specific to this workload's requirements."
        )
    tool_instructions.append("After the tool calls, provide a detailed explanation.")
    return (
        "Design an Azure architecture for the following requirements:\n\n"
        + base
        + " ".join(tool_instructions)
    )


def _safe_json(s: str) -> dict:
    try:
        return json.loads(s)
    except Exception:
        return {}


@router.post("/architecture")
@limiter.limit("10/minute")
async def architecture(request: Request, req: ArchRequest, claims=Depends(require_user)):
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
    github_token = ""
    if provider in {"github-models", "github-copilot"}:
        from db import session_scope
        from services.secret_store import get_secret
        async with session_scope() as session:
            github_token = await get_secret(session, user_id, "github_pat") or ""
    return StreamingResponse(
        _stream_architecture(req, provider, model, github_token, user_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
