"""Tests for report analyzer file-format detection."""

import io

import openpyxl

from services import report_analyzer_service


def test_legacy_xls_content_is_detected_when_filename_says_xlsx(monkeypatch):
    legacy_data = b"\xd0\xcf\x11\xe0legacy workbook"
    monkeypatch.setattr(
        report_analyzer_service,
        "_xls_to_csv_bytes",
        lambda data: b"Account,TPID\nContoso,42\n",
    )

    rows = report_analyzer_service._to_raw_rows(
        legacy_data, "Account Details by Subscription.xlsx"
    )

    assert rows == [["Account", "TPID"], ["Contoso", "42"]]


def test_xlsx_content_is_detected_without_relying_on_filename():
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.append(["Account", "TPID"])
    worksheet.append(["Contoso", 42])
    data = io.BytesIO()
    workbook.save(data)
    workbook.close()

    rows = report_analyzer_service._to_raw_rows(data.getvalue(), "export.csv")

    assert rows == [["Account", "TPID"], ["Contoso", "42"]]


def test_csv_content_is_parsed_when_filename_says_xlsx():
    rows = report_analyzer_service._to_raw_rows(
        b"Account,TPID\nContoso,42\n", "export.xlsx"
    )

    assert rows == [["Account", "TPID"], ["Contoso", "42"]]
