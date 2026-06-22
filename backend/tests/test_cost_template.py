"""Tests for cost-model template parsing/validation (services/cost_template_service.py)."""
from __future__ import annotations

import json

from services import cost_template_service as ts


def test_sample_yaml_round_trips():
    content, media, filename = ts.sample_template("yaml")
    assert filename.endswith(".yaml")
    assert "application/x-yaml" in media
    parsed = ts.parse_template(content, "yaml")
    assert parsed["error"] is None
    assert parsed["model_name"]
    services = {it["service"] for it in parsed["items"]}
    assert "SQL Database" in services
    assert "Storage" in services
    # SQL line should carry its multi-meter dimensions
    sql = next(it for it in parsed["items"] if it["service"] == "SQL Database")
    assert sql["dimensions"]["storage_gb"] == 256
    assert sql["dimensions"]["backup_gb"] == 100


def test_sample_json_round_trips():
    content, _media, _f = ts.sample_template("json")
    parsed = ts.parse_template(content, "json")
    assert parsed["error"] is None
    assert any(it["service"] == "Azure Functions" for it in parsed["items"])


def test_sample_csv_folds_dimension_columns():
    content, _media, _f = ts.sample_template("csv")
    parsed = ts.parse_template(content, "csv")
    assert parsed["error"] is None
    storage = next(it for it in parsed["items"] if it["service"] == "Storage")
    assert storage["dimensions"]["capacity_gb"] == 5120
    assert storage["dimensions"]["write_ops_10k"] == 50
    # blank cells must not become zero dimensions
    assert "storage_gb" not in storage["dimensions"]


def test_format_inferred_when_unspecified():
    content, _m, _f = ts.sample_template("json")
    parsed = ts.parse_template(content, "")  # no explicit format
    assert parsed["error"] is None
    assert parsed["items"]


def test_unknown_service_warns_but_keeps_line():
    doc = json.dumps({"services": [{"name": "Nonexistent Service", "sku": "X"}]})
    parsed = ts.parse_template(doc, "json")
    assert parsed["error"] is None
    assert len(parsed["items"]) == 1
    assert any("not in the catalog" in w for w in parsed["warnings"])


def test_unknown_dimension_dropped_with_warning():
    doc = json.dumps(
        {"services": [{"name": "SQL Database", "sku": "GP_Gen5_2", "dimensions": {"bogus_gb": 10}}]}
    )
    parsed = ts.parse_template(doc, "json")
    item = parsed["items"][0]
    assert "bogus_gb" not in item["dimensions"]
    assert any("no billing dimension 'bogus_gb'" in w for w in parsed["warnings"])


def test_invalid_commitment_defaults_to_none():
    doc = json.dumps({"services": [{"name": "App Service", "sku": "P1v3", "commitment": "lifetime"}]})
    parsed = ts.parse_template(doc, "json")
    assert parsed["items"][0]["commitment"] == "none"
    assert any("commitment 'lifetime' is invalid" in w for w in parsed["warnings"])


def test_non_numeric_dimension_ignored():
    doc = json.dumps(
        {"services": [{"name": "Storage", "sku": "Hot LRS", "dimensions": {"capacity_gb": "lots"}}]}
    )
    parsed = ts.parse_template(doc, "json")
    assert "capacity_gb" not in parsed["items"][0]["dimensions"]
    assert any("non-numeric" in w for w in parsed["warnings"])


def test_empty_services_is_error_not_crash():
    parsed = ts.parse_template(json.dumps({"services": []}), "json")
    assert parsed["error"]
    assert parsed["items"] == []


def test_garbage_input_returns_error():
    parsed = ts.parse_template("{not valid json", "json")
    assert parsed["error"]
