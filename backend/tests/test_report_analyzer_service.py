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
