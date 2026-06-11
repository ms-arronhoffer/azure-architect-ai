"""
MCP client managing two stdio MCP servers:
  1. @azure/mcp  — documentation, well-architected, bicep schema, advisor, quota
  2. azure-pricing-mcp — dedicated Azure retail pricing (higher quality)
Gracefully degrades if either server fails to start.
"""
import json
import logging

log = logging.getLogger(__name__)

# Raw tool name -> MCP ClientSession
_session_map: dict[str, object] = {}
_tools_cache: list[dict] | None = None

# Subsets of @azure/mcp tools relevant to an architect assistant.
# "pricing" intentionally excluded — replaced by azure-pricing-mcp.
_AZURE_MCP_WHITELIST = frozenset({
    "documentation",
    "wellarchitect",
    "bestpractice",
    "cloudarchitect",
    "bicepschema",
    "advisor",
    "quota",
    "subscription_list",
})


def _is_azure_mcp_relevant(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in _AZURE_MCP_WHITELIST)


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


async def _start_server(stack, params, filter_fn=None) -> tuple[object, list[dict]]:
    """Start one MCP stdio server and return (session, openai_tools)."""
    from mcp import ClientSession, StdioServerParameters  # noqa: F401
    from mcp.client.stdio import stdio_client

    read, write = await stack.enter_async_context(stdio_client(params))
    session = await stack.enter_async_context(ClientSession(read, write))
    await session.initialize()

    tools_resp = await session.list_tools()
    tools = tools_resp.tools
    if filter_fn:
        tools = [t for t in tools if filter_fn(t.name)]

    return session, [_tool_to_openai(t) for t in tools]


async def init_mcp(stack) -> None:
    global _session_map, _tools_cache
    try:
        from mcp import ClientSession, StdioServerParameters  # noqa: F401
    except ImportError:
        log.warning("MCP SDK not installed — skipping MCP integration")
        _tools_cache = []
        return

    from mcp import StdioServerParameters

    merged_tools: list[dict] = []
    new_map: dict[str, object] = {}

    # --- @azure/mcp ---
    try:
        params = StdioServerParameters(
            command="npx",
            args=["-y", "@azure/mcp@latest", "server", "start"],
        )
        session, tools = await _start_server(stack, params, filter_fn=_is_azure_mcp_relevant)
        for t in tools:
            raw = t["function"]["name"][4:]  # strip "mcp_"
            new_map[raw] = session
        merged_tools.extend(tools)
        log.info("MCP azure-mcp: loaded %d tools", len(tools))
    except Exception as exc:
        log.warning("MCP azure-mcp init failed: %s", exc)

    # --- azure-pricing-mcp ---
    try:
        params = StdioServerParameters(
            command="python",
            args=["/opt/azure-pricing-mcp/azure_pricing_server.py"],
        )
        session, tools = await _start_server(stack, params)
        for t in tools:
            raw = t["function"]["name"][4:]
            new_map[raw] = session
        merged_tools.extend(tools)
        log.info("MCP azure-pricing-mcp: loaded %d tools", len(tools))
    except Exception as exc:
        log.warning("MCP azure-pricing-mcp init failed: %s", exc)

    _session_map = new_map
    _tools_cache = merged_tools
    log.info("MCP total tools available: %d", len(merged_tools))


def get_mcp_tools() -> list[dict]:
    return _tools_cache or []


def is_mcp_available() -> bool:
    return _tools_cache is not None and len(_tools_cache) > 0


def is_mcp_tool(name: str) -> bool:
    return name.startswith("mcp_")


async def call_mcp_tool(name: str, args: dict) -> str:
    raw_name = name[4:]  # strip "mcp_"
    session = _session_map.get(raw_name)
    if session is None:
        return json.dumps({"error": "MCP session not available"})
    try:
        result = await session.call_tool(raw_name, args)
        parts: list[str] = []
        for item in result.content:
            if hasattr(item, "text"):
                parts.append(item.text)
        return "\n".join(parts) if parts else json.dumps({"result": "empty"})
    except Exception as exc:
        log.error("MCP tool %s failed: %s", raw_name, exc)
        return json.dumps({"error": str(exc)})
