"""Parse, validate, and sanitize uploaded skill packages.

A skill package is a zip archive describing a *declarative* assistant skill —
prompt instructions plus optional grounding knowledge and a declarative input
schema. It contains **no executable code**: nothing in a package is ever run.

Expected layout (only ``skill.yaml`` is required)::

    my-skill/
      skill.yaml            # manifest (name, slug, version, …)
      instructions.md       # system-prompt fragment injected when active
      inputs.schema.json    # OPTIONAL declarative input fields
      knowledge/            # OPTIONAL grounding docs (ingested into RAG)
        overview.md
      examples.yaml         # OPTIONAL starter prompts shown in the UI
      icon.svg              # OPTIONAL skill icon

The single public entry point is :func:`parse_package`, which returns a
:class:`ParsedSkill` or raises :class:`SkillPackageError` with an author-facing
message. The route layer owns persistence; this module owns parsing, schema
validation, and the security hardening (zip-slip, zip-bomb, extension
allow-list, script stripping).
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

import yaml

# ── Hard limits (zip-bomb / abuse defense) ──────────────────────────────────
MAX_PACKAGE_BYTES = 5 * 1024 * 1024  # 5 MB compressed (matches engagement refs)
MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024  # 20 MB total decompressed
MAX_MEMBERS = 200
MAX_KNOWLEDGE_FILES = 50
MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024  # 5 MB per member

# Only these extensions are allowed inside a package. Anything else (scripts,
# binaries, executables) is rejected outright — skills carry no code.
ALLOWED_EXTENSIONS = {".yaml", ".yml", ".json", ".md", ".txt", ".svg"}

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
_VALID_CATEGORIES = {
    "general", "architecture", "cost", "operations", "compliance",
    "security", "networking", "data", "ai", "migration", "governance",
}
_VALID_INPUT_TYPES = {"text", "textarea", "number", "select", "boolean"}

# Tags stripped from any author-supplied HTML/SVG/markdown before persistence.
_SCRIPT_TAG_RE = re.compile(r"<\s*(script|iframe|object|embed|link)\b[^>]*>.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
_OPEN_SCRIPT_RE = re.compile(r"<\s*(script|iframe|object|embed|link|meta)\b[^>]*>", re.IGNORECASE)
_EVENT_HANDLER_RE = re.compile(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)
_JS_URI_RE = re.compile(r"(href|src|xlink:href)\s*=\s*(\"|')?\s*javascript:[^\"'>\s]*", re.IGNORECASE)


class SkillPackageError(ValueError):
    """Raised when a package is malformed, unsafe, or fails schema validation.

    The message is safe to surface to the uploading user verbatim.
    """


@dataclass
class ParsedSkill:
    """Validated, sanitized contents of a skill package."""

    slug: str
    name: str
    description: str
    category: str
    tags: list[str]
    version: str
    author: str | None
    instructions: str
    inputs_schema: dict[str, Any]
    examples: list[dict[str, Any]]
    icon: str | None
    knowledge_files: list[dict[str, str]] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        """Self-contained dict suitable for storing in a showcase ``payload``."""
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tags": list(self.tags),
            "version": self.version,
            "author": self.author,
            "instructions": self.instructions,
            "inputs_schema": self.inputs_schema,
            "examples": self.examples,
            "icon": self.icon,
            "knowledge_files": self.knowledge_files,
        }


def slugify(value: str) -> str:
    s = (value or "").lower().strip().replace(" ", "-").replace("_", "-")
    s = re.sub(r"[^a-z0-9-]+", "", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "skill"


def sanitize_text(value: str | None) -> str:
    """Strip script/iframe/embed tags, inline event handlers, and js: URIs.

    Instructions are treated as untrusted prompt content; this defends the
    *renderer* (markdown/SVG shown in the UI) from injected active content.
    """
    if not value:
        return ""
    cleaned = _SCRIPT_TAG_RE.sub("", value)
    cleaned = _OPEN_SCRIPT_RE.sub("", cleaned)
    cleaned = _EVENT_HANDLER_RE.sub("", cleaned)
    cleaned = _JS_URI_RE.sub("", cleaned)
    return cleaned.strip()


def _ext(name: str) -> str:
    name = name.lower()
    dot = name.rfind(".")
    return name[dot:] if dot != -1 else ""


def _is_unsafe_path(name: str) -> bool:
    """Reject zip-slip: absolute paths, drive letters, or parent traversal."""
    if not name or name.startswith("/") or name.startswith("\\"):
        return True
    if re.match(r"^[a-zA-Z]:", name):  # windows drive
        return True
    normalized = name.replace("\\", "/")
    parts = normalized.split("/")
    return any(part == ".." for part in parts)


def _strip_root(name: str) -> str:
    """Drop a single common top-level folder (e.g. ``my-skill/skill.yaml``)."""
    norm = name.replace("\\", "/").lstrip("/")
    parts = norm.split("/", 1)
    return parts[1] if len(parts) == 2 else norm


def _extract_members(data: bytes) -> dict[str, bytes]:
    """Safely read every file member into ``{relative_path: bytes}``.

    Enforces member count, per-file size, total decompressed size, path
    safety, and the extension allow-list.
    """
    if len(data) > MAX_PACKAGE_BYTES:
        raise SkillPackageError(
            f"package exceeds {MAX_PACKAGE_BYTES // (1024 * 1024)} MB limit"
        )
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SkillPackageError("uploaded file is not a valid zip archive") from exc

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > MAX_MEMBERS:
        raise SkillPackageError(f"package has too many files (max {MAX_MEMBERS})")

    total = 0
    members: dict[str, bytes] = {}
    for info in infos:
        if _is_unsafe_path(info.filename):
            raise SkillPackageError(f"unsafe path in archive: {info.filename}")
        if info.file_size > MAX_SINGLE_FILE_BYTES:
            raise SkillPackageError(f"file too large: {info.filename}")
        total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            raise SkillPackageError("package decompresses to more than the allowed size")
        rel = _strip_root(info.filename)
        if not rel or rel.endswith("/"):
            continue
        # Skip junk metadata dirs that some zip tools inject.
        if rel.startswith("__MACOSX/") or rel.endswith(".DS_Store"):
            continue
        if _ext(rel) not in ALLOWED_EXTENSIONS:
            raise SkillPackageError(
                f"file type not allowed: {rel} "
                f"(allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))})"
            )
        with zf.open(info) as fh:
            raw = fh.read(MAX_SINGLE_FILE_BYTES + 1)
        if len(raw) > MAX_SINGLE_FILE_BYTES:
            raise SkillPackageError(f"file too large: {rel}")
        members[rel] = raw
    return members


def _decode(raw: bytes, name: str) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SkillPackageError(f"{name} must be UTF-8 encoded text") from exc


def _validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Validate ``skill.yaml`` against the manifest contract.

    Manual validation (no external jsonschema dep) so error messages are
    precise and author-facing.
    """
    if not isinstance(manifest, dict):
        raise SkillPackageError("skill.yaml must be a mapping of fields")

    name = manifest.get("name")
    if not isinstance(name, str) or not name.strip():
        raise SkillPackageError("skill.yaml: 'name' is required and must be a non-empty string")
    name = name.strip()[:200]

    slug = manifest.get("slug")
    if slug is None or (isinstance(slug, str) and not slug.strip()):
        slug = slugify(name)
    if not isinstance(slug, str) or not _SLUG_RE.match(slug):
        raise SkillPackageError(
            "skill.yaml: 'slug' must be 3-64 chars, lowercase letters/digits/hyphens "
            "(e.g. 'finops-tagging-reviewer')"
        )

    version = manifest.get("version", "1.0.0")
    if not isinstance(version, str) or not _SEMVER_RE.match(version):
        raise SkillPackageError("skill.yaml: 'version' must be semver (e.g. '1.0.0')")

    category = manifest.get("category", "general")
    if not isinstance(category, str) or category not in _VALID_CATEGORIES:
        raise SkillPackageError(
            f"skill.yaml: 'category' must be one of {', '.join(sorted(_VALID_CATEGORIES))}"
        )

    description = manifest.get("description", "")
    if not isinstance(description, str):
        raise SkillPackageError("skill.yaml: 'description' must be a string")

    raw_tags = manifest.get("tags", []) or []
    if not isinstance(raw_tags, list):
        raise SkillPackageError("skill.yaml: 'tags' must be a list of strings")
    tags = [str(t).strip()[:40] for t in raw_tags if str(t).strip()][:20]

    author = manifest.get("author")
    if author is not None and not isinstance(author, str):
        raise SkillPackageError("skill.yaml: 'author' must be a string")

    return {
        "name": name,
        "slug": slug,
        "version": version,
        "category": category,
        "description": description.strip()[:2000],
        "tags": tags,
        "author": (author.strip()[:200] if isinstance(author, str) else None),
    }


def _validate_inputs_schema(obj: Any) -> dict[str, Any]:
    """Validate the optional declarative input schema.

    Shape: ``{"fields": [{"name", "label", "type", "required"?, "options"?}]}``.
    """
    if obj is None:
        return {}
    if not isinstance(obj, dict):
        raise SkillPackageError("inputs.schema.json must be a JSON object")
    fields = obj.get("fields", [])
    if not isinstance(fields, list):
        raise SkillPackageError("inputs.schema.json: 'fields' must be a list")
    out_fields: list[dict[str, Any]] = []
    for i, fld in enumerate(fields):
        if not isinstance(fld, dict):
            raise SkillPackageError(f"inputs.schema.json: field #{i + 1} must be an object")
        fname = fld.get("name")
        if not isinstance(fname, str) or not fname.strip():
            raise SkillPackageError(f"inputs.schema.json: field #{i + 1} needs a 'name'")
        ftype = fld.get("type", "text")
        if ftype not in _VALID_INPUT_TYPES:
            raise SkillPackageError(
                f"inputs.schema.json: field '{fname}' type must be one of "
                f"{', '.join(sorted(_VALID_INPUT_TYPES))}"
            )
        clean: dict[str, Any] = {
            "name": fname.strip()[:64],
            "label": str(fld.get("label", fname)).strip()[:120],
            "type": ftype,
            "required": bool(fld.get("required", False)),
        }
        if ftype == "select":
            options = fld.get("options", [])
            if not isinstance(options, list) or not options:
                raise SkillPackageError(
                    f"inputs.schema.json: select field '{fname}' needs a non-empty 'options' list"
                )
            clean["options"] = [str(o).strip()[:120] for o in options][:50]
        if "placeholder" in fld:
            clean["placeholder"] = str(fld["placeholder"]).strip()[:200]
        out_fields.append(clean)
    if len(out_fields) > 30:
        raise SkillPackageError("inputs.schema.json: too many fields (max 30)")
    return {"fields": out_fields}


def _validate_examples(obj: Any) -> list[dict[str, Any]]:
    """Validate optional starter prompts. Accepts a list of strings or objects."""
    if obj is None:
        return []
    if isinstance(obj, dict):
        obj = obj.get("examples", obj.get("prompts", []))
    if not isinstance(obj, list):
        raise SkillPackageError("examples.yaml must be a list of prompts")
    out: list[dict[str, Any]] = []
    for item in obj[:20]:
        if isinstance(item, str):
            text = item.strip()
            if text:
                out.append({"title": text[:80], "prompt": text[:2000]})
        elif isinstance(item, dict):
            prompt = str(item.get("prompt", "")).strip()
            if prompt:
                out.append({
                    "title": str(item.get("title", prompt[:80])).strip()[:80],
                    "prompt": prompt[:2000],
                })
    return out


def parse_package(data: bytes) -> ParsedSkill:
    """Parse and validate raw zip bytes into a :class:`ParsedSkill`.

    Raises :class:`SkillPackageError` (message safe to surface) on any problem.
    """
    members = _extract_members(data)

    manifest_raw = members.get("skill.yaml") or members.get("skill.yml")
    if manifest_raw is None:
        raise SkillPackageError("package is missing required 'skill.yaml' manifest")
    try:
        manifest = yaml.safe_load(_decode(manifest_raw, "skill.yaml")) or {}
    except yaml.YAMLError as exc:
        raise SkillPackageError(f"skill.yaml is not valid YAML: {exc}") from exc
    meta = _validate_manifest(manifest)

    instr_raw = members.get("instructions.md") or members.get("instructions.txt")
    instructions = sanitize_text(_decode(instr_raw, "instructions.md")) if instr_raw else ""
    # Manifest may also carry inline instructions; file wins when present.
    if not instructions and isinstance(manifest.get("instructions"), str):
        instructions = sanitize_text(manifest["instructions"])
    if not instructions:
        raise SkillPackageError(
            "package must provide instructions (instructions.md or an 'instructions' field)"
        )
    if len(instructions) > 20000:
        raise SkillPackageError("instructions exceed the 20,000 character limit")

    inputs_obj: Any = None
    inputs_raw = members.get("inputs.schema.json")
    if inputs_raw:
        import json
        try:
            inputs_obj = json.loads(_decode(inputs_raw, "inputs.schema.json"))
        except json.JSONDecodeError as exc:
            raise SkillPackageError(f"inputs.schema.json is not valid JSON: {exc}") from exc
    inputs_schema = _validate_inputs_schema(inputs_obj)

    examples_obj: Any = None
    examples_raw = members.get("examples.yaml") or members.get("examples.yml")
    if examples_raw:
        try:
            examples_obj = yaml.safe_load(_decode(examples_raw, "examples.yaml"))
        except yaml.YAMLError as exc:
            raise SkillPackageError(f"examples.yaml is not valid YAML: {exc}") from exc
    examples = _validate_examples(examples_obj)

    icon_raw = members.get("icon.svg")
    icon = sanitize_text(_decode(icon_raw, "icon.svg")) if icon_raw else None
    if icon and len(icon) > 50000:
        icon = None  # oversized icon — fall back to default

    knowledge_files: list[dict[str, str]] = []
    for path, raw in members.items():
        if not path.startswith("knowledge/"):
            continue
        if _ext(path) not in {".md", ".txt"}:
            continue
        content = _decode(raw, path).strip()
        if not content:
            continue
        title = path[len("knowledge/"):]
        knowledge_files.append({"path": title, "content": content[:200000]})
    if len(knowledge_files) > MAX_KNOWLEDGE_FILES:
        raise SkillPackageError(
            f"too many knowledge files (max {MAX_KNOWLEDGE_FILES})"
        )

    return ParsedSkill(
        slug=meta["slug"],
        name=meta["name"],
        description=meta["description"],
        category=meta["category"],
        tags=meta["tags"],
        version=meta["version"],
        author=meta["author"],
        instructions=instructions,
        inputs_schema=inputs_schema,
        examples=examples,
        icon=icon,
        knowledge_files=knowledge_files,
    )


def build_package(payload: dict[str, Any]) -> bytes:
    """Reconstruct a zip package from a stored payload (for showcase export).

    Mirrors the canonical layout so a downloaded package round-trips back
    through :func:`parse_package`.
    """
    import json

    buf = io.BytesIO()
    slug = payload.get("slug", "skill")
    root = f"{slug}/"
    manifest = {
        "name": payload.get("name", slug),
        "slug": slug,
        "version": payload.get("version", "1.0.0"),
        "category": payload.get("category", "general"),
        "description": payload.get("description", ""),
        "tags": payload.get("tags", []),
    }
    if payload.get("author"):
        manifest["author"] = payload["author"]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(root + "skill.yaml", yaml.safe_dump(manifest, sort_keys=False))
        zf.writestr(root + "instructions.md", payload.get("instructions", ""))
        if payload.get("inputs_schema", {}).get("fields"):
            zf.writestr(root + "inputs.schema.json", json.dumps(payload["inputs_schema"], indent=2))
        if payload.get("examples"):
            zf.writestr(root + "examples.yaml", yaml.safe_dump(payload["examples"], sort_keys=False))
        if payload.get("icon"):
            zf.writestr(root + "icon.svg", payload["icon"])
        for kf in payload.get("knowledge_files", []):
            zf.writestr(root + "knowledge/" + kf["path"], kf["content"])
    return buf.getvalue()
