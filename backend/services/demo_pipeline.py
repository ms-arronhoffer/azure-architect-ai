"""Demo build pipeline — 6 phases mirroring cost_pipeline.py.

intake_normalize → recommendations → architecture_design → build (3-lane
asyncio.gather over code/infra/docs) → verify (az bicep build) → publish
(env-gated). Final SSE event is `demo_built` carrying the spec, file
manifest, extracted Mermaid diagrams, verify result, and optional repo_url.

Build agents emit `{"files": [{"path", "content"}]}`. On parse failure each
lane gets one retry with a strict reprompt; on second failure the lane emits
`phase_failed` with the parse error and siblings continue.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from openai import BadRequestError
from pydantic import BaseModel, Field

from middleware.logging import get_logger
from prompts.demo.architecture_design import ARCHITECTURE_DESIGN_PROMPT
from prompts.demo.code_agent import CODE_AGENT_PROMPT
from prompts.demo.docs_agent import DOCS_AGENT_PROMPT
from prompts.demo.infra_agent import INFRA_AGENT_PROMPT
from prompts.demo.recommendations import RECOMMENDATIONS_PROMPT
from services import demo_publish, openai_service
from services.engagement_context import load_active, preamble_for_active
from services.settings_service import load_settings

log = get_logger("demo_pipeline")


# ── Request / spec models ──────────────────────────────────────────────────────

class WorkloadSpecLite(BaseModel):
    """Mirror of frontend WorkloadSpec — only the fields demo_pipeline reads."""

    name: str = ""
    type: str = ""
    criticality: str = ""
    primaryRegion: str = ""
    complianceFrameworks: list[str] = Field(default_factory=list)
    dataClassification: str = ""
    monthlyBudgetUsd: float = 0
    teamSize: str = ""


class DemoBuildRequest(BaseModel):
    spec: WorkloadSpecLite = Field(default_factory=WorkloadSpecLite)
    demo_slug: str
    demo_title: str
    description: str = ""  # free-text "what should this demo do / outcome / wow moment"
    audience: str = "customer"  # customer | internal | partner
    duration_minutes: int = 15  # 5 | 15 | 30
    target_persona: str = ""
    key_features: list[str] = Field(default_factory=list)
    azure_services: list[str] = Field(default_factory=list)
    seed_bicep: str = ""  # optional prior bundled_design.bicep to extend
    publish: bool = True


# ── Helpers ────────────────────────────────────────────────────────────────────

def _phase_event(phase: str, status: str, **extra: Any) -> dict:
    return {"type": f"phase_{status}", "phase": phase, **extra}


def _slugify(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    return s or "demo"


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{2,62}$")


def _validate_slug(slug: str) -> str:
    s = _slugify(slug)
    if not _SLUG_RE.match(s):
        raise ValueError(f"invalid demo_slug: {slug!r}")
    return s


_MERMAID_FENCE = re.compile(r"```mermaid\s*\n(.+?)\n```", re.DOTALL)


def _extract_mermaid(markdown: str) -> list[dict]:
    out: list[dict] = []
    for i, body in enumerate(_MERMAID_FENCE.findall(markdown or ""), start=1):
        out.append({"name": f"diagram_{i}", "mermaid": body.strip()})
    return out


def _classify(path: str) -> str:
    p = path.lower()
    if p.startswith("infra/") or p.endswith((".bicep", ".bicepparam")):
        return "infra"
    if p.endswith((".md",)):
        return "docs"
    if p.endswith((".env", ".env.example", ".gitignore")) or p == "requirements.txt":
        return "config"
    return "code"


def manifest(files: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    for path, content in sorted(files.items()):
        encoded = content.encode("utf-8")
        out.append(
            {
                "path": path,
                "kind": _classify(path),
                "size": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
            }
        )
    return out


_SYSTEM_TEXT = "You output strict JSON only. No prose, no markdown fences."

# Per-phase model split for the demo-build pipeline. All gpt-5.4 family by
# product requirement. Reasoning model (-pro) only on the one phase that
# genuinely benefits — architecture_design — to avoid the high-latency tax on
# output-heavy build lanes. Each entry is overridable via
# `app_settings.mode_models["demo-build.<phase>"]`.
_PHASE_DEFAULTS: dict[str, str] = {
    "recommendations": "gpt-5.4-mini",
    "architecture_design": "gpt-5.4-pro",
    "code": "gpt-5.4",
    "infra": "gpt-5.4",
    "docs": "gpt-5.4",
}


def _needs_responses_api(deployment: str) -> bool:
    """Detect codex / gpt-5 / o-series deployments. These reject Chat Completions
    entirely with `{'error': {'message': 'The requested operation is unsupported.'}}`
    and must be called via `client.responses.create()` instead."""
    d = (deployment or "").lower()
    return (
        d.startswith("gpt-5")
        or "codex" in d
        or d.startswith("o1")
        or d.startswith("o3")
        or d.startswith("o4")
    )


def _extract_responses_text(resp: Any) -> str:
    text = getattr(resp, "output_text", None)
    if text:
        return text.strip()
    chunks: list[str] = []
    for item in getattr(resp, "output", []) or []:
        for c in getattr(item, "content", []) or []:
            t = getattr(c, "text", None)
            if t:
                chunks.append(t)
    return "".join(chunks).strip()


async def _llm_json(
    prompt: str,
    *,
    max_tokens: int = 4000,
    retry_on_parse: bool = True,
    phase: str = "default",
) -> dict:
    """Single-shot LLM call that must return JSON. One retry on parse fail.

    Routes to the Responses API for codex / gpt-5 / o-series deployments (which
    reject `chat.completions` outright); falls back to Chat Completions for
    gpt-4-family deployments.

    Per-phase model selection (gpt-5.4 family only by design):
      - `recommendations`           → gpt-5.4-mini (fast/cheap, light reasoning)
      - `architecture_design`       → gpt-5.4-pro  (deep reasoning, one-shot)
      - `code` / `infra` / `docs`   → gpt-5.4      (chat, high-output codegen)

    Override order: `mode_models["demo-build.<phase>"]` → `mode_models["demo-build"]`
    → hardcoded `_PHASE_DEFAULTS[phase]`.
    """
    try:
        app_settings = await load_settings()
        mc = app_settings.mode_models.get(f"demo-build.{phase}") or app_settings.mode_models.get(
            "demo-build"
        )
    except Exception:
        mc = None
    provider = (mc.provider if mc else None) or "azure"
    model_override = (mc.model if mc else "") or _PHASE_DEFAULTS.get(phase, "")
    client, deployment = openai_service.resolve_client_and_model(
        mode="demo-build", provider=provider, model=model_override
    )

    use_responses = provider in ("azure", "") and _needs_responses_api(deployment)

    # Responses API requires a newer api-version than the default chat client.
    # Swap to the dedicated responses client for codex/gpt-5/o-series deployments.
    if use_responses:
        client = openai_service.get_responses_client(deployment)

    def _call_responses(p: str) -> str:
        # gpt-5 / o-series burn output tokens on internal reasoning before
        # producing visible text. Stream the response (no max_output_tokens
        # cap) so reasoning + JSON can complete without truncation, and ask
        # for json_object format so the visible output is well-formed.
        # gpt-5.4-pro rejects effort=low; medium is the lowest accepted.
        is_reasoning = _needs_responses_api(deployment)
        kwargs: dict[str, Any] = {
            "model": deployment,
            "input": p,
            "instructions": _SYSTEM_TEXT,
        }
        if is_reasoning:
            kwargs["reasoning"] = {"effort": "medium"}
            kwargs["text"] = {"format": {"type": "json_object"}}
            # Generous safety cap so reasoning can't run unbounded while still
            # leaving ample room for a full multi-file JSON payload after
            # medium-effort reasoning on the largest demo prompts. Scales with
            # the per-phase budget (build lanes pass 16k → 64k cap).
            kwargs["max_output_tokens"] = max(max_tokens * 4, 16000)
        else:
            kwargs["max_output_tokens"] = max_tokens

        def _stream_and_collect() -> Any:
            # Capture the terminal response directly from the event stream.
            # The SDK's `get_final_response()` only resolves on a
            # `response.completed` event and raises "Didn't receive a
            # `response.completed` event." when the model stops on
            # `response.incomplete` (e.g. it hit `max_output_tokens`) — which
            # would otherwise discard a fully- or partially-generated lane and
            # mean no code files ever reach the build. Accept incomplete and
            # failed terminal responses so their (partial) `output_text` is
            # still usable downstream.
            final_resp: Any = None
            with client.responses.stream(**kwargs) as stream:
                for event in stream:
                    if getattr(event, "type", "") in (
                        "response.completed",
                        "response.incomplete",
                        "response.failed",
                    ):
                        final_resp = getattr(event, "response", None)
                if final_resp is None:
                    with contextlib.suppress(Exception):
                        final_resp = stream.get_final_response()
            return final_resp

        try:
            resp = openai_service.call_with_retry(
                _stream_and_collect,
                max_attempts=2,
                model_name=deployment,
            )
        except BadRequestError as exc:
            msg = getattr(exc, "message", None) or str(exc)
            log.warning(
                "demo_pipeline.responses_bad_request",
                deployment=deployment,
                message=msg,
            )
            raise RuntimeError(
                f"Azure OpenAI Responses API 400 on '{deployment}': {msg}"
            ) from exc
        # Surface a non-completed stop so truncated lanes are diagnosable.
        status = getattr(resp, "status", None)
        if status and status != "completed":
            details = getattr(resp, "incomplete_details", None)
            reason = getattr(details, "reason", None) if details else None
            log.warning(
                "demo_pipeline.responses_incomplete",
                deployment=deployment,
                status=status,
                reason=reason,
            )
        return _extract_responses_text(resp)

    def _call_chat(p: str) -> str:
        """4-way parameter fallback for gpt-4-family deployments."""
        user_only = [{"role": "user", "content": p}]
        sys_user = [{"role": "system", "content": _SYSTEM_TEXT}, *user_only]

        def _try(msgs: list[dict], token_kw: str) -> Any:
            kwargs: dict[str, Any] = {"model": deployment, "messages": msgs}
            kwargs[token_kw] = max_tokens
            return openai_service.call_with_retry(
                lambda: client.chat.completions.create(**kwargs),
                max_attempts=2,
                model_name=deployment,
            )

        attempts: list[tuple[str, list[dict], str]] = [
            ("sys+max_completion_tokens", sys_user, "max_completion_tokens"),
            ("user+max_completion_tokens", user_only, "max_completion_tokens"),
            ("sys+max_tokens", sys_user, "max_tokens"),
            ("user+max_tokens", user_only, "max_tokens"),
        ]
        last_exc: BadRequestError | None = None
        for label, msgs, token_kw in attempts:
            try:
                resp = _try(msgs, token_kw)
                return (resp.choices[0].message.content or "").strip() if resp.choices else ""
            except BadRequestError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                log.warning(
                    "demo_pipeline.chat_bad_request_retry",
                    deployment=deployment,
                    attempt=label,
                    message=msg,
                )
                last_exc = exc
                if "unsupported" not in msg.lower():
                    raise RuntimeError(f"Azure OpenAI 400 on '{deployment}': {msg}") from exc
        msg = getattr(last_exc, "message", None) or str(last_exc) if last_exc else "unknown"
        raise RuntimeError(
            f"Azure OpenAI 400 on '{deployment}' after all parameter fallbacks: {msg}"
        )

    # Reasoning models (gpt-5.x / o-series) can spend 10+ min on internal
    # reasoning for large build prompts (~8k output tokens x 3 concurrent
    # lanes). Cap at 15 min so a true hang fails fast without aborting a
    # slow-but-progressing run.
    timeout_s = 900.0 if use_responses else 120.0

    async def _one_shot(p: str) -> str:
        worker = _call_responses if use_responses else _call_chat
        try:
            return await asyncio.wait_for(asyncio.to_thread(worker, p), timeout=timeout_s)
        except TimeoutError as exc:
            raise RuntimeError(
                f"Azure OpenAI '{deployment}' did not return within {int(timeout_s)}s"
            ) from exc

    raw = await _one_shot(prompt)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        if not retry_on_parse:
            raise
        repair = (
            f"{prompt}\n\n---\nYour previous reply was not valid JSON. Reply "
            "again with the exact same schema, valid JSON only, no prose, no "
            f"markdown fences. Parser error: {exc.msg}"
        )
        raw2 = await _one_shot(repair)
        return json.loads(raw2)


def _fallback_design(spec: dict[str, Any], recommendations: list | None) -> dict:
    """Synthesize a minimal but valid design from the intake spec.

    Used when the architecture_design phase fails so the build lanes can still
    run end-to-end instead of the whole demo being discarded. The result mirrors
    the architecture_design JSON schema closely enough for the code/infra/docs
    prompts to produce a coherent, runnable demo.
    """
    services = list(spec.get("azure_services") or []) or ["Azure OpenAI", "App Service"]
    features = list(spec.get("key_features") or [])
    title = spec.get("title") or "Azure Demo"
    rec_names = [r.get("name") for r in (recommendations or []) if isinstance(r, dict) and r.get("name")]
    return {
        "slug": spec.get("slug") or "demo",
        "title": title,
        "demo_archetype": "chat",
        "tech_stack": "flask_sse",
        "azure_services": services,
        "app_files": [
            {"path": "app.py", "purpose": "Flask + SSE entry point"},
            {"path": "templates/index.html", "purpose": "single-page UI"},
        ],
        "bicep_resources": ["Microsoft.CognitiveServices/accounts", "Microsoft.Web/sites"],
        "env_vars": ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"],
        "key_features": features,
        "wow_moment_implementation": (
            spec.get("description")
            or "Token-by-token streaming response rendered live in the browser."
        ),
        "summary_bullets": [f"Showcases {title}", *([f"Applies: {n}" for n in rec_names[:3]])],
        "behind_the_scenes": [
            {"service": s, "role": f"{s} participates in the live request flow."}
            for s in services
        ],
        "live_activity": [
            {
                "step_id": "generate",
                "service": services[0] if services else "Azure OpenAI",
                "stage": "Generating response",
                "detail": "Streaming a model response token-by-token to the browser.",
                "duration_ms": 1200,
            }
        ],
        "diagrams": [
            {
                "name": "component",
                "mermaid": "graph LR\n  browser[Browser] --> app[App Service]\n  app --> generate[Azure OpenAI]",
            }
        ],
        "degraded": True,
    }


def _merge_files(target: dict[str, str], payload: dict, *, lane: str) -> int:
    """Merge `{"files": [{path, content}, ...]}` into target. Returns count."""
    added = 0
    for entry in payload.get("files", []) or []:
        path = (entry.get("path") or "").strip().lstrip("/")
        content = entry.get("content")
        if not path or content is None:
            continue
        target[path] = str(content)
        added += 1
    if added == 0:
        log.warning("demo_pipeline.empty_lane_output", lane=lane)
    return added


# ── Phases ────────────────────────────────────────────────────────────────────

async def _phase_intake_normalize(
    req: DemoBuildRequest, state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("intake_normalize", "started")
    if not req.demo_title or not req.demo_slug:
        yield _phase_event("intake_normalize", "failed", error="missing_slug_or_title")
        return
    try:
        slug = _validate_slug(req.demo_slug)
        spec = {
            "slug": slug,
            "title": req.demo_title,
            "description": req.description,
            "audience": req.audience,
            "duration_minutes": req.duration_minutes,
            "target_persona": req.target_persona,
            "key_features": req.key_features,
            "azure_services": req.azure_services,
            "workload_spec": req.spec.model_dump(),
        }
        state["spec"] = spec
        yield _phase_event(
            "intake_normalize",
            "complete",
            slug=slug,
            feature_count=len(req.key_features),
        )
    except Exception as exc:
        log.warning("demo_pipeline.intake_failed", error=str(exc))
        yield _phase_event("intake_normalize", "failed", error=str(exc))


async def _phase_recommendations(state: dict[str, Any]) -> AsyncGenerator[dict, None]:
    yield _phase_event("recommendations", "started")
    if not state.get("spec"):
        yield _phase_event("recommendations", "skipped", reason="no_spec")
        return
    try:
        prompt = RECOMMENDATIONS_PROMPT(json.dumps(state["spec"], default=str))
        result = await _llm_json(prompt, max_tokens=2000, phase="recommendations")
        recs = result.get("recommendations", []) or []
        state["recommendations"] = recs
        yield _phase_event("recommendations", "complete", recommendation_count=len(recs))
    except Exception as exc:
        log.warning("demo_pipeline.recommendations_failed", error=str(exc))
        yield _phase_event("recommendations", "failed", error=str(exc))


async def _phase_architecture_design(
    state: dict[str, Any], engagement_preamble: str
) -> AsyncGenerator[dict, None]:
    yield _phase_event("architecture_design", "started")
    if not state.get("spec"):
        yield _phase_event("architecture_design", "skipped", reason="no_spec")
        return
    try:
        prompt = ARCHITECTURE_DESIGN_PROMPT(
            json.dumps(state["spec"], default=str),
            json.dumps(state.get("recommendations") or [], default=str),
            engagement_preamble,
        )
        # Reasoning models can run 60-180s with no visible output. Race the
        # LLM call against a heartbeat ticker so the SSE stream emits a
        # progress event every 10s and the UI doesn't look frozen.
        design_task = asyncio.create_task(
            _llm_json(prompt, max_tokens=3500, phase="architecture_design")
        )
        elapsed = 0
        while not design_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(design_task), timeout=10.0)
            except TimeoutError:
                elapsed += 10
                yield _phase_event(
                    "architecture_design", "progress", elapsed_s=elapsed
                )
        design = design_task.result()
        state["design"] = design
        yield _phase_event(
            "architecture_design",
            "complete",
            demo_archetype=design.get("demo_archetype"),
            tech_stack=design.get("tech_stack"),
            azure_services=design.get("azure_services") or [],
            service_count=len(design.get("azure_services") or []),
            diagram_count=len(design.get("diagrams") or []),
            activity_step_count=len(design.get("live_activity") or []),
        )
    except Exception as exc:
        # Do not discard the whole demo when design fails — synthesize a
        # fallback design from the intake spec so the build still runs fully.
        log.warning("demo_pipeline.architecture_failed", error=str(exc))
        fallback = _fallback_design(state.get("spec") or {}, state.get("recommendations"))
        state["design"] = fallback
        yield _phase_event(
            "architecture_design",
            "complete",
            degraded=True,
            error=str(exc),
            tech_stack=fallback.get("tech_stack"),
            azure_services=fallback.get("azure_services") or [],
            service_count=len(fallback.get("azure_services") or []),
            diagram_count=len(fallback.get("diagrams") or []),
        )


async def _lane(name: str, prompt: str, files: dict[str, str]) -> tuple[str, int]:
    """Run one build lane. Returns (lane_name, files_added). Raises on failure."""
    # Lane name is "build.<phase>"; extract the phase for per-phase model routing.
    phase = name.split(".", 1)[1] if "." in name else name
    # Build lanes emit a full multi-file app as one JSON object, so they need a
    # generous output budget — too small a cap truncates the response
    # (`response.incomplete`) and no code files reach the build.
    payload = await _llm_json(prompt, max_tokens=16000, phase=phase)
    added = _merge_files(files, payload, lane=name)
    return name, added


async def _phase_build(
    state: dict[str, Any], files: dict[str, str], req: DemoBuildRequest
) -> AsyncGenerator[dict, None]:
    yield _phase_event("build", "started")
    design = state.get("design")
    if not design:
        yield _phase_event("build", "skipped", reason="no_design")
        return

    azure_services = design.get("azure_services") or []
    design_json = json.dumps(design, default=str)
    spec_json = json.dumps(state.get("spec") or {}, default=str)

    lanes = {
        "build.code": CODE_AGENT_PROMPT(design_json, spec_json),
        "build.infra": INFRA_AGENT_PROMPT(design_json, spec_json, req.seed_bicep),
        "build.docs": DOCS_AGENT_PROMPT(design_json, spec_json),
    }

    yield _phase_event("build.code", "started")
    yield _phase_event("build.infra", "started", azure_services=azure_services)
    yield _phase_event("build.docs", "started")

    # Each lane is a long reasoning call. Launch concurrently, then drain
    # completions as they finish so the SSE stream emits per-lane events in
    # real time and a 10s heartbeat keeps the UI alive while lanes are still
    # running.
    lane_tasks = {
        name: asyncio.create_task(_lane(name, prompt, files))
        for name, prompt in lanes.items()
    }
    pending = set(lane_tasks.values())
    name_by_task = {task: name for name, task in lane_tasks.items()}
    failures = 0
    elapsed = 0
    while pending:
        done, pending = await asyncio.wait(
            pending, timeout=10.0, return_when=asyncio.FIRST_COMPLETED
        )
        if not done:
            elapsed += 10
            yield _phase_event(
                "build",
                "progress",
                elapsed_s=elapsed,
                lanes_remaining=[name_by_task[t] for t in pending],
            )
            continue
        for task in done:
            lane_name = name_by_task[task]
            try:
                _name, added = task.result()
                yield _phase_event(lane_name, "complete", files_added=added)
            except Exception as exc:
                failures += 1
                log.warning(
                    "demo_pipeline.lane_failed", lane=lane_name, error=str(exc)
                )
                yield _phase_event(lane_name, "failed", error=str(exc))

    if failures == len(lanes):
        yield _phase_event("build", "failed", error="all_lanes_failed")
    else:
        yield _phase_event("build", "complete", file_count=len(files), lane_failures=failures)


async def _phase_verify(
    files: dict[str, str], state: dict[str, Any]
) -> AsyncGenerator[dict, None]:
    yield _phase_event("verify", "started")
    main_bicep = files.get("infra/main.bicep")
    if not main_bicep:
        yield _phase_event("verify", "skipped", reason="no_main_bicep")
        return
    if shutil.which("az") is None:
        state["verify"] = {"skipped": True, "reason": "az_cli_missing"}
        yield _phase_event("verify", "skipped", reason="az_cli_missing")
        return
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # write the whole infra/ tree so any module refs resolve
            for path, content in files.items():
                if path.startswith("infra/") or path.endswith((".bicep", ".bicepparam")):
                    dest = tmp_path / path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(content, encoding="utf-8")
            target = tmp_path / "infra" / "main.bicep"
            proc = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    "az",
                    "bicep",
                    "build",
                    "--file",
                    str(target),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                ),
                timeout=60,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            output = (stdout.decode("utf-8", errors="replace")
                      + stderr.decode("utf-8", errors="replace")).strip()
            ok = proc.returncode == 0
            state["verify"] = {"ok": ok, "output": output[-4000:]}
            yield _phase_event(
                "verify",
                "complete" if ok else "failed",
                returncode=proc.returncode,
                output_tail=output[-400:],
            )
    except TimeoutError:
        state["verify"] = {"ok": False, "output": "timeout after 60s"}
        yield _phase_event("verify", "failed", error="timeout")
    except Exception as exc:
        log.warning("demo_pipeline.verify_failed", error=str(exc))
        state["verify"] = {"ok": False, "output": str(exc)}
        yield _phase_event("verify", "failed", error=str(exc))


async def _phase_publish(
    req: DemoBuildRequest,
    files: dict[str, str],
    state: dict[str, Any],
    github_token: str = "",
) -> AsyncGenerator[dict, None]:
    yield _phase_event("publish", "started")
    spec = state.get("spec") or {}
    if not req.publish:
        yield _phase_event("publish", "skipped", reason="publish_disabled")
        return
    token = github_token or os.environ.get("GITHUB_TOKEN") or ""
    if not demo_publish.publish_enabled(token):
        yield _phase_event("publish", "skipped", reason="publish_disabled")
        return
    if not token:
        yield _phase_event("publish", "skipped", reason="github_token_missing")
        return
    if not files:
        yield _phase_event("publish", "skipped", reason="no_files")
        return
    try:
        url = await demo_publish.publish_to_github(
            slug=spec.get("slug") or req.demo_slug,
            title=spec.get("title") or req.demo_title,
            files=files,
            azure_services=spec.get("azure_services") or [],
            github_token=token,
        )
        state["repo_url"] = url
        yield _phase_event("publish", "complete", repo_url=url)
    except RuntimeError as exc:
        yield _phase_event("publish", "skipped", reason=str(exc))
    except Exception as exc:
        log.warning("demo_pipeline.publish_failed", error=str(exc))
        yield _phase_event("publish", "failed", error=str(exc))


# ── Orchestrator ──────────────────────────────────────────────────────────────

async def stream_demo_pipeline(
    req: DemoBuildRequest,
    github_token: str = "",
) -> AsyncGenerator[dict, None]:
    """6-phase demo build. Final event is `demo_built`."""
    state: dict[str, Any] = {
        "spec": None,
        "recommendations": None,
        "design": None,
        "verify": None,
        "repo_url": None,
    }
    files: dict[str, str] = {}

    try:
        engagement = await load_active()
    except Exception as exc:
        log.warning("demo_pipeline.engagement_load_failed", error=str(exc))
        engagement = None
    try:
        preamble = await preamble_for_active() if engagement else ""
    except Exception:
        preamble = ""

    async for ev in _phase_intake_normalize(req, state):
        yield ev
    async for ev in _phase_recommendations(state):
        yield ev
    async for ev in _phase_architecture_design(state, preamble):
        yield ev
    async for ev in _phase_build(state, files, req):
        yield ev
    async for ev in _phase_verify(files, state):
        yield ev
    async for ev in _phase_publish(req, files, state, github_token=github_token):
        yield ev

    diagrams: list[dict] = []
    design_diagrams = (state.get("design") or {}).get("diagrams") or []
    for d in design_diagrams:
        name = d.get("name") or f"diagram_{len(diagrams) + 1}"
        mermaid = (d.get("mermaid") or "").strip()
        if mermaid:
            diagrams.append({"name": name, "mermaid": mermaid})
    if not diagrams:
        diagrams = _extract_mermaid(files.get("ARCHITECTURE.md", ""))

    yield {
        "type": "demo_built",
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
        "engagement_id": getattr(engagement, "id", None) if engagement else None,
        "spec": state.get("spec"),
        "azure_services": (state.get("design") or {}).get("azure_services") or [],
        "demo_archetype": (state.get("design") or {}).get("demo_archetype") or "",
        "behind_the_scenes": (state.get("design") or {}).get("behind_the_scenes") or [],
        "live_activity": (state.get("design") or {}).get("live_activity") or [],
        "talk_track": (state.get("design") or {}).get("talk_track") or "",
        "manifest": manifest(files),
        "diagrams": diagrams,
        "verify": state.get("verify"),
        "repo_url": state.get("repo_url"),
        "readme_md": files.get("README.md", ""),
        "files": files,  # full in-memory map; route caches for ZIP download
    }
