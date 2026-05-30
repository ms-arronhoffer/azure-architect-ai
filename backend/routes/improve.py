from fastapi import APIRouter
from pydantic import BaseModel

from services.openai_service import get_client, get_deployment

router = APIRouter()


class ImproveRequest(BaseModel):
    text: str


@router.post("/improve")
async def improve_text(req: ImproveRequest):
    if not req.text.strip():
        return {"improved": req.text}

    client = get_client()
    deployment = get_deployment("chat")

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a technical writing specialist for Azure cloud architecture. "
                    "Rewrite the given requirements text to be more specific, complete, and actionable. "
                    "Add missing technical details (scale expectations, user types, SLAs, integrations, data flows) "
                    "where the text is vague, inferring reasonable defaults from context. "
                    "Keep it concise — 3 to 6 sentences, plain prose, no bullet points or headers. "
                    "Return only the improved text with no preamble or explanation."
                ),
            },
            {
                "role": "user",
                "content": f"Improve this Azure architecture requirements description:\n\n{req.text}",
            },
        ],
        max_completion_tokens=400,
    )

    return {"improved": response.choices[0].message.content or req.text}
