"""Phase 2 prompt — improvement recommendations.

Reads the canonical 12-pattern catalog from
`knowledge/demo/improvement_patterns.md` and applies it to the user's intake
spec. Emits a strict JSON list so the orchestrator can merge into state.
"""

from pathlib import Path

_PATTERNS_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "improvement_patterns.md"
IMPROVEMENT_PATTERNS = _PATTERNS_PATH.read_text(encoding="utf-8") if _PATTERNS_PATH.exists() else ""


def render_recommendations_prompt(spec_json: str) -> str:
    """Build the recommendations prompt. Uses string concatenation to avoid
    `.format()` collisions with literal `{}` braces in the vendored catalog.
    """
    return (
        "You are designing improvements for a new Azure AI demo. Apply the "
        "catalog below to the user's spec and select 3-5 patterns that would "
        "meaningfully elevate this demo.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences.\n\n"
        "Schema:\n"
        '{\n'
        '  "recommendations": [\n'
        '    {\n'
        '      "name": "<pattern name from catalog>",\n'
        '      "rationale": "<one sentence on why it fits THIS demo>",\n'
        '      "implementation_hint": "<one sentence on how to wire it into the build phase>"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        "Demo spec:\n"
        f"{spec_json}\n\n"
        "Improvement pattern catalog:\n"
        f"{IMPROVEMENT_PATTERNS or '(catalog unavailable)'}\n"
    )


RECOMMENDATIONS_PROMPT = render_recommendations_prompt
