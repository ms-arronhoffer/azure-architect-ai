"""Smoke tests for the Terraform + ARM IaC emitters."""
from __future__ import annotations

import json

import pytest

from data.reference_archs import REFERENCE_ARCHS
from services.iac import (
    blueprint_from_reference_arch,
    emit_arm,
    emit_terraform,
)

# Pick three patterns with known SERVICE_CATALOG coverage.
_PATTERN_IDS = [
    "web-app-zone-redundant",
    "microservices-aks",
    "event-driven-serverless",
]


@pytest.mark.parametrize("pattern_id", _PATTERN_IDS)
def test_pattern_exists(pattern_id):
    assert any(a["id"] == pattern_id for a in REFERENCE_ARCHS), pattern_id


@pytest.mark.parametrize("pattern_id", _PATTERN_IDS)
def test_emit_terraform(pattern_id):
    bp = blueprint_from_reference_arch(pattern_id)
    out = emit_terraform(bp)
    assert "main.tf" in out
    assert "variables.tf" in out
    combined = out["main.tf"] + "\n" + out["variables.tf"]
    assert 'provider "azurerm"' in combined


@pytest.mark.parametrize("pattern_id", _PATTERN_IDS)
def test_emit_arm(pattern_id):
    bp = blueprint_from_reference_arch(pattern_id)
    out = emit_arm(bp)
    assert "azuredeploy.json" in out
    parsed = json.loads(out["azuredeploy.json"])
    assert "resources" in parsed
    assert isinstance(parsed["resources"], list)
