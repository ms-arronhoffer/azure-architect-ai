"""Unit tests for the skill package parser/validator (services/skill_package).

These are pure-Python (no DB, no Azure) and exercise the security hardening:
manifest validation, zip-slip, zip-bomb, extension allow-list, and sanitization.
"""
from __future__ import annotations

import io
import json
import zipfile

import pytest

from services.skill_package import (
    MAX_MEMBERS,
    ParsedSkill,
    SkillPackageError,
    build_package,
    parse_package,
    sanitize_text,
    slugify,
)


def _zip(files: dict[str, bytes | str], root: str = "my-skill/") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            if isinstance(content, str):
                content = content.encode("utf-8")
            zf.writestr(root + name, content)
    return buf.getvalue()


_VALID_MANIFEST = """
name: Test Skill
slug: test-skill
version: 1.2.3
category: cost
description: A test skill.
tags: [a, b]
"""


def test_parse_minimal_valid_package():
    data = _zip({"skill.yaml": _VALID_MANIFEST, "instructions.md": "Do the thing."})
    parsed = parse_package(data)
    assert isinstance(parsed, ParsedSkill)
    assert parsed.slug == "test-skill"
    assert parsed.name == "Test Skill"
    assert parsed.version == "1.2.3"
    assert parsed.category == "cost"
    assert parsed.instructions == "Do the thing."


def test_missing_manifest_rejected():
    data = _zip({"instructions.md": "hi"})
    with pytest.raises(SkillPackageError, match="skill.yaml"):
        parse_package(data)


def test_missing_instructions_rejected():
    data = _zip({"skill.yaml": _VALID_MANIFEST})
    with pytest.raises(SkillPackageError, match="instructions"):
        parse_package(data)


def test_inline_instructions_accepted():
    manifest = _VALID_MANIFEST + "\ninstructions: Inline instructions here.\n"
    data = _zip({"skill.yaml": manifest})
    parsed = parse_package(data)
    assert parsed.instructions == "Inline instructions here."


def test_invalid_slug_rejected():
    bad = "name: X\nslug: 'Bad Slug!'\n"
    data = _zip({"skill.yaml": bad, "instructions.md": "x"})
    with pytest.raises(SkillPackageError, match="slug"):
        parse_package(data)


def test_invalid_version_rejected():
    bad = "name: X\nslug: good-slug\nversion: v1\n"
    data = _zip({"skill.yaml": bad, "instructions.md": "x"})
    with pytest.raises(SkillPackageError, match="version"):
        parse_package(data)


def test_invalid_category_rejected():
    bad = "name: X\nslug: good-slug\ncategory: nonsense\n"
    data = _zip({"skill.yaml": bad, "instructions.md": "x"})
    with pytest.raises(SkillPackageError, match="category"):
        parse_package(data)


def test_slug_defaults_from_name():
    manifest = "name: My Cool Skill\ninstructions: hi\n"
    parsed = parse_package(_zip({"skill.yaml": manifest}))
    assert parsed.slug == "my-cool-skill"


def test_executable_extension_rejected():
    data = _zip({
        "skill.yaml": _VALID_MANIFEST,
        "instructions.md": "x",
        "evil.py": "import os; os.system('rm -rf /')",
    })
    with pytest.raises(SkillPackageError, match="file type not allowed"):
        parse_package(data)


def test_zip_slip_absolute_path_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("/etc/passwd", "root")
        zf.writestr("my-skill/skill.yaml", _VALID_MANIFEST)
        zf.writestr("my-skill/instructions.md", "x")
    with pytest.raises(SkillPackageError, match="unsafe path"):
        parse_package(buf.getvalue())


def test_zip_slip_traversal_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../escape.md", "x")
        zf.writestr("my-skill/skill.yaml", _VALID_MANIFEST)
        zf.writestr("my-skill/instructions.md", "x")
    with pytest.raises(SkillPackageError, match="unsafe path"):
        parse_package(buf.getvalue())


def test_too_many_members_rejected():
    files = {"skill.yaml": _VALID_MANIFEST, "instructions.md": "x"}
    for i in range(MAX_MEMBERS + 5):
        files[f"knowledge/doc{i}.md"] = "content"
    with pytest.raises(SkillPackageError, match="too many files"):
        parse_package(_zip(files))


def test_not_a_zip_rejected():
    with pytest.raises(SkillPackageError, match="valid zip"):
        parse_package(b"this is not a zip file")


def test_inputs_schema_parsed():
    schema = json.dumps({"fields": [
        {"name": "scope", "label": "Scope", "type": "text"},
        {"name": "env", "type": "select", "options": ["a", "b"]},
    ]})
    data = _zip({
        "skill.yaml": _VALID_MANIFEST,
        "instructions.md": "x",
        "inputs.schema.json": schema,
    })
    parsed = parse_package(data)
    fields = parsed.inputs_schema["fields"]
    assert len(fields) == 2
    assert fields[1]["options"] == ["a", "b"]


def test_inputs_schema_select_without_options_rejected():
    schema = json.dumps({"fields": [{"name": "env", "type": "select"}]})
    data = _zip({
        "skill.yaml": _VALID_MANIFEST,
        "instructions.md": "x",
        "inputs.schema.json": schema,
    })
    with pytest.raises(SkillPackageError, match="options"):
        parse_package(data)


def test_examples_list_of_strings():
    data = _zip({
        "skill.yaml": _VALID_MANIFEST,
        "instructions.md": "x",
        "examples.yaml": "- First prompt\n- Second prompt\n",
    })
    parsed = parse_package(data)
    assert len(parsed.examples) == 2
    assert parsed.examples[0]["prompt"] == "First prompt"


def test_knowledge_files_collected():
    data = _zip({
        "skill.yaml": _VALID_MANIFEST,
        "instructions.md": "x",
        "knowledge/a.md": "alpha",
        "knowledge/b.txt": "bravo",
    })
    parsed = parse_package(data)
    paths = sorted(k["path"] for k in parsed.knowledge_files)
    assert paths == ["a.md", "b.txt"]


def test_sanitize_strips_scripts():
    dirty = "Hello <script>alert(1)</script> world <a onclick=\"x()\">link</a>"
    clean = sanitize_text(dirty)
    assert "<script>" not in clean
    assert "onclick" not in clean
    assert "Hello" in clean and "world" in clean


def test_instructions_sanitized_in_package():
    manifest = "name: X\nslug: good-slug\n"
    data = _zip({
        "skill.yaml": manifest,
        "instructions.md": "Be helpful <script>steal()</script>.",
    })
    parsed = parse_package(data)
    assert "<script>" not in parsed.instructions


def test_slugify():
    assert slugify("Hello World!") == "hello-world"
    assert slugify("  multiple   spaces ") == "multiple-spaces"
    assert slugify("") == "skill"


def test_build_package_roundtrips():
    parsed = parse_package(_zip({"skill.yaml": _VALID_MANIFEST, "instructions.md": "Do it."}))
    rebuilt = build_package(parsed.to_payload())
    reparsed = parse_package(rebuilt)
    assert reparsed.slug == parsed.slug
    assert reparsed.instructions == parsed.instructions
    assert reparsed.category == parsed.category


def _zip_folder(folder) -> bytes:
    import pathlib

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(pathlib.Path(folder).rglob("*")):
            if path.is_file():
                zf.write(path, arcname=f"{pathlib.Path(folder).name}/{path.relative_to(folder).as_posix()}")
    return buf.getvalue()


def test_curated_naming_standards_package_is_valid():
    """The on-disk naming-standards curated package must parse cleanly."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent / "knowledge" / "skills" / "naming-standards"
    parsed = parse_package(_zip_folder(root))
    assert parsed.slug == "azure-naming-standards"
    assert parsed.category == "governance"
    assert parsed.instructions
    assert any(f["path"].endswith("caf-naming.md") for f in parsed.knowledge_files)
    # declarative inputs are surfaced to the UI
    field_names = {f["name"] for f in parsed.inputs_schema.get("fields", [])}
    assert {"org_prefix", "environments", "regions"} <= field_names
