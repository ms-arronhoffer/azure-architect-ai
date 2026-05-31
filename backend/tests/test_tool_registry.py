"""Sanity checks on the tool registry: uniqueness, mode coverage, dispatch."""
from __future__ import annotations

import pytest

from tools.tool_definitions import (
    TOOLS,
    TOOLS_BY_MODE,
    _BY_NAME,
    get_tools_for_mode,
)


def test_tools_total_count():
    assert len(TOOLS) > 30, f"expected >30 tools, got {len(TOOLS)}"


def test_tool_names_unique():
    names = [t["function"]["name"] for t in TOOLS]
    assert len(names) == len(set(names)), "duplicate tool names found"


def test_every_mode_tool_resolves():
    for mode, tools in TOOLS_BY_MODE.items():
        for t in tools:
            name = t["function"]["name"]
            assert name in _BY_NAME, f"mode {mode!r} references unknown tool {name!r}"


def test_every_mode_has_at_least_one_tool():
    for mode, tools in TOOLS_BY_MODE.items():
        assert len(tools) >= 1, f"mode {mode!r} has no tools"


def test_qa_mode_dispatch(monkeypatch):
    # Avoid MCP service network/IO when computing get_tools_for_mode("qa").
    import services.mcp_service as mcp

    monkeypatch.setattr(mcp, "get_mcp_tools", lambda: [])
    qa_tools = get_tools_for_mode("qa")
    names = {t["function"]["name"] for t in qa_tools}
    assert {"search_azure_docs", "compare_services", "recommend_service"} <= names


def test_unknown_mode_returns_empty(monkeypatch):
    import services.mcp_service as mcp

    monkeypatch.setattr(mcp, "get_mcp_tools", lambda: [])
    assert get_tools_for_mode("nonexistent") == []


@pytest.mark.parametrize("mode", sorted(TOOLS_BY_MODE.keys()))
def test_each_mode_dispatch(mode, monkeypatch):
    import services.mcp_service as mcp

    monkeypatch.setattr(mcp, "get_mcp_tools", lambda: [])
    result = get_tools_for_mode(mode)
    assert isinstance(result, list)
    # Every tool returned must round-trip through the name registry.
    for t in result:
        assert t["function"]["name"] in _BY_NAME
