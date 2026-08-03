"""Tests for report analyzer file-format detection."""

import io

import openpyxl
import pytest

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


def test_encrypted_workbook_reports_actionable_error():
    encrypted = (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        + "EncryptedPackage".encode("utf-16-le")
        + b"\x00" * 16
    )

    with pytest.raises(ValueError) as excinfo:
        report_analyzer_service._to_raw_rows(encrypted, "ACR Details by Quarter Month.xlsx")

    message = str(excinfo.value)
    assert "ACR Details by Quarter Month.xlsx" in message
    assert "sensitivity label" in message


def test_unreadable_ole2_document_names_the_offending_file(monkeypatch):
    def _boom(_data: bytes) -> bytes:
        raise ValueError("Can't find workbook in OLE2 compound document")

    monkeypatch.setattr(report_analyzer_service, "_xls_to_csv_bytes", _boom)

    with pytest.raises(ValueError) as excinfo:
        report_analyzer_service._to_raw_rows(b"\xd0\xcf\x11\xe0junk", "manager_list.xls")

    message = str(excinfo.value)
    assert "manager_list.xls" in message
    assert "Save As" in message


def test_corrupt_xlsx_error_names_the_offending_file(monkeypatch):
    def _boom(_data: bytes) -> bytes:
        raise ValueError("File is not a zip file")

    monkeypatch.setattr(report_analyzer_service, "_xlsx_to_csv_bytes", _boom)

    with pytest.raises(ValueError) as excinfo:
        report_analyzer_service._to_raw_rows(b"PK\x03\x04broken", "acr.xlsx")

    assert "acr.xlsx" in str(excinfo.value)
