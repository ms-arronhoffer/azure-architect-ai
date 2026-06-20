"""Phase 4c prompt — documentation generation.

Emits README.md, ARCHITECTURE.md (with Mermaid diagrams), DEPLOYMENT.md,
.env.example, and .gitignore. Pulls the Documentation Standards section out
of `knowledge/demo/demo_standards.md`.
"""

from pathlib import Path

_STANDARDS_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "demo_standards.md"
DEMO_STANDARDS = _STANDARDS_PATH.read_text(encoding="utf-8") if _STANDARDS_PATH.exists() else ""


def render_docs_agent_prompt(design_json: str, spec_json: str) -> str:
    return (
        "You are generating documentation for a new Azure AI demo. Output the "
        "full set of docs so the repo is clone-and-run.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences around the "
        "outer object. Markdown content goes inside JSON string values; "
        "Mermaid diagrams stay inside fenced ```mermaid blocks WITHIN those "
        "values.\n\n"
        "Schema:\n"
        '{\n'
        '  "files": [\n'
        '    {"path": "README.md", "content": "..."},\n'
        '    {"path": "ARCHITECTURE.md", "content": "..."},\n'
        '    {"path": "DEPLOYMENT.md", "content": "..."},\n'
        '    {"path": ".env.example", "content": "..."},\n'
        '    {"path": ".gitignore", "content": "..."}\n'
        '  ]\n'
        '}\n\n'
        "Rules:\n"
        "- README.md: title, features, prerequisites, quick start (<= 5 steps), usage, architecture link, API reference table, project structure.\n"
        "- ARCHITECTURE.md: include the diagrams from design.diagrams as fenced ```mermaid blocks; add component descriptions and an optional enterprise extension section.\n"
        "- DEPLOYMENT.md: step-by-step Azure setup, `az deployment group create` commands, env var capture from Bicep outputs, local run instructions.\n"
        "- .env.example: every entry in design.env_vars with `# inline comment` explaining what it is and where it comes from. NO real values.\n"
        "- .gitignore: Python + Node + .env + IDE noise.\n\n"
        f"Architecture design (from phase 3):\n{design_json}\n\n"
        f"Demo spec:\n{spec_json}\n\n"
        "Demo standards (Documentation section is canonical):\n"
        f"{DEMO_STANDARDS or '(standards unavailable)'}\n"
    )


DOCS_AGENT_PROMPT = render_docs_agent_prompt
