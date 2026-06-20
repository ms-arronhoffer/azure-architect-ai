# Vendored from demo-factory

These files are **vendored copies** from the standalone `demo-factory` repo
(a Claude Code skill kit for generating Azure AI demos). They drive the
backend demo-build pipeline (`services/demo_pipeline.py`).

## Source paths

| File here | Source in demo-factory |
|---|---|
| `demo_standards.md` | `knowledge/demo_standards.md` |
| `improvement_patterns.md` | `knowledge/improvement_patterns.md` |
| `bicep_patterns.md` | `knowledge/bicep_patterns.md` |
| `azure_services.md` | `knowledge/azure_services.md` |
| `flask_sse_starter.md` | `templates/flask_sse/starter.md` |
| `react_ts_starter.md` | `templates/react_ts/starter.md` |

Canonical source repo: `C:\Users\arronhoffer\source\repos\demo-factory`

## Why vendored, not symlinked

demo-factory has its own release cadence and may live on different machines.
Vendoring keeps this repo self-contained and reproducible in CI.

## Sync workflow

When demo-factory updates, re-copy the six files and commit. A helper script
lives at `tools/sync_demo_knowledge.sh` (run from repo root) that diffs the
local copies against demo-factory and exits non-zero on drift — wire it into
CI when both repos are checked out side-by-side.
