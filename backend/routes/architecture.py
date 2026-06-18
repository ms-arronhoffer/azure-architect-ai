"""
Architecture route — orchestrates multi-step architecture design and WAF assessments.
Streams typed SSE events including diagram, runbook, Bicep, and cost estimate.
"""

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from openai import APIError, AuthenticationError, BadRequestError
from pydantic import BaseModel

from auth import require_user, user_id_from_claims
from limiter import limiter
from models import ModelConfig
from prompts.system_prompt import MODE_TEMPLATES
from services.bicep_service import build_and_preview as build_bicep_preview
from services.diagram_service import generate_diagram
from services.docs_service import search_azure_docs
from services.error_sanitizer import sanitize_openai_error
from services.mcp_service import call_mcp_tool, is_mcp_tool
from services.openai_service import resolve_client_and_model
from services.pricing_service import estimate_architecture, get_regional_pricing_context
from services.runbook_service import build_runbook
from services.settings_service import load_settings
from services.token_service import schedule_record_usage
from tools.tool_definitions import get_tools_for_mode

router = APIRouter()

ARCHITECTURE_MODES = {"architecture", "waf", "review", "drbc", "network", "aiarchitecture", "dataplatform", "apim"}


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

    yield f"data: {json.dumps({'type': 'status', 'message': 'Searching reference architectures...'})}\n\n"

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
                    pillar_data = args
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

    yield "data: [DONE]\n\n"

    schedule_record_usage(user_id, deployment, mode, usage_acc["prompt"], usage_acc["completion"])


async def _stream_waf_assessment(req: ArchRequest, client, deployment: str, system: str, usage_acc: dict[str, int] | None = None):
    desc = req.existing_description or req.requirements
    pillars = ["reliability", "security", "cost", "operational-excellence", "performance"]
    tools = get_tools_for_mode("waf")
    pillar_results: list[dict] = []

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
