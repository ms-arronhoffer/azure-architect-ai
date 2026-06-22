"""Tests for the theme-able PPTX builder."""
from __future__ import annotations

import pytest

from services.pptx_service import (
    DARK_THEME,
    LIGHT_THEME,
    build_presentation,
    resolve_theme,
)

_OUTLINE = {
    "deck_title": "Migrating to AKS",
    "subtitle": "An executive overview",
    "slides": [
        {"slide_number": 1, "layout": "title", "title": "Migrating to AKS",
         "content": ["From on-prem to cloud-native"], "speaker_notes": "Open strong."},
        {"slide_number": 2, "layout": "agenda", "title": "Agenda",
         "content": ["Why", "How", "When"], "speaker_notes": ""},
        {"slide_number": 3, "layout": "section_divider", "title": "Why now",
         "content": ["The business case"], "speaker_notes": ""},
        {"slide_number": 4, "layout": "content", "title": "Drivers",
         "content": ["Cost", "Agility"], "speaker_notes": "Detail."},
        {"slide_number": 5, "layout": "two_column", "title": "Before vs After",
         "content": ["Manual"], "right_content": ["Automated"], "speaker_notes": ""},
        {"slide_number": 6, "layout": "quote_stat", "title": "Faster",
         "content": ["40%", "less time to deploy"], "speaker_notes": ""},
        {"slide_number": 7, "layout": "summary", "title": "Takeaways",
         "content": ["Start small", "Measure"], "speaker_notes": ""},
        {"slide_number": 8, "layout": "references", "title": "References",
         "content": ["aka.ms/aks"], "speaker_notes": ""},
    ],
}


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_build_presentation_themes(theme):
    data = build_presentation(_OUTLINE, theme=theme)
    assert isinstance(data, bytes)
    # A valid PPTX is a zip archive (PK magic) and non-trivial in size.
    assert data[:2] == b"PK"
    assert len(data) > 5000


def test_resolve_theme_presets():
    assert resolve_theme("dark") is DARK_THEME
    assert resolve_theme("light") is LIGHT_THEME
    # Unknown names fall back to the dark preset.
    assert resolve_theme("neon") is DARK_THEME


def test_resolve_theme_accent_override():
    t = resolve_theme("light", accent="#FF0000")
    assert t.accent == (0xFF, 0x00, 0x00)
    # Base preset is untouched.
    assert LIGHT_THEME.accent != t.accent


def test_resolve_theme_invalid_accent_ignored():
    t = resolve_theme("dark", accent="not-a-color")
    assert t.accent == DARK_THEME.accent


def test_build_default_theme_is_dark():
    # Default (no theme arg) must remain the original dark output.
    assert isinstance(build_presentation(_OUTLINE), bytes)
