"""Code generator route — generates code files via LLM and optionally pushes to GitHub."""

import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openai import BadRequestError, AuthenticationError, APIError
from pydantic import BaseModel

from auth import require_user, user_id_from_claims
from models import ModelConfig
from services.github_service import create_repo, get_authenticated_user, push_file
from services.openai_service import TOOL_INCOMPATIBLE_MODELS, resolve_client_and_model
from services.settings_service import load_settings
from tools.tool_definitions import get_tools

router = APIRouter()

CODEGEN_SYSTEM = (
    "You are a senior software engineer. Generate complete, production-ready code for the described requirements. "
    "Always call generate_code_files with all necessary files including configuration, dependencies, tests, and README. "
    "Write clean, idiomatic code with proper error handling. Include a requirements.txt or package.json as appropriate."
)


class GenerateRequest(BaseModel):
    requirements: str
    language: str = "python"
    framework: str = ""
    llm_config: ModelConfig | None = None


class PushRequest(BaseModel):
    repo_name: str
    files: list[dict]
    description: str = ""
    private: bool = True


async def _stream_codegen(req: GenerateRequest, provider: str, model: str, github_token: str) -> AsyncGenerator[str, None]:
    try:
        client, deployment = resolve_client_and_model("codegen", provider, model, github_token)
    except ValueError as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return

    if model in TOOL_INCOMPATIBLE_MODELS:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Model {model} does not support tool calling required for code generation.'})}\n\n"
        return

    tools = get_tools("generate_code_files")
    user = (
        f"Requirements: {req.requirements}\n"
        f"Language: {req.language}\n"
        f"Framework: {req.framework or 'none specified — choose the most appropriate'}\n\n"
        "Generate a complete, runnable project with all necessary files."
    )

    try:
        resp = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": CODEGEN_SYSTEM},
                {"role": "user", "content": user},
            ],
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "generate_code_files"}},
            max_completion_tokens=8000,
        )
    except (BadRequestError, AuthenticationError, APIError) as e:
        msg = getattr(e, "message", str(e))
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        return

    tc = resp.choices[0].message.tool_calls[0]
    result = json.loads(tc.function.arguments)

    for f in result.get("files", []):
        yield f"data: {json.dumps({'type': 'file', 'name': f['name'], 'content': f['content'], 'language': f.get('language', ''), 'description': f.get('description', '')})}\n\n"

    yield f"data: {json.dumps({'type': 'summary', 'summary': result.get('summary', ''), 'repo_name': result.get('repo_name', '')})}\n\n"
    yield "data: [DONE]\n\n"


@router.post("/codegen/generate")
async def codegen_generate(req: GenerateRequest, claims=Depends(require_user)):
    app_settings = await load_settings()
    mc = req.llm_config or app_settings.mode_models.get("codegen")
    provider = mc.provider if mc else "github-copilot"
    model = mc.model if mc else "gpt-4o"
    from db import session_scope
    from services.secret_store import get_secret
    user_id = user_id_from_claims(claims)
    async with session_scope() as session:
        github_token = await get_secret(session, user_id, "github_pat") or ""
    return StreamingResponse(
        _stream_codegen(req, provider, model, github_token),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/codegen/push")
async def codegen_push(req: PushRequest, claims=Depends(require_user)):
    from db import session_scope
    from services.secret_store import get_secret
    user_id = user_id_from_claims(claims)
    async with session_scope() as session:
        token = await get_secret(session, user_id, "github_pat") or ""
    if not token:
        raise HTTPException(status_code=400, detail="GitHub token not configured in settings.")

    user_info = await get_authenticated_user(token)
    owner = user_info["login"]

    repo_info = await create_repo(token, req.repo_name, req.private, req.description)
    repo_url = repo_info["html_url"]

    pushed: list[str] = []
    for f in req.files:
        name = f.get("name", "")
        content = f.get("content", "")
        if name and content:
            await push_file(token, owner, req.repo_name, name, content, f"Add {name}")
            pushed.append(name)

    return {"repo_url": repo_url, "files_pushed": pushed}
