"""GitHub publishing for demo builds.

Gated entirely behind `DEMO_FACTORY_PUBLISH=true`. Requires `GITHUB_TOKEN`
in the environment (the existing services/github_service helpers take a
token argument; this module pulls it from env). Hardcodes the
`ms-arronhoffer` org for v1; override with `DEMO_FACTORY_GH_ORG`.

The github_service helpers operate against the authenticated user's
account (`POST /user/repos`); for org-owned repos the caller still needs
push permission via that user. v1 sidesteps that nuance by treating the
org name as the repo owner for subsequent file pushes — the operator is
expected to either run as a member of ms-arronhoffer or override
DEMO_FACTORY_GH_ORG to their own handle.
"""

from __future__ import annotations

import asyncio
import os

from middleware.logging import get_logger
from services import github_service

log = get_logger("demo_publish")

_DEFAULT_ORG = "ms-arronhoffer"
_PUBLISH_ENV = "DEMO_FACTORY_PUBLISH"
_ORG_ENV = "DEMO_FACTORY_GH_ORG"
_TOKEN_ENV = "GITHUB_TOKEN"


def publish_enabled() -> bool:
    return os.environ.get(_PUBLISH_ENV, "").lower() == "true"


def target_org() -> str:
    return os.environ.get(_ORG_ENV) or _DEFAULT_ORG


async def publish_to_github(
    slug: str, title: str, files: dict[str, str], azure_services: list[str]
) -> str:
    """Create a private repo and push every file. Returns the HTML URL.

    Raises RuntimeError when publishing is disabled or the token is missing
    so the caller can surface a `phase_skipped` / `phase_failed` event.
    """
    if not publish_enabled():
        raise RuntimeError("publish_disabled")
    token = os.environ.get(_TOKEN_ENV)
    if not token:
        raise RuntimeError("github_token_missing")

    owner = target_org()
    description = f"{title} — Azure AI demo (services: {', '.join(azure_services) or 'n/a'})"
    repo = await github_service.create_repo(
        token, name=slug, private=True, description=description
    )
    html_url = repo.get("html_url") or f"https://github.com/{owner}/{slug}"

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
