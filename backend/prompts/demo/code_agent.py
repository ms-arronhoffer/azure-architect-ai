"""Phase 4a prompt — application code generation.

Emits the application code files (Flask + SSE or React + TS) for the demo.
Output must be strict JSON conforming to `{"files": [{"path","content"}]}`
so the orchestrator can merge into the in-memory file map.
"""

from pathlib import Path

_KNOWLEDGE = Path(__file__).resolve().parents[2] / "knowledge" / "demo"
_STANDARDS_PATH = _KNOWLEDGE / "demo_standards.md"
_FLASK_TEMPLATE_PATH = _KNOWLEDGE / "flask_sse_starter.md"
_REACT_TEMPLATE_PATH = _KNOWLEDGE / "react_ts_starter.md"
_ACTIVITY_PROTOCOL_PATH = _KNOWLEDGE / "activity_protocol.md"
_CHECKLIST_PATH = _KNOWLEDGE / "world_class_checklist.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


DEMO_STANDARDS = _read(_STANDARDS_PATH)
FLASK_SSE_TEMPLATE = _read(_FLASK_TEMPLATE_PATH)
REACT_TS_TEMPLATE = _read(_REACT_TEMPLATE_PATH)
ACTIVITY_PROTOCOL = _read(_ACTIVITY_PROTOCOL_PATH)
WORLD_CLASS_CHECKLIST = _read(_CHECKLIST_PATH)


def render_code_agent_prompt(design_json: str, spec_json: str) -> str:
    return (
        "You are generating production-quality application code for a new "
        "Azure AI demo that must wow customers. Read the design, follow the "
        "standards, and emit ALL files needed to run the app.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences around the "
        "outer object. File contents may contain any characters; they will be "
        "written verbatim. Paths are POSIX-relative to the demo root.\n\n"
        "Schema:\n"
        '{\n'
        '  "files": [\n'
        '    {"path": "src/App.tsx", "content": "<full file body>"},\n'
        '    {"path": "package.json", "content": "..."},\n'
        '    {"path": "src/components/AzureActivityPanel.tsx", "content": "..."}\n'
        '  ]\n'
        '}\n\n'
        "Rules (NON-NEGOTIABLE quality bar — every demo must clear it):\n"
        "- Generate ALL files listed in design.app_files, plus the build/config "
        "files for the stack (package.json/tsconfig/vite.config for react_ts; "
        "requirements.txt/.env.example for flask_sse) and any templates/static "
        "assets the app references.\n"
        "- LIVE AZURE ATTRIBUTION IS MANDATORY. Implement the Azure Activity "
        "Protocol exactly: the backend emits canonical `activity` events "
        "(service, step_id, stage, detail, status, latency_ms, tokens) and the "
        "frontend renders the Azure Activity Panel (service rail + live narrative "
        "feed + 'what this service does' affordance). step_id values MUST match "
        "design.live_activity[].step_id and the component diagram node ids.\n"
        "- Render the live architecture diagram (design.diagrams component) in-app "
        "and highlight nodes as their service fires.\n"
        "- Build the UX for design.demo_archetype (chat | rag | vision | agentic | "
        "data). Render the final result with a PURPOSE-BUILT renderer for that "
        "archetype. NEVER dump JSON.stringify / a raw <pre> as the primary result.\n"
        "- Support a ?mock=1 mode that replays design.live_activity through the "
        "same Activity Panel with no backend call.\n"
        "- Include designed hero/landing, loading/skeleton, empty, and error "
        "states. Add subtle motion that respects prefers-reduced-motion. Keep AA "
        "contrast, visible focus, full keyboard operability.\n"
        "- Use DefaultAzureCredential + get_bearer_token_provider for Azure OpenAI; no API keys in code.\n"
        "- React/TS (preferred for customer demos): Fluent UI v9, a custom themed "
        "FluentProvider (not raw webDarkTheme) with a light/dark toggle, SSE consumer "
        "via response.body.getReader(). Reuse the useDemoStream/AzureActivityPanel/"
        "LiveDiagram patterns from the React starter.\n"
        "- Flask: wire SSE with the queue + thread + stream_with_context pattern and "
        "the Activity helper from the activity protocol.\n"
        "- Cap individual files at ~500 lines. Split components/helpers into separate "
        "modules instead of one mega-file.\n"
        "- Pin requirements with >= on majors (e.g., flask>=3.1.0, openai>=1.30.0).\n"
        "- No skeleton/placeholder logic. Implement the wow_moment_implementation end-to-end.\n\n"
        "Before finalizing, self-check against the world-class checklist below: is "
        "the Activity Panel wired to canonical events, is the live diagram keyed by "
        "step_id, is the result archetype-appropriate (no raw JSON), are loading/"
        "empty/error states designed, and does ?mock=1 work? Fix any gaps first.\n\n"
        f"Architecture design (from phase 3):\n{design_json}\n\n"
        f"Demo spec:\n{spec_json}\n\n"
        "Azure Activity Protocol (canonical event schema + panel — MUST follow):\n"
        f"{ACTIVITY_PROTOCOL or '(protocol unavailable)'}\n\n"
        "World-class checklist (self-check before emitting):\n"
        f"{WORLD_CLASS_CHECKLIST or '(checklist unavailable)'}\n\n"
        "Demo standards (must follow):\n"
        f"{DEMO_STANDARDS or '(standards unavailable)'}\n\n"
        "React TS starter template (preferred — Activity Panel, live diagram, archetypes):\n"
        f"{REACT_TS_TEMPLATE or '(template unavailable)'}\n\n"
        "Flask SSE starter template:\n"
        f"{FLASK_SSE_TEMPLATE or '(template unavailable)'}\n"
    )


CODE_AGENT_PROMPT = render_code_agent_prompt
