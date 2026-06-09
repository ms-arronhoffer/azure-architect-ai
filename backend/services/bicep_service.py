"""Bicep CLI wrapper — compiles user-generated Bicep to ARM JSON and surfaces diagnostics."""

import asyncio
import json
import os
import re
import tempfile
from typing import Any

from opentelemetry import trace

tracer = trace.get_tracer(__name__)

_DIAG_RE = re.compile(
    r"^(?P<path>.+\.bicep)\((?P<line>\d+),(?P<col>\d+)\) : (?P<severity>Error|Warning) (?P<code>\w+): (?P<message>.+)$"
)


def _parse_diagnostics(stderr_text: str) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    for raw_line in stderr_text.splitlines():
        m = _DIAG_RE.match(raw_line.strip())
        if not m:
            continue
        diagnostics.append(
            {
                "line": int(m.group("line")),
                "col": int(m.group("col")),
                "severity": m.group("severity"),
                "code": m.group("code"),
                "message": m.group("message"),
            }
        )
    return diagnostics


def _extract_resources(arm_template: dict[str, Any]) -> list[dict[str, Any]]:
    resources: list[dict[str, Any]] = []
    for r in arm_template.get("resources", []) or []:
        if not isinstance(r, dict):
            continue
        resources.append(
            {
                "name": r.get("name", ""),
                "type": r.get("type", ""),
                "api_version": r.get("apiVersion", ""),
                "location": r.get("location"),
            }
        )
    return resources


async def build_and_preview(bicep_code: str) -> dict[str, Any]:
    """Compile Bicep via `az bicep build --stdout` and return diagnostics + resource preview.

    Returns:
        {
          "valid": bool,
          "errors": [ {line, col, severity, code, message}, ... ],
          "resources": [ {name, type, api_version, location}, ... ],
          "total_count": int,
          "arm_template": str | None,   # full compiled JSON, only when valid
        }
    """
    if not bicep_code or not bicep_code.strip():
        return {
            "valid": False,
            "errors": [],
            "resources": [],
            "total_count": 0,
            "arm_template": None,
        }

    with tracer.start_as_current_span("bicep.build") as span:
        tmp = tempfile.NamedTemporaryFile(suffix=".bicep", delete=False, mode="w", encoding="utf-8")
        try:
            tmp.write(bicep_code)
            tmp.close()
            try:
                proc = await asyncio.create_subprocess_exec(
                    "az",
                    "bicep",
                    "build",
                    "--file",
                    tmp.name,
                    "--stdout",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout_bytes, stderr_bytes = await proc.communicate()
                return_code = proc.returncode
            except FileNotFoundError:
                span.set_attribute("bicep.cli_missing", True)
                return {
                    "valid": False,
                    "errors": [
                        {
                            "line": 0,
                            "col": 0,
                            "severity": "Error",
                            "code": "BCP_CLI_MISSING",
                            "message": "Azure CLI with Bicep is not installed in this environment.",
                        }
                    ],
                    "resources": [],
                    "total_count": 0,
                    "arm_template": None,
                }

            stdout_text = stdout_bytes.decode("utf-8", errors="replace")
            stderr_text = stderr_bytes.decode("utf-8", errors="replace")
            errors = _parse_diagnostics(stderr_text)
            valid = return_code == 0 and not any(e["severity"] == "Error" for e in errors)

            resources: list[dict[str, Any]] = []
            arm_template_str: str | None = None
            if valid and stdout_text.strip():
                try:
                    arm_obj = json.loads(stdout_text)
                    resources = _extract_resources(arm_obj)
                    arm_template_str = stdout_text
                except json.JSONDecodeError:
                    valid = False
                    errors.append(
                        {
                            "line": 0,
                            "col": 0,
                            "severity": "Error",
                            "code": "BCP_PARSE",
                            "message": "Bicep CLI returned non-JSON output.",
                        }
                    )

            span.set_attribute("bicep.valid", valid)
            span.set_attribute("bicep.resource_count", len(resources))
            span.set_attribute("bicep.error_count", sum(1 for e in errors if e["severity"] == "Error"))

            return {
                "valid": valid,
                "errors": errors,
                "resources": resources,
                "total_count": len(resources),
                "arm_template": arm_template_str,
            }
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
