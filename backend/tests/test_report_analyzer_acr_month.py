"""Tests for ACR month selection / data-lag fallback in report_analyzer_service."""

from datetime import date

from services.report_analyzer_service import (
    get_last_full_month_column,
    get_month_column_candidates,
    parse_acr_data,
)


def _csv(*data_rows: str) -> bytes:
    header = "FiscalMonth,,FY26-May,FY26-Jun,Total\n"
    label = "TPAccountName,ServiceCompGrouping,$ ACR,$ ACR,$ ACR\n"
    return (header + label + "".join(r + "\n" for r in data_rows)).encode()


def test_last_full_month_column():
    assert get_last_full_month_column(date(2026, 7, 13)) == "FY26-Jun"
    assert get_last_full_month_column(date(2026, 6, 13)) == "FY26-May"
    assert get_last_full_month_column(date(2026, 1, 5)) == "FY26-Dec"


def test_candidates_walk_backwards_across_fy_boundary():
    cands = get_month_column_candidates(date(2026, 7, 13), count=4)
    assert cands == ["FY26-Jun", "FY26-May", "FY26-Apr", "FY26-Mar"]

    cands = get_month_column_candidates(date(2026, 8, 1), count=3)
    # Jul 2026 is the start of FY27; the prior months roll back into FY26.
    assert cands == ["FY27-Jul", "FY26-Jun", "FY26-May"]


def test_prefers_most_recent_month_with_data():
    csv = _csv(
        'ABBOTT LABORATORIES,Total,"$37,027","$83,546","$120,573"',
    )
    res, used = parse_acr_data(csv, "acr.csv", get_month_column_candidates(date(2026, 7, 13)))
    assert used == "FY26-Jun"
    assert res["ABBOTT LABORATORIES"] == 83546.0


def test_falls_back_when_latest_month_all_zero():
    # June column is $0 / blank for every account (billing data has not landed).
    csv = _csv(
        'ABBOTT LABORATORIES,Total,"$37,027","$0","$37,027"',
        'AMEDISYS,Total,"$499","","$499"',
    )
    res, used = parse_acr_data(csv, "acr.csv", get_month_column_candidates(date(2026, 7, 13)))
    assert used == "FY26-May"
    assert res["ABBOTT LABORATORIES"] == 37027.0
    assert res["AMEDISYS"] == 499.0


def test_single_string_month_col_still_supported():
    csv = _csv('ABBOTT LABORATORIES,Total,"$37,027","$83,546","$120,573"')
    res, used = parse_acr_data(csv, "acr.csv", "FY26-Jun")
    assert used == "FY26-Jun"
    assert res["ABBOTT LABORATORIES"] == 83546.0
