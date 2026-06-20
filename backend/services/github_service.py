"""GitHub REST API helpers for repo creation and file push."""

import base64

import httpx

GITHUB_API = "https://api.github.com"
_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


def _auth(token: str) -> dict:
    return {**_HEADERS, "Authorization": f"Bearer {token}"}


async def get_authenticated_user(token: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{GITHUB_API}/user", headers=_auth(token))
        r.raise_for_status()
        return r.json()


async def create_repo(
    token: str,
    name: str,
    private: bool = True,
    description: str = "",
    org: str | None = None,
) -> dict:
    """Create a repo under the authenticated user, or under `org` when provided.

    GitHub uses two distinct endpoints: `/user/repos` for personal repos and
    `/orgs/{org}/repos` for org-owned repos. Posting org-targeted creates to
    `/user/repos` silently lands the repo under the token owner, which then
    breaks subsequent `push_file(owner=org, ...)` calls with 404s.
    """
    url = f"{GITHUB_API}/orgs/{org}/repos" if org else f"{GITHUB_API}/user/repos"
    async with httpx.AsyncClient() as client:
        r = await client.post(
            url,
            headers=_auth(token),
            json={"name": name, "private": private, "description": description, "auto_init": False},
        )
        r.raise_for_status()
        return r.json()


async def push_file(token: str, owner: str, repo: str, path: str, content: str, message: str) -> dict:
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    async with httpx.AsyncClient() as client:
        r = await client.put(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
            headers=_auth(token),
            json={"message": message, "content": encoded},
        )
        r.raise_for_status()
        return r.json()
