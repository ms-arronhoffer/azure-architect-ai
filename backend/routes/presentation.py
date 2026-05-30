"""Presentation outline (SSE) and PPTX build endpoints."""

import json

from fastapi import APIRouter
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from services.openai_service import get_client, get_deployment
from services.pptx_service import build_presentation
from tools.tool_definitions import get_tools

router = APIRouter()


class OutlineRequest(BaseModel):
    topic: str
    audience: str = ""
    objectives: str = ""
    num_slides: int = 10
    conversation_context: str = ""


class BuildRequest(BaseModel):
    outline: dict


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _generate(req: OutlineRequest):
    client = get_client()
    deployment = get_deployment("architecture")
    outline_tool = get_tools("generate_deck_outline")[0]
    review_tool  = get_tools("review_deck_outline")[0]

    system = (
        "You are a senior Azure solutions architect and professional presentation designer. "
        "Create polished, customer-facing presentation decks with clear narrative arcs. "
        "Always vary slide layouts — mix content, two_column, quote_stat, and section_dividers."
    )
    user = (
        f"Create a {req.num_slides}-slide presentation about: {req.topic}\n"
        f"Target audience: {req.audience or 'technical and business stakeholders'}\n"
        f"Key objectives: {req.objectives or 'educate and inspire action'}\n\n"
        "Required structure: title slide → agenda → section dividers for major topics → "
        "body slides (varied layouts) → summary/key takeaways → references/next steps."
    )
    if req.conversation_context:
        user += (
            f"\n\nAdditional context from a coaching conversation — use this to inform "
            f"the deck's narrative, emphasis, and examples:\n\n{req.conversation_context[:3000]}"
        )

    # ── Call 1: generate outline ────────────────────────────────────────────
    resp1 = client.chat.completions.create(
        model=deployment,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        tools=[outline_tool],
        tool_choice={"type": "function", "function": {"name": "generate_deck_outline"}},
        max_completion_tokens=4000,
    )
    tc1 = resp1.choices[0].message.tool_calls[0]
    outline = json.loads(tc1.function.arguments)
    yield _sse({"type": "outline", "outline": outline})

    # ── Call 2: review + improve ────────────────────────────────────────────
    resp2 = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            resp1.choices[0].message,
            {"role": "tool", "tool_call_id": tc1.id, "content": json.dumps(outline)},
            {
                "role": "user",
                "content": (
                    "Critically review this outline. Evaluate: narrative flow, audience alignment, "
                    "content depth, layout variety, and storytelling impact. "
                    "Return recommendations AND a fully improved outline that addresses every issue."
                ),
            },
        ],
        tools=[review_tool],
        tool_choice={"type": "function", "function": {"name": "review_deck_outline"}},
        max_completion_tokens=5000,
    )
    tc2 = resp2.choices[0].message.tool_calls[0]
    review = json.loads(tc2.function.arguments)
    yield _sse({
        "type": "review",
        "overall_assessment": review.get("overall_assessment", ""),
        "recommendations":    review.get("recommendations", []),
        "improved_outline":   review.get("improved_outline", outline),
    })
    yield _sse({"type": "done"})


@router.post("/presentation/outline")
async def outline_endpoint(req: OutlineRequest):
    return StreamingResponse(_generate(req), media_type="text/event-stream")


@router.post("/presentation/build")
async def build_endpoint(req: BuildRequest):
    pptx_bytes = build_presentation(req.outline)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="presentation.pptx"'},
    )
