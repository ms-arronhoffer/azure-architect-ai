"""Shared SSE relay helpers used by pipeline routes.

`_relay_sse` tags each event from a child generator with `_job` and optional
`_phase`, and (when a `container` dict is supplied) accumulates token text and
structured artifacts so the orchestrator can emit a final bundled event.

`_collect_tagged` is the batch variant used by the parallel `_stream_analyze`
flow — it drains a generator into a list of pre-tagged SSE strings.

These helpers live here (rather than in `routes/analyze.py`) so the cost
optimization pipeline and any future pipelines can reuse them without
cross-route imports.
"""

import json
import re
from collections.abc import AsyncGenerator
from typing import Any

_CONFIDENCE_FENCE_RE = re.compile(r"```confidence\s*\n.*?\n```", re.DOTALL | re.IGNORECASE)


async def _relay_sse(
    gen: AsyncGenerator[str, None],
    job: str,
    *,
    phase: str | None = None,
    container: dict[str, Any] | None = None,
    yield_individually: bool = True,
    collected: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """Tag SSE chunks with _job and optional _phase. If container is given, accumulate token
    text and structured artifacts. If yield_individually=False, append tagged chunks to
    collected instead of yielding (caller batches them later).
    """
    if container is not None:
        container.setdefault("text", "")
        container.setdefault("artifacts", {})
        container.setdefault("waf_pillars", [])
        container.setdefault("confidence", [])
        container.setdefault("cost_estimate", None)

    async for chunk in gen:
        if not chunk.startswith("data: "):
            if yield_individually:
                yield chunk
            elif collected is not None:
                collected.append(chunk)
            continue
        raw = chunk[6:].strip()
        try:
            obj = json.loads(raw)
        except Exception:
            if yield_individually:
                yield chunk
            elif collected is not None:
                collected.append(chunk)
            continue
        obj["_job"] = job
        if phase:
            obj["_phase"] = phase
        if container is not None:
            etype = obj.get("type")
            if etype == "token":
                container["text"] += obj.get("content", "")
            elif etype == "runbook":
                container["artifacts"]["runbook"] = obj.get("markdown", "")
            elif etype == "bicep":
                container["artifacts"]["bicep"] = obj.get("code", "")
            elif etype == "bicep_preview":
                container["artifacts"]["bicep_preview"] = obj.get("preview")
            elif etype == "waf_pillar":
                pillar = obj.get("pillar")
                if pillar:
                    container["waf_pillars"].append(pillar)
            elif etype == "confidence":
                items = obj.get("items") or []
                if isinstance(items, list):
                    container["confidence"].extend(items)
                container["text"] = _CONFIDENCE_FENCE_RE.sub("", container["text"]).rstrip() + "\n"
            elif etype == "cost_estimate":
                est = obj.get("estimate")
                if isinstance(est, dict):
                    container["cost_estimate"] = est
        tagged = f"data: {json.dumps(obj)}\n\n"
        if yield_individually:
            yield tagged
        elif collected is not None:
            collected.append(tagged)


async def _collect_tagged(gen: AsyncGenerator[str, None], job: str) -> list[str]:
    """Collect SSE chunks tagged with _job=<job> for batch emission (parallel mode)."""
    collected: list[str] = []
    async for _ in _relay_sse(gen, job, yield_individually=False, collected=collected):
        pass  # pragma: no cover
    return collected
