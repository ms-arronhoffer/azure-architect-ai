"""Secret scanner + redactor unit tests for services/audit_service.py."""
from __future__ import annotations

import pytest

from services.audit_service import redact, scan_for_secrets


def test_scan_detects_github_classic_pat():
    body = b'{"token": "ghp_' + b"a" * 36 + b'"}'
    assert "github_pat" in scan_for_secrets(body)


def test_scan_detects_github_fine_grained_pat():
    body = b'{"token": "github_pat_' + b"a" * 82 + b'"}'
    assert "github_fine_grained_pat" in scan_for_secrets(body)


def test_scan_detects_aws_access_key():
    assert "aws_access_key" in scan_for_secrets(b"AKIA1234567890ABCDEF embedded")


def test_scan_detects_jwt():
    # 3-segment base64ish token: pyjwt encodes header.payload.signature
    fake = b"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij"
    assert "jwt" in scan_for_secrets(fake)


def test_scan_detects_bearer_header_inline():
    body = b'note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"'
    assert "bearer_header_inline" in scan_for_secrets(body)


def test_scan_detects_connection_string_password():
    body = b"Server=tcp:foo;Password=Sup3rSecret!;Database=x"
    assert "connection_string_password" in scan_for_secrets(body)


def test_scan_clean_body_returns_empty():
    assert scan_for_secrets(b'{"prompt": "design an AKS landing zone"}') == []


def test_scan_empty_body():
    assert scan_for_secrets(b"") == []


def test_scan_dedupes_kinds():
    body = b"ghp_" + b"a" * 36 + b" and ghp_" + b"b" * 36
    hits = scan_for_secrets(body)
    assert hits.count("github_pat") == 1


def test_redact_replaces_match_with_marker():
    body = b"token=ghp_" + b"a" * 36 + b" trailing"
    out = redact(body)
    assert b"[REDACTED:github_pat]" in out
    assert b"a" * 36 not in out
    assert b"trailing" in out


def test_redact_leaves_clean_body_untouched():
    body = b'{"prompt": "hello"}'
    assert redact(body) == body
