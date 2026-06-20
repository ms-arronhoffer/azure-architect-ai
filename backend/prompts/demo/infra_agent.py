"""Phase 4b prompt — Bicep infrastructure generation.

Emits `infra/main.bicep` + `infra/main.bicepparam`. Receives the prior
`bundled_design.bicep` when available so the agent can extend rather than
regenerate the foundation.
"""

from pathlib import Path

_BICEP_PATTERNS_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "bicep_patterns.md"
_AZURE_SERVICES_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "demo" / "azure_services.md"

BICEP_PATTERNS = _BICEP_PATTERNS_PATH.read_text(encoding="utf-8") if _BICEP_PATTERNS_PATH.exists() else ""
AZURE_SERVICES = _AZURE_SERVICES_PATH.read_text(encoding="utf-8") if _AZURE_SERVICES_PATH.exists() else ""


def render_infra_agent_prompt(
    design_json: str, spec_json: str, seed_bicep: str = ""
) -> str:
    seed_block = (
        f"\nSeed Bicep from prior bundled_design (extend/refactor this rather than starting over):\n```bicep\n{seed_bicep}\n```\n"
        if seed_bicep.strip()
        else ""
    )
    return (
        "You are generating Bicep infrastructure for a new Azure AI demo.\n\n"
        "Reply with strict JSON only. No prose, no markdown fences around the "
        "outer object. File contents are written verbatim.\n\n"
        "Schema:\n"
        '{\n'
        '  "files": [\n'
        '    {"path": "infra/main.bicep", "content": "<full bicep>"},\n'
        '    {"path": "infra/main.bicepparam", "content": "<param file>"}\n'
        '  ]\n'
        '}\n\n'
        "Rules:\n"
        "- Keyless: `disableLocalAuth: true` on every service that supports it. No API keys in outputs.\n"
        "- RBAC role assignments for every service the app touches, scoped to the principalId param.\n"
        "- Outputs must include every entry in design.env_vars (endpoints, account names, etc.).\n"
        "- OpenAI model deployments use sequential `dependsOn` to avoid quota collisions.\n"
        "- Use baseName + uniqueString(resourceGroup().id) for resource naming.\n"
        "- Comment each major resource block with a one-liner explaining its role.\n"
        f"{seed_block}\n"
        f"Architecture design (from phase 3):\n{design_json}\n\n"
        f"Demo spec:\n{spec_json}\n\n"
        "Bicep patterns to follow:\n"
        f"{BICEP_PATTERNS or '(patterns unavailable)'}\n\n"
        "Azure service reference cards (RBAC role IDs, required resources):\n"
        f"{AZURE_SERVICES or '(services catalog unavailable)'}\n"
    )


INFRA_AGENT_PROMPT = render_infra_agent_prompt
