"""Tests for the structured-tool recommendation layer in agent_router.

These cover the deterministic paths (keyword recommender + legacy-mode shim)
without touching the LLM classifier, so they run offline.
"""
import pytest

from services import agent_router


@pytest.mark.parametrize(
    "message, agent, expected",
    [
        ("Help me right-size my AKS node pools to cut spend", "cost", "cost-optimize"),
        ("Set up a savings plan and reservation strategy", "cost", "cost-optimize"),
        ("Run a STRIDE threat model on this design", "compliance", "threatmodel"),
        ("We need a disaster recovery plan with RTO/RPO targets", "operations", "drbc"),
        ("Design our reliability SLOs and availability zones", "operations", "reliability"),
        ("Author an incident runbook for the outage", "operations", "runbookstudio"),
        ("Start a requirements intake for a new engagement", "engagement", "intake"),
        ("Build an executive deck / pptx for the steering committee", "engagement", "presentation"),
        ("Design a landing zone with management groups", "architect", "landingzone"),
        ("Generate a naming convention for resources", "architect", "namingstandards"),
    ],
)
def test_recommend_tool_matches(message, agent, expected):
    assert agent_router.recommend_tool(message, agent) == expected


def test_recommend_tool_requires_matching_agent():
    # Threat-model keywords under the cost agent must NOT surface the tool —
    # recommendations are only coherent with their owning agent.
    assert agent_router.recommend_tool("run a STRIDE threat model", "cost") == ""


def test_recommend_tool_no_match_returns_empty():
    assert agent_router.recommend_tool("what is azure service bus?", "architect") == ""


def test_recommend_tool_handles_blank_message():
    assert agent_router.recommend_tool("", "cost") == ""


def test_shim_legacy_mode_carries_recommended_tool():
    routing = agent_router.shim_legacy_mode("drbc")
    assert routing is not None
    assert routing["agent"] == "operations"
    assert routing["recommended_tool"] == "drbc"


def test_shim_legacy_mode_finops_maps_to_cost_optimize():
    routing = agent_router.shim_legacy_mode("finops")
    assert routing is not None
    assert routing["agent"] == "cost"
    assert routing["recommended_tool"] == "cost-optimize"


def test_shim_legacy_mode_without_tool_is_empty_string():
    # `bicep` routes to architect but has no bespoke structured tool.
    routing = agent_router.shim_legacy_mode("bicep")
    assert routing is not None
    assert routing["recommended_tool"] == ""


def test_shim_legacy_mode_unknown_returns_none():
    assert agent_router.shim_legacy_mode("totally-unknown-mode") is None
