# TODO frontend: handle structured kinds terraform_files / arm_files in StructuredResultCard.tsx
"""Tool schemas for Terraform and ARM IaC emitters.

Both tools share the same parameter shape — pattern_name selects one of the
15 curated reference architectures in data/reference_archs.py, the rest are
naming knobs that the emitter (not the LLM) bakes into the generated files.
"""

from data.reference_archs import REFERENCE_ARCHS

_PATTERN_NAMES = [a["id"] for a in REFERENCE_ARCHS]

_COMMON_PARAMS = {
    "type": "object",
    "properties": {
        "pattern_name": {
            "type": "string",
            "enum": _PATTERN_NAMES,
            "description": (
                "Reference architecture id from the curated catalog. "
                "Determines which Azure resources are scaffolded."
            ),
        },
        "location": {
            "type": "string",
            "description": "Azure region (e.g. 'eastus2', 'westus3').",
            "default": "eastus2",
        },
        "naming_prefix": {
            "type": "string",
            "description": "Short prefix prepended to every generated resource name.",
            "default": "aa",
        },
        "environment": {
            "type": "string",
            "description": "Deployment environment label (e.g. 'dev', 'staging', 'prod').",
            "default": "dev",
        },
        "tags": {
            "type": "object",
            "description": "Resource tags merged onto every generated resource.",
            "additionalProperties": {"type": "string"},
            "default": {},
        },
    },
    "required": ["pattern_name"],
}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_terraform",
            "description": (
                "Generate a Terraform module (main.tf, variables.tf, outputs.tf, versions.tf) "
                "for a curated Azure reference architecture using the azurerm provider. "
                "The model picks pattern_name; the server-side emitter renders the HCL."
            ),
            "parameters": _COMMON_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_arm",
            "description": (
                "Generate an ARM template pair (azuredeploy.json, azuredeploy.parameters.json) "
                "for a curated Azure reference architecture. Falls back to a direct IR-to-JSON "
                "emit when the Azure CLI is not available."
            ),
            "parameters": _COMMON_PARAMS,
        },
    },
]
