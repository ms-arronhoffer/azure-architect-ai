"""Regression tests for the troubleshoot tool dispatch normalization.

The LLM tool schemas (backend/tools/domains/troubleshoot.py) use field names
that differ from the frontend TroubleshootingPanel contract (types.ts). The
dispatch in routes/chat.py must translate them, otherwise the Diagnosis / KQL /
Runbook tabs render against undefined fields and crash.
"""
from __future__ import annotations

import pytest

from routes.chat import _dispatch_tool


@pytest.mark.asyncio
async def test_diagnose_issue_maps_to_frontend_contract():
    args = {
        "symptom": "5xx errors from API gateway",
        "severity": "high",
        "blast_radius": "single region",
        "affected_services": ["API Management", "App Service"],
        "hypotheses": [
            {
                "cause": "Backend pool unhealthy",
                "likelihood": "high",
                "evidence_needed": "Check backend health probe",
                "rule_out_check": "Probe shows 200",
            }
        ],
    }
    result, event = await _dispatch_tool("diagnose_issue", args)

    assert result["status"] == "diagnosis_received"
    assert event["type"] == "diagnosis"
    diag = event["diagnosis"]
    assert diag["affected_services"] == ["API Management", "App Service"]
    assert diag["severity"] == "high"
    assert diag["estimated_blast_radius"] == "single region"
    assert len(diag["root_cause_hypotheses"]) == 1
    hyp = diag["root_cause_hypotheses"][0]
    assert hyp["hypothesis"] == "Backend pool unhealthy"
    assert hyp["likelihood"] == "high"
    assert hyp["evidence_to_confirm"] == "Check backend health probe"


@pytest.mark.asyncio
async def test_diagnose_issue_handles_missing_optional_fields():
    result, event = await _dispatch_tool(
        "diagnose_issue", {"symptom": "slow", "severity": "low", "hypotheses": []}
    )
    diag = event["diagnosis"]
    # affected_services must be a list so the frontend can .map() over it.
    assert diag["affected_services"] == []
    assert diag["root_cause_hypotheses"] == []


@pytest.mark.asyncio
async def test_generate_kql_queries_maps_kql_to_query():
    args = {
        "queries": [
            {
                "name": "5xx Errors",
                "purpose": "Find gateway errors",
                "table": "AzureDiagnostics",
                "kql": "AzureDiagnostics | where httpStatus_d >= 500",
                "time_window": "last 1h",
            }
        ]
    }
    _result, event = await _dispatch_tool("generate_kql_queries", args)
    assert event["type"] == "kql_queries"
    q = event["queries"][0]
    assert q["query"] == "AzureDiagnostics | where httpStatus_d >= 500"
    assert q["name"] == "5xx Errors"
    assert q["table"] == "AzureDiagnostics"


@pytest.mark.asyncio
async def test_generate_remediation_runbook_maps_step_fields():
    args = {
        "steps": [
            {
                "order": 1,
                "action": "Restart the app",
                "command": "az webapp restart",
                "expected_output": "App restarted",
                "fallback": "Scale out",
                "causes_downtime": True,
            }
        ],
        "escalation_path": "Page on-call",
        "estimated_resolution_minutes": 15,
    }
    _result, event = await _dispatch_tool("generate_remediation_runbook", args)
    assert event["type"] == "remediation_runbook"
    step = event["steps"][0]
    assert step["step_number"] == 1
    assert step["action"] == "Restart the app"
    assert step["if_fails"] == "Scale out"
    assert event["escalation_path"] == "Page on-call"
    assert event["estimated_minutes"] == 15
