# Custom Skills + Skill Showcase

Custom Skills let each user extend the assistant with their own **declarative**
capabilities — a prompt, optional grounding knowledge, and an optional input
form — packaged as a zip and uploaded into the app. Skills are persisted
per-user, loaded at login, and (when active) augment the chat system prompt and
ground answers via a private retrieval corpus.

The **Skill Showcase** is a shared catalog (like the Demo and Reference
Architecture showcases) where users publish skills and install ones authored by
others.

> **Feature flag.** The whole surface is gated behind `CUSTOM_SKILLS`
> (backend) / `VITE_CUSTOM_SKILLS` (frontend fallback), **on by default**. Set
> it to a falsy value (`false`/`0`/`no`/`off`) to disable. The flag is resolved
> at runtime via `GET /api/config`, mirroring `UNIFIED_AGENTS`.

## What a skill is (and is not)

A skill is **declarative**: prompt instructions + knowledge docs + a declarative
input schema. It contains **no executable code** — nothing in a package is ever
run. This is what makes skills safe to persist, share, and load from untrusted
authors.

## Package format

```
my-skill/
  skill.yaml            # REQUIRED — manifest
  instructions.md       # system-prompt fragment injected when active
  inputs.schema.json    # OPTIONAL — declarative input fields
  knowledge/            # OPTIONAL — grounding docs ingested into RAG
    overview.md
  examples.yaml         # OPTIONAL — starter prompts shown in the UI
  icon.svg              # OPTIONAL — skill icon
  README.md             # OPTIONAL — authoring notes (ignored by the importer)
```

A ready-to-edit starter package lives at
`backend/knowledge/skills/sample_skill/` and is downloadable from the app
(**Skills → Download sample**) or `GET /api/skills/sample`. The manifest JSON
Schema is at `backend/knowledge/skills/skill.schema.json`.

A fully-worked, curated example — the **Azure Naming Standards** skill — lives at
`backend/knowledge/skills/naming-standards/` and ships pre-installed in the
Skill Showcase (featured). It turns the built-in Naming Standards tool into a
portable skill; install it from **Skill Showcase**, or copy the folder as a
template for your own governance skills.

### `skill.yaml`

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | 1–200 chars. |
| `slug` | no | 3–64 chars, `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`. Defaults to a slugified name. |
| `version` | no | Semver, e.g. `1.0.0`. |
| `category` | no | One of: general, architecture, cost, operations, compliance, security, networking, data, ai, migration, governance. |
| `description` | no | ≤ 2000 chars. |
| `author` | no | ≤ 200 chars. |
| `tags` | no | Up to 20 strings. |
| `instructions` | no | Inline fallback for `instructions.md`. |

### `inputs.schema.json` (optional)

```json
{
  "fields": [
    { "name": "scope", "label": "Scope", "type": "text", "required": false },
    { "name": "environment", "label": "Environment", "type": "select",
      "options": ["all", "prod", "dev"] }
  ]
}
```

Supported field `type`s: `text`, `textarea`, `number`, `select`, `boolean`.
`select` requires a non-empty `options` list. Max 30 fields.

## Limits and security

- **Size budget:** ≤ 5 MB compressed, ≤ 20 MB decompressed, ≤ 200 members,
  ≤ 50 knowledge files, ≤ 5 MB per file.
- **Allow-list:** only `.yaml`, `.yml`, `.json`, `.md`, `.txt`, `.svg` members
  are accepted; anything else is rejected.
- **Zip hardening:** path traversal / absolute paths (zip-slip) and oversized
  decompression (zip-bomb) are rejected.
- **Sanitization:** `instructions.md` and `icon.svg` are stripped of
  `<script>`/`<iframe>`/inline event handlers / `javascript:` URIs before being
  persisted or rendered. Treat instructions as untrusted prompt content.
- **Isolation:** every `UserSkill` query is filtered by `user_id` plus the
  tenant listener. A showcase install always creates a fresh user-owned copy;
  knowledge lands in a private corpus `skill:<id>`.

## Persistence

- `UserSkill` (`backend/db.py`) — per-user installed skills (tenant-scoped). The
  original zip bytes are stored inline for re-export.
- `ShowcaseSkill` (`backend/db.py`) — global shareable catalog (like `Demo`).
- Knowledge docs are indexed into `rag_documents` under corpus `skill:<id>`.

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/skills/upload` | Upload + install a package (multipart zip). |
| `GET /api/skills` | List the caller's skills (loaded at login). |
| `GET /api/skills/sample` | Download the starter package. |
| `GET /api/skills/{id}` | Get one skill (full detail). |
| `PATCH /api/skills/{id}` | Enable/disable or rename. |
| `DELETE /api/skills/{id}` | Remove + purge its RAG corpus. |
| `GET /api/skills/{id}/export` | Re-download the package zip. |
| `GET /api/skills/showcase` | List the showcase catalog. |
| `POST /api/skills/showcase/{id}/install` | Install a showcase skill. |
| `POST /api/skills/{id}/publish` | Publish one of your skills. |
| `PATCH/DELETE /api/skills/showcase/{id}` | Admin curation (`Metrics.Read`). |

## Runtime activation

When a skill is active the frontend passes its id as `skill_id` to
`POST /api/chat`. The chat route (`backend/routes/chat.py`) loads the
user-scoped, enabled skill, appends `## Active Skill — <name>` + its
instructions to the system prompt, and grounds the turn with the top hits from
the skill's `skill:<id>` corpus. This is additive to the existing prompt
pipeline — a missing/disabled skill or a flag-off is a no-op.
