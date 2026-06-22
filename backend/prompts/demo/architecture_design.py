"""Phase 3 prompt — architecture design.

Produces the demo's architecture summary and at least one Mermaid component
diagram. Output is structured JSON so the orchestrator can feed component
lists into the parallel build phase.
"""


def render_architecture_design_prompt(
    spec_json: str, recommendations_json: str, engagement_context: str = ""
) -> str:
    engagement_block = (
        f"\nActive engagement context (regional + compliance preferences to honor):\n{engagement_context}\n"
        if engagement_context
        else ""
    )
    return (
        "You are designing the architecture for a new Azure AI demo. The user "
        "has provided a spec and a set of accepted improvement patterns. "
        "Produce a tight architecture summary plus the component and data-flow "
        "diagrams that will drive the parallel build phase.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences. Mermaid "
        "code goes inside the JSON string values (no fenced blocks).\n\n"
        "Schema:\n"
        '{\n'
        '  "slug": "<kebab-case, matches the spec slug>",\n'
        '  "title": "<human readable>",\n'
        '  "tech_stack": "flask_sse | react_ts | flask_sse+react_ts",\n'
        '  "azure_services": ["<service>", ...],\n'
        '  "app_files": [{"path": "app.py", "purpose": "..."}, ...],\n'
        '  "bicep_resources": ["Microsoft.CognitiveServices/accounts", ...],\n'
        '  "env_vars": ["AZURE_OPENAI_ENDPOINT", ...],\n'
        '  "key_features": ["..."],\n'
        '  "wow_moment_implementation": "<how the single most impressive moment is delivered>",\n'
        '  "talk_track": "<2-3 sentence narrative a presenter uses to explain this demo in plain language>",\n'
        '  "behind_the_scenes": [\n'
        '    {"service": "Azure OpenAI", "role": "<what this service does in the live request flow>"}\n'
        '  ],\n'
        '  "summary_bullets": ["...", "..."],\n'
        '  "diagrams": [\n'
        '    {"name": "component", "mermaid": "graph LR\\n  A[Browser] --> B[Flask]\\n  ..."},\n'
        '    {"name": "flow", "mermaid": "sequenceDiagram\\n  ..."}\n'
        '  ]\n'
        '}\n\n'
        "Rules:\n"
        "- Prefer DefaultAzureCredential / managed identity over keys.\n"
        "- Match the user's chosen tech_stack from the spec; do not invent a stack.\n"
        "- Cite at least 2 diagrams (component + flow).\n"
        "- Populate behind_the_scenes with one entry per azure_services item so the "
        "UI can show what each service does while the demo runs.\n"
        "- env_vars must be the exact strings the app code will read.\n\n"
        f"Demo spec:\n{spec_json}\n\n"
        f"Accepted recommendations:\n{recommendations_json}\n"
        f"{engagement_block}"
    )


ARCHITECTURE_DESIGN_PROMPT = render_architecture_design_prompt
