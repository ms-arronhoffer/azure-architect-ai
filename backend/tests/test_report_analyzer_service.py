"""Tests for report_analyzer_service file loading (Org Tracker report uploads)."""
from __future__ import annotations

from pathlib import Path

import pytest

from services.report_analyzer_service import load_file

_FIXTURES = Path(__file__).parent / "fixtures"


def test_password_protected_xlsx_raises_friendly_error():
    """Password-protected .xlsx files are OLE2/CFB containers with an
    "EncryptedPackage" stream instead of a legacy BIFF "Workbook" stream,
    which previously surfaced as the opaque xlrd error:
    "Can't find workbook in OLE2 compound document".
    """
    data = (_FIXTURES / "encrypted_sample.xlsx").read_bytes()

    with pytest.raises(ValueError, match="password-protected"):
        load_file(data, "encrypted_sample.xlsx")


def test_plain_xlsx_still_loads():
    """Sanity check: an ordinary (unencrypted) .xlsx file still loads fine."""
    import io

    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Name", "Value"])
    ws.append(["Foo", "1"])
    buf = io.BytesIO()
    wb.save(buf)

    rows = load_file(buf.getvalue(), "plain.xlsx")
    assert rows == [{"Name": "Foo", "Value": "1"}]


def test_parse_acr_data_total_row_match_is_case_and_whitespace_insensitive():
    """Some Power BI exports label the all-services row "TOTAL" or "Total "
    (trailing space) instead of exactly "Total"; the ACR should still parse.
    """
    from services.report_analyzer_service import parse_acr_data

    csv_bytes = (
        "FiscalMonth,,FY26-Jun,Total\n"
        "TPAccountName,ServiceCompGrouping,$ ACR,$ ACR\n"
        "ABBOTT LABORATORIES,TOTAL ,\"$37,027\",\"$37,027\"\n"
    ).encode("utf-8")

    result = parse_acr_data(csv_bytes, "acr.csv", "FY26-Jun")
    assert result == {"ABBOTT LABORATORIES": 37027.0}


def test_parse_acr_data_normalizes_whitespace_in_name():
    """Account names with double spaces / NBSP should still key consistently
    with the OU/Manager-List side of the join.
    """
    from services.report_analyzer_service import parse_acr_data

    csv_bytes = (
        "FiscalMonth,,FY26-Jun\n"
        "TPAccountName,ServiceCompGrouping,$ ACR\n"
        "ABBOTT  LABORATORIES,Total,\"$1,000\"\n"
    ).encode("utf-8")

    result = parse_acr_data(csv_bytes, "acr.csv", "FY26-Jun")
    assert result == {"ABBOTT LABORATORIES": 1000.0}


def test_build_org_scorecard_falls_back_to_manager_list_name_match():
    """When the ACR account name doesn't match the OU deployment "TP Name"
    but does match the Manager List's "Account Name", the ACR should still
    be attributed to the account instead of silently showing $0.
    """
    from services.report_analyzer_service import (
        build_name_to_tpid,
        build_manager_name_to_tpid,
        build_org_map,
        build_org_scorecard,
        build_tpid_index,
        parse_deployments,
    )

    ml_rows = [{"TPID": "123", "Account Name": "Abbott Laboratories", "Azure CSA M": "alice"}]
    org_map, account_directors = build_org_map(ml_rows)

    # OU deployment file uses a differently-formatted name than the Manager List.
    ou_rows = [{"TPID": "123", "TP Name": "ABBOTT LABS INC", "Model": "gpt-4", "Version": "",
                "Retirement Date": "", "Tokens Week-1": "2"}]
    deployments = parse_deployments(ou_rows)
    tpid_index = build_tpid_index(deployments)

    name_to_tpid = {**build_manager_name_to_tpid(org_map), **build_name_to_tpid(deployments)}

    # ACR export names the account per the Manager List, not the OU file.
    acr_by_name = {"ABBOTT LABORATORIES": 5000.0}

    scorecard = build_org_scorecard(
        org_map, account_directors, tpid_index, {}, acr_by_name, name_to_tpid,
        __import__("datetime").date(2026, 7, 1),
    )

    assert scorecard["totals"]["totalMonthlyAcr"] == 5000.0
    assert scorecard["allAccounts"][0]["monthlyAcr"] == 5000.0
    assert scorecard["unmatchedAcrAccounts"] == []


def test_build_org_scorecard_reports_unmatched_acr_names():
    """An ACR account name that matches neither source should surface as a
    diagnosable "unmatched" entry rather than silently vanishing into $0."""
    from services.report_analyzer_service import (
        build_name_to_tpid,
        build_manager_name_to_tpid,
        build_org_map,
        build_org_scorecard,
        build_tpid_index,
        parse_deployments,
    )

    ml_rows = [{"TPID": "123", "Account Name": "Abbott Laboratories", "Azure CSA M": "alice"}]
    org_map, account_directors = build_org_map(ml_rows)

    ou_rows = [{"TPID": "123", "TP Name": "Abbott Laboratories", "Model": "gpt-4", "Version": "",
                "Retirement Date": "", "Tokens Week-1": "2"}]
    deployments = parse_deployments(ou_rows)
    tpid_index = build_tpid_index(deployments)
    name_to_tpid = {**build_manager_name_to_tpid(org_map), **build_name_to_tpid(deployments)}

    acr_by_name = {"ABBOTT LABORATORIES": 100.0, "SOME UNKNOWN CUSTOMER": 42.0}

    scorecard = build_org_scorecard(
        org_map, account_directors, tpid_index, {}, acr_by_name, name_to_tpid,
        __import__("datetime").date(2026, 7, 1),
    )

    assert scorecard["totals"]["totalMonthlyAcr"] == 100.0
    assert scorecard["unmatchedAcrAccounts"] == [{"name": "SOME UNKNOWN CUSTOMER", "monthlyAcr": 42.0}]
