"""Tests for azure_scan_service drift-against-design additions."""

from services import azure_scan_service

SAMPLE_BICEP = """
param location string = 'eastus'

resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'stg1'
  location: location
}

resource site 'Microsoft.Web/sites@2022-09-01' = {
  name: 'site1'
  location: location
}

resource plan 'Microsoft.Web/serverFarms@2022-09-01-preview' = {
  name: 'plan1'
  location: location
}

resource stg2 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'stg2'
  location: location
}
"""


def test_extract_expected_types_from_bicep_returns_unique_sorted():
    types = azure_scan_service.extract_expected_types_from_bicep(SAMPLE_BICEP)
    assert types == [
        "Microsoft.Storage/storageAccounts",
        "Microsoft.Web/serverFarms",
        "Microsoft.Web/sites",
    ]


def test_extract_expected_types_from_bicep_empty():
    assert azure_scan_service.extract_expected_types_from_bicep("") == []
    assert azure_scan_service.extract_expected_types_from_bicep("param p string = 'x'") == []


def test_scan_drift_against_design_shape(monkeypatch):
    monkeypatch.setattr(
        azure_scan_service,
        "_resolve_subscription",
        lambda sub: sub or "fake-sub-id",
    )
    monkeypatch.setattr(
        azure_scan_service,
        "list_resources",
        lambda sub=None: [
            {
                "id": "/r/stg",
                "name": "stg",
                "type": "microsoft.storage/storageaccounts",
                "tags": {"environment": "prod", "owner": "team-a", "costCenter": "cc1"},
            },
            {
                "id": "/r/site",
                "name": "site",
                "type": "microsoft.web/sites",
                "tags": {},
            },
        ],
    )
    monkeypatch.setattr(
        azure_scan_service,
        "list_public_ips",
        lambda sub=None: [
            {"id": "/r/pip1", "name": "pip1", "ipAddress": "1.2.3.4", "resourceGroup": "rg1"}
        ],
    )
    monkeypatch.setattr(
        azure_scan_service,
        "list_open_nsg_rules",
        lambda sub=None: [
            {
                "name": "nsg1",
                "ruleName": "allow-ssh",
                "destinationPortRange": "22",
                "protocol": "Tcp",
                "resourceGroup": "rg1",
            }
        ],
    )

    report = azure_scan_service.scan_drift_against_design(
        design_name="my-design",
        bicep_code=SAMPLE_BICEP,
        subscription_id="sub-123",
    )

    assert report["subscription_id"] == "sub-123"
    assert report["design"]["name"] == "my-design"
    assert "Microsoft.Storage/storageAccounts" in report["design"]["expected_types"]
    assert report["summary"]["total_resources"] == 2
    assert report["summary"]["public_ips"] == 1
    coverage = report["findings"]["service_coverage"]
    assert "Microsoft.Storage/storageAccounts" in coverage["present"]
    assert "Microsoft.Web/serverFarms" in coverage["missing"]
    assert len(report["findings"]["tag_violations"]) == 1
    assert report["findings"]["tag_violations"][0]["name"] == "site"
    assert report["findings"]["public_exposure"][0]["ip"] == "1.2.3.4"
    assert report["findings"]["open_management_ports"][0]["port"] == "22"
