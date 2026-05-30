"""
MCP (Model Context Protocol) client for azure-mcp and Microsoft Learn tools.
Connects via stdio transport to @azure/mcp server subprocess at startup.
Gracefully degrades to no MCP tools if Node.js / azure-mcp is unavailable.
"""
import json
import logging
from contextlib import AsyncExitStack

log = logging.getLogger(__name__)

_session = None
_tools_cache: list[dict] | None = None

# Tool name substrings that are relevant to an Azure architect assistant.
# Filters out VM/resource-management tools that require subscription context.
_WHITELIST = frozenset({
    "documentation",
    "pricing",
    "wellarchitect",
    "bestpractice",
    "cloudarchitect",
    "bicepschema",
    "advisor",
    "quota",
    "subscription_list",
})


def _is_relevant(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in _WHITELIST)


def _tool_to_openai(tool) -> dict:
    schema = {}
    if hasattr(tool, "inputSchema") and tool.inputSchema:
        schema = tool.inputSchema
    elif hasattr(tool, "input_schema") and tool.input_schema:
        schema = tool.input_schema
    if not schema:
        schema = {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {
            "name": f"mcp_{tool.name}",
            "description": (tool.description or "").strip()[:512],
            "parameters": schema,
        },
    }


async def init_mcp(stack: AsyncExitStack) -> None:
    """Start azure-mcp subprocess and populate tools cache. Non-fatal on failure."""
    global _session, _tools_cache
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        log.warning("MCP SDK not installed — skipping MCP integration")
        _tools_cache = []
        return

    try:
        params = StdioServerParameters(
            command="npx",
            args=["-y", "@azure/mcp@latest", "server", "start"],
        )
        read, write = await stack.enter_async_context(stdio_client(params))
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()

        tools_resp = await session.list_tools()
        all_tools = tools_resp.tools
        relevant = [t for t in all_tools if _is_relevant(t.name)]

        _session = session
        _tools_cache = [_tool_to_openai(t) for t in relevant]
        log.info("MCP: loaded %d/%d tools from azure-mcp", len(_tools_cache), len(all_tools))
    except Exception as exc:
        log.warning("MCP init failed (app continues without MCP tools): %s", exc)
        _tools_cache = []


def get_mcp_tools() -> list[dict]:
    return _tools_cache or []


def is_mcp_tool(name: str) -> bool:
    return name.startswith("mcp_")


async def call_mcp_tool(name: str, args: dict) -> str:
    """Call an MCP tool by its OpenAI-prefixed name. Returns plain text or JSON string."""
    if _session is None:
        return json.dumps({"error": "MCP session not available"})
    raw_name = name[4:]  # strip "mcp_" prefix
    try:
        result = await _session.call_tool(raw_name, args)
        parts: list[str] = []
        for item in result.content:
            if hasattr(item, "text"):
                parts.append(item.text)
        return "\n".join(parts) if parts else json.dumps({"result": "empty"})
    except Exception as exc:
        log.error("MCP tool %s failed: %s", raw_name, exc)
        return json.dumps({"error": str(exc)})
