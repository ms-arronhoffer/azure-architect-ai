"""GitHub publishing for demo builds.

Token resolution order:
  1. Explicit `github_token` arg (per-user PAT from the encrypted secret_store)
  2. `GITHUB_TOKEN` environment variable (operator-provided default)

When the caller passes a token we treat publishing as enabled. The
`DEMO_FACTORY_PUBLISH` env flag is honored only as a fallback for the
env-token path so existing operator deployments keep their explicit gate.

Repo owner is derived from the create-repo response (`owner.login`) so
subsequent file pushes always target the actual owning account/org.
`DEMO_FACTORY_GH_ORG` (or `_DEFAULT_ORG`) only steers *where* the repo
is created — when set we POST to `/orgs/{org}/repos`; otherwise we POST
to `/user/repos` under the token owner.
"""

from __future__ import annotations

import asyncio
import os

from middleware.logging import get_logger
from services import github_service

log = get_logger("demo_publish")

_PUBLISH_ENV = "DEMO_FACTORY_PUBLISH"
_ORG_ENV = "DEMO_FACTORY_GH_ORG"
_TOKEN_ENV = "GITHUB_TOKEN"


def publish_enabled(github_token: str | None = None) -> bool:
    """A per-user token implies opt-in; otherwise require the env gate."""
    if github_token:
        return True
    return os.environ.get(_PUBLISH_ENV, "").lower() == "true"


def target_org() -> str | None:
    """Org to create the repo under. None means create under the token owner."""
    val = os.environ.get(_ORG_ENV) or ""
    return val or None


async def publish_to_github(
    slug: str,
    title: str,
    files: dict[str, str],
    azure_services: list[str],
    github_token: str = "",
) -> str:
    """Create a repo and push every file. Returns the HTML URL.

    Raises RuntimeError when publishing is disabled or the token is missing
    so the caller can surface a `phase_skipped` / `phase_failed` event.
    """
    token = github_token or os.environ.get(_TOKEN_ENV) or ""
    if not publish_enabled(token):
        raise RuntimeError("publish_disabled")
    if not token:
        raise RuntimeError("github_token_missing")

    org = target_org()
    description = f"{title} — Azure AI demo (services: {', '.join(azure_services) or 'n/a'})"
    repo = await github_service.create_repo(
        token, name=slug, private=True, description=description, org=org
    )
    # Trust the API response over local config — covers both org repos and
    # personal repos under whichever account the token actually owns.
    owner = (repo.get("owner") or {}).get("login") or org or ""
    html_url = repo.get("html_url") or (f"https://github.com/{owner}/{slug}" if owner else "")

    # Push files one at a time. GitHub's contents API is per-file; serialize
    # to avoid hitting secondary rate limits on a fresh repo.
    for path, content in files.items():
        await github_service.push_file(
            token,
            owner=owner,
            repo=slug,
            path=path,
            content=content,
            message=f"feat: add {path}",
        )
        await asyncio.sleep(0)  # cooperative yield between files

    log.info("demo_publish.success", slug=slug, owner=owner, file_count=len(files))
    return html_url
