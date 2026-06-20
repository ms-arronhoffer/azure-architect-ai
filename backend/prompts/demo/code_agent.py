"""Phase 4a prompt — application code generation.

Emits the application code files (Flask + SSE or React + TS) for the demo.
Output must be strict JSON conforming to `{"files": [{"path","content"}]}`
so the orchestrator can merge into the in-memory file map.
"""

from pathlib import Path

_STANDARDS_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "demo_standards.md"
_FLASK_TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "flask_sse_starter.md"
_REACT_TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "react_ts_starter.md"

DEMO_STANDARDS = _STANDARDS_PATH.read_text(encoding="utf-8") if _STANDARDS_PATH.exists() else ""
FLASK_SSE_TEMPLATE = _FLASK_TEMPLATE_PATH.read_text(encoding="utf-8") if _FLASK_TEMPLATE_PATH.exists() else ""
REACT_TS_TEMPLATE = _REACT_TEMPLATE_PATH.read_text(encoding="utf-8") if _REACT_TEMPLATE_PATH.exists() else ""


def render_code_agent_prompt(design_json: str, spec_json: str) -> str:
    return (
        "You are generating production-quality application code for a new "
        "Azure AI demo. Read the design, follow the standards, and emit ALL "
        "files needed to run the app.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences around the "
        "outer object. File contents may contain any characters; they will be "
        "written verbatim. Paths are POSIX-relative to the demo root.\n\n"
        "Schema:\n"
        '{\n'
        '  "files": [\n'
        '    {"path": "app.py", "content": "<full file body>"},\n'
        '    {"path": "requirements.txt", "content": "..."},\n'
        '    {"path": "templates/index.html", "content": "..."}\n'
        '  ]\n'
        '}\n\n'
        "Rules:\n"
        "- Generate ALL files listed in design.app_files, plus requirements.txt, "
        "  .env.example, and any templates/static assets the app references.\n"
        "- Use DefaultAzureCredential + get_bearer_token_provider for Azure OpenAI; no API keys in code.\n"
        "- Wire SSE the way the Flask starter template does (queue + thread + stream_with_context) when tech_stack includes flask_sse.\n"
        "- React/TS: Fluent UI v9, webDarkTheme default with theme toggle, SSE consumer via response.body.getReader().\n"
        "- Cap individual files at ~400 lines. Split helpers into separate modules instead of one mega-file.\n"
        "- Pin requirements with >= on majors (e.g., flask>=3.1.0, openai>=1.30.0).\n"
        "- No skeleton code. Implement the wow_moment_implementation end-to-end.\n\n"
        f"Architecture design (from phase 3):\n{design_json}\n\n"
        f"Demo spec:\n{spec_json}\n\n"
        "Demo standards (must follow):\n"
        f"{DEMO_STANDARDS or '(standards unavailable)'}\n\n"
        "Flask SSE starter template:\n"
        f"{FLASK_SSE_TEMPLATE or '(template unavailable)'}\n\n"
        "React TS starter template:\n"
        f"{REACT_TS_TEMPLATE or '(template unavailable)'}\n"
    )


CODE_AGENT_PROMPT = render_code_agent_prompt
