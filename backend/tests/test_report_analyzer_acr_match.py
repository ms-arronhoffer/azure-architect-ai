"""Tests for ACR → account name matching in report_analyzer_service.

Guards against ACR silently reporting $0 when the Power BI account name differs
cosmetically from the OU deployment "TP Name", or when the account only exists in
the Manager List.
"""

from datetime import date

from services.report_analyzer_service import (
    _normalize_name,
    build_manager_name_to_tpid,
    build_name_to_tpid,
    build_org_scorecard,
    parse_acr_data,
)


def _acr_csv(*data_rows: str) -> bytes:
    header = "FiscalMonth,,FY26-May,FY26-Jun,Total\n"
    label = "TPAccountName,ServiceCompGrouping,$ ACR,$ ACR,$ ACR\n"
    return (header + label + "".join(r + "\n" for r in data_rows)).encode()


def test_normalize_name_collapses_whitespace_and_case():
    assert _normalize_name("  Abbott   Laboratories ") == "ABBOTT LABORATORIES"
    assert _normalize_name("Abbott\xa0Laboratories") == "ABBOTT LABORATORIES"
    assert _normalize_name(None) == ""


def test_parse_acr_data_normalizes_keys():
    csv = _acr_csv('Abbott   Laboratories,Total,"$1","$2","$3"')
    res, _ = parse_acr_data(csv, "acr.csv", "FY26-Jun")
    assert res == {"ABBOTT LABORATORIES": 2.0}


def test_build_name_to_tpid_normalizes():
    deps = [{"TP Name": "Abbott   Laboratories", "_tpid": "42"}]
    assert build_name_to_tpid(deps) == {"ABBOTT LABORATORIES": "42"}


def test_build_manager_name_to_tpid():
    org_map = {"Dir": {"accounts": [{"tpid": "7", "name": "Amedisys  Inc"}]}}
    assert build_manager_name_to_tpid(org_map) == {"AMEDISYS INC": "7"}


def _scorecard(acr_by_name, name_to_tpid, org_map, tpid_index):
    return build_org_scorecard(
        org_map=org_map,
        account_directors={t: ["Dir"] for accts in org_map.values() for a in accts["accounts"] for t in [a["tpid"]]},
        tpid_index=tpid_index,
        ret_lookup={},
        acr_by_name=acr_by_name,
        name_to_tpid=name_to_tpid,
        today=date(2026, 7, 13),
    )


def test_acr_matches_despite_whitespace_difference():
    # Deployment "TP Name" has a single space; ACR name has double spaces.
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "Abbott Laboratories"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    name_to_tpid = build_manager_name_to_tpid(org_map)
    name_to_tpid.update(build_name_to_tpid([{"TP Name": "Abbott Laboratories", "_tpid": "42"}]))
    acr_by_name = {_normalize_name("Abbott   Laboratories"): 5000.0}

    sc = _scorecard(acr_by_name, name_to_tpid, org_map, tpid_index)
    assert sc["allAccounts"][0]["monthlyAcr"] == 5000.0
    assert sc["unmatchedAcrAccounts"] == []


def test_unmatched_acr_names_are_surfaced_not_dropped():
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "Abbott Laboratories"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    name_to_tpid = build_manager_name_to_tpid(org_map)
    acr_by_name = {"ABBOTT LABORATORIES": 5000.0, "SOME MYSTERY ACCOUNT": 900.0}

    sc = _scorecard(acr_by_name, name_to_tpid, org_map, tpid_index)
    assert sc["allAccounts"][0]["monthlyAcr"] == 5000.0
    assert sc["unmatchedAcrAccounts"] == [
        {"name": "SOME MYSTERY ACCOUNT", "monthlyAcr": 900.0}
    ]


def test_acr_for_tpid_without_deployments_is_surfaced():
    # Account resolves to a TPID via the Manager List but has no deployment rows,
    # so it never appears in allAccounts — its ACR must not silently vanish.
    org_map = {
        "Dir": {
            "accounts": [
                {"tpid": "42", "name": "Abbott Laboratories"},
                {"tpid": "99", "name": "No Deployments Account"},
            ]
        }
    }
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    name_to_tpid = build_manager_name_to_tpid(org_map)
    acr_by_name = {"ABBOTT LABORATORIES": 5000.0, "NO DEPLOYMENTS ACCOUNT": 700.0}

    sc = _scorecard(acr_by_name, name_to_tpid, org_map, tpid_index)
    assert [a["tpid"] for a in sc["allAccounts"]] == ["42"]
    assert sc["unmatchedAcrAccounts"] == [
        {"name": "NO DEPLOYMENTS ACCOUNT", "monthlyAcr": 700.0}
    ]
