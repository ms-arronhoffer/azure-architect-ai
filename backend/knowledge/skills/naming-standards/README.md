# Azure Naming Standards — Skill Package

This skill turns the built-in **Naming Standards** tool into a portable,
installable Custom Skill. It generates a complete Azure CAF resource-naming
convention: a spec table (pattern + example per resource type), a Bicep
`naming.bicep` module, and a Terraform `locals.tf` equivalent.

## Package layout

```
naming-standards/
  skill.yaml            # REQUIRED — manifest (name, slug, version, …)
  instructions.md       # system-prompt fragment injected when the skill is active
  inputs.schema.json    # declarative input fields (org prefix, environments, …)
  knowledge/            # CAF components + abbreviation reference (ingested into RAG)
    caf-naming.md
  examples.yaml         # starter prompts shown in the UI
  icon.svg              # skill icon
  README.md             # authoring notes (ignored by the importer)
```

## Rebuild / upload

To (re)publish from this folder, zip its **contents** (so `skill.yaml` is at the
archive root or one folder deep) and upload it under **Skills → Upload skill**,
or install it directly from the **Skill Showcase** (it ships as a curated,
featured entry).

```bash
cd backend/knowledge/skills
zip -r naming-standards.zip naming-standards
```

See `docs/CUSTOM_SKILLS.md` for the full schema, limits, and authoring guide.
