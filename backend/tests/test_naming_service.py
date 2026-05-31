"""CAF naming validator tests."""
from __future__ import annotations

from services.naming_service import (
    suggest_name,
    validate_batch,
    validate_name,
)


def test_validate_keyvault_good():
    r = validate_name("kv-prod-eastus-001", "keyVault", env="prod")
    assert r.valid is True
    assert r.errors == []


def test_validate_keyvault_caps_and_underscores():
    r = validate_name("KV_PROD_EASTUS_001", "keyVault", env="prod")
    assert r.valid is False
    # Underscore is not in the allowed character class for keyVault.
    assert any("outside" in e for e in r.errors)


def test_validate_storage_too_long():
    # storageAccount max_len is 24.
    long_name = "stmyworkloadproddevname12345"
    assert len(long_name) > 24
    r = validate_name(long_name, "storageAccount", env="prod")
    assert r.valid is False
    assert any("length" in e for e in r.errors)


def test_suggest_keyvault_pattern():
    name = suggest_name("keyVault", workload="payments", env="prod", region="eastus")
    # Pattern: kv-payments-prod-eastus
    assert name.startswith("kv-")
    assert "payments" in name
    assert "prod" in name
    assert "eastus" in name
    assert len(name) <= 24


def test_suggest_storage_strips_hyphens():
    name = suggest_name("storageAccount", workload="data", env="prod", region="eastus")
    assert "-" not in name
    assert name.islower()


def test_validate_batch_returns_one_per_item():
    items = [
        {"name": "kv-prod-eastus-001", "resource_type": "keyVault", "env": "prod"},
        {"name": "BAD_NAME", "resource_type": "keyVault", "env": "prod"},
    ]
    results = validate_batch(items)
    assert len(results) == 2
    assert results[0].valid is True
    assert results[1].valid is False
