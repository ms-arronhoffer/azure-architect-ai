# Sample Skill — FinOps Tagging Reviewer

This is a **starter skill package** for the Azure Architect AI Custom Skills
feature. Copy this folder, edit the files, zip it, and upload it under
**Skills → Upload skill**.

## Package layout

```
my-skill/
  skill.yaml            # REQUIRED — manifest (name, slug, version, …)
  instructions.md       # system-prompt fragment injected when the skill is active
  inputs.schema.json    # OPTIONAL — declarative input fields shown in the UI
  knowledge/            # OPTIONAL — grounding docs ingested into RAG
    tagging-standard.md
  examples.yaml         # OPTIONAL — starter prompts shown in the UI
  icon.svg              # OPTIONAL — skill icon (falls back to a default)
  README.md             # OPTIONAL — your authoring notes (ignored by the importer)
```

Only `skill.yaml` is strictly required, but a skill with no `instructions.md`
(and no inline `instructions:` field in the manifest) will be rejected — a skill
needs something to tell the assistant what to do.

## Rules and limits

- **No code.** Packages may only contain `.yaml`, `.yml`, `.json`, `.md`,
  `.txt`, and `.svg` files. Any other file type is rejected. Nothing in a
  package is ever executed.
- **Size budget.** ≤ 5 MB per zip, ≤ 20 MB decompressed, ≤ 200 files total,
  ≤ 50 knowledge files.
- **Instructions** are capped at 20,000 characters.
- **slug** must be 3–64 characters: lowercase letters, digits, and hyphens.
- **version** must be semver (e.g. `1.0.0`).

See `docs/CUSTOM_SKILLS.md` for the full schema and authoring guide.
