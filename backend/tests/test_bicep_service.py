"""Tests for bicep_service.build_and_preview — mocks az subprocess."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import bicep_service


@pytest.mark.asyncio
async def test_build_and_preview_valid(monkeypatch):
    arm_template = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        "resources": [
            {
                "name": "stg1",
                "type": "Microsoft.Storage/storageAccounts",
                "apiVersion": "2023-01-01",
                "location": "eastus",
            }
        ],
    }
    stdout_bytes = json.dumps(arm_template).encode("utf-8")
    stderr_bytes = b""

    fake_proc = SimpleNamespace(
        returncode=0,
        communicate=AsyncMock(return_value=(stdout_bytes, stderr_bytes)),
    )

    async def fake_exec(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(bicep_service.asyncio, "create_subprocess_exec", fake_exec)

    result = await bicep_service.build_and_preview("resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = { }")

    assert result["valid"] is True
    assert result["total_count"] == 1
    assert result["resources"][0]["type"] == "Microsoft.Storage/storageAccounts"
    assert result["resources"][0]["api_version"] == "2023-01-01"
    assert result["resources"][0]["location"] == "eastus"
    assert result["errors"] == []
    assert result["arm_template"] is not None


@pytest.mark.asyncio
async def test_build_and_preview_with_errors(monkeypatch):
    stderr_text = (
        "/tmp/tmp.bicep(5,3) : Error BCP034: The enclosing array expected an item of type \"string\".\n"
        "/tmp/tmp.bicep(7,1) : Warning BCP081: Resource type may not exist.\n"
    )
    fake_proc = SimpleNamespace(
        returncode=1,
        communicate=AsyncMock(return_value=(b"", stderr_text.encode("utf-8"))),
    )

    async def fake_exec(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(bicep_service.asyncio, "create_subprocess_exec", fake_exec)

    result = await bicep_service.build_and_preview("invalid bicep content")

    assert result["valid"] is False
    assert result["total_count"] == 0
    assert result["arm_template"] is None
    codes = {e["code"] for e in result["errors"]}
    assert "BCP034" in codes
    assert "BCP081" in codes
    err = next(e for e in result["errors"] if e["code"] == "BCP034")
    assert err["line"] == 5
    assert err["col"] == 3
    assert err["severity"] == "Error"


@pytest.mark.asyncio
async def test_build_and_preview_empty_input():
    result = await bicep_service.build_and_preview("")
    assert result["valid"] is False
    assert result["total_count"] == 0
    assert result["resources"] == []


@pytest.mark.asyncio
async def test_build_and_preview_cli_missing(monkeypatch):
    async def fake_exec(*args, **kwargs):
        raise FileNotFoundError("az not on PATH")

    monkeypatch.setattr(bicep_service.asyncio, "create_subprocess_exec", fake_exec)
    result = await bicep_service.build_and_preview("resource x 'Foo/Bar@2020-01-01' = {}")
    assert result["valid"] is False
    assert any(e["code"] == "BCP_CLI_MISSING" for e in result["errors"])
