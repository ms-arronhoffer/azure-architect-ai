from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health")
async def health():
    from services.mcp_service import get_mcp_tools, is_mcp_available
    mcp_tool_count = len(get_mcp_tools())
    return JSONResponse({
        "status": "ok",
        "service": "azure-architect-ai",
        "mcp_available": is_mcp_available(),
        "mcp_tool_count": mcp_tool_count,
    })
