"""Weekly ingest of the Azure Verified Modules (AVM) Bicep catalog.

Pulls the published AVM module index (CSV) from
``https://azure.github.io/Azure-Verified-Modules/...`` and fetches each
module's README from GitHub raw content. Indexes into the RAG corpus as
``corpus="avm"`` so the Architect agent can cite the right AVM module +
version when answering "what module should I use for X?".

Cost-aware: only embeds modules whose README ``sha`` (computed from the
raw text) has changed since the last run. We track that via the
``readme_sha`` field in ``RagDocument.doc_metadata``.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
from typing import Any

import httpx
from sqlalchemy import select

from config import settings
from db import RagDocument, session_scope
from middleware.logging import get_logger
from services.rag_service import index_documents

_log = get_logger("avm_ingest")

CORPUS_AVM = "avm"

_INDEX_URLS = [
    "https://azure.github.io/Azure-Verified-Modules/static/data/module-indexes/BicepResourceModules.csv",
    "https://azure.github.io/Azure-Verified-Modules/static/data/module-indexes/BicepPatternModules.csv",
]

# Only ingest modules whose lifecycle status is one of these. AVM's CSV has
# values like "Available", "Proposed", "Orphaned". We don't want to recommend
# orphaned modules.
_INGESTIBLE_STATUSES = {"available", "ga"}

# Cap README body so we don't embed 50 KB of contributor instructions.
_MAX_BODY_CHARS = 8000


async def _fetch_csv(client: httpx.AsyncClient, url: str) -> list[dict[str, str]]:
    resp = await client.get(url)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    return [row for row in reader]


async def _fetch_readme(client: httpx.AsyncClient, raw_url: str) -> str | None:
    try:
        resp = await client.get(raw_url)
        if resp.status_code != 200:
            return None
        return resp.text
    except httpx.HTTPError:
        return None


def _readme_raw_url(repo_url: str) -> str | None:
    """Convert ``https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/...``
    into the raw README URL.
    """
    if not repo_url or "github.com" not in repo_url:
        return None
    repo_url = repo_url.rstrip("/")
    if "/tree/" in repo_url:
        owner_repo, _, branch_path = repo_url.partition("/tree/")
        owner_repo = owner_repo.replace("https://github.com/", "")
        return f"https://raw.githubusercontent.com/{owner_repo}/{branch_path}/README.md"
    if repo_url.startswith("https://github.com/"):
        owner_repo = repo_url.replace("https://github.com/", "")
        return f"https://raw.githubusercontent.com/{owner_repo}/main/README.md"
    return None


def _module_path_from_url(repo_url: str) -> str | None:
    """Extract ``avm/res/aks/cluster`` from a tree URL."""
    if not repo_url or "/tree/" not in repo_url:
        return None
    _, _, branch_path = repo_url.partition("/tree/")
    parts = branch_path.split("/", 1)
    return parts[1] if len(parts) == 2 else None


def normalize(
    row: dict[str, str],
    readme: str,
    flavor: str,
) -> dict[str, Any] | None:
    """Map an index CSV row + fetched README onto an index_documents() doc."""
    module_name = (row.get("ModuleName") or row.get("Name") or "").strip()
    display_name = (row.get("ModuleDisplayName") or module_name).strip()
    repo_url = (row.get("RepoURL") or row.get("ModuleSource") or "").strip()
    status = (row.get("ModuleStatus") or row.get("Status") or "").strip().lower()
    version = (row.get("ModuleVersion") or row.get("LatestVersion") or "").strip()
    provider_namespace = (row.get("ProviderNamespace") or "").strip()
    resource_type = (row.get("ResourceType") or "").strip()

    if not module_name or not repo_url:
        return None
    if status and not any(s in status for s in _INGESTIBLE_STATUSES):
        return None

    module_path = _module_path_from_url(repo_url) or module_name
    body_readme = readme[:_MAX_BODY_CHARS] if readme else ""
    header = (
        f"AVM {flavor} module: {display_name} ({module_name})\n"
        f"Module path: {module_path}\n"
        f"Latest version: {version}\n"
        f"Resource: {provider_namespace}/{resource_type}\n\n"
    )
    content = header + body_readme

    return {
        "source_id": module_path,
        "title": f"AVM {flavor}: {display_name}",
        "url": repo_url,
        "content": content,
        "metadata": {
            "corpus_type": "avm",
            "flavor": flavor,
            "module_name": module_name,
            "module_path": module_path,
            "latest_version": version,
            "provider_namespace": provider_namespace,
            "resource_type": resource_type,
            "status": status,
            "readme_sha": hashlib.sha256((readme or "").encode("utf-8")).hexdigest(),
        },
    }


async def _existing_readme_shas() -> dict[str, str]:
    """Map ``source_id -> readme_sha`` for the current corpus, to short-circuit
    re-embedding unchanged modules."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(RagDocument).where(RagDocument.corpus == CORPUS_AVM)
            )
        ).scalars().all()
    out: dict[str, str] = {}
    for row in rows:
        meta = row.doc_metadata or {}
        sha = meta.get("readme_sha")
        if sha:
            out[row.source_id] = sha
    return out


async def run_ingest() -> dict[str, Any]:
    """Fetch the AVM indexes, pull READMEs, and upsert into the RAG corpus."""
    started = dt.datetime.now(dt.UTC)
    headers = {"User-Agent": settings.ingest_user_agent, "Accept": "*/*"}
    fetched_rows = 0
    indexed = 0
    unchanged = 0
    skipped = 0
    errors = 0

    existing_shas = await _existing_readme_shas()

    async with httpx.AsyncClient(
        timeout=20.0, follow_redirects=True, headers=headers
    ) as client:
        for index_url in _INDEX_URLS:
            flavor = "pattern" if "Pattern" in index_url else "resource"
            try:
                rows = await _fetch_csv(client, index_url)
            except Exception as exc:
                _log.exception("avm_ingest.index_fetch_failed", url=index_url, error=str(exc))
                errors += 1
                continue
            fetched_rows += len(rows)

            docs_to_index: list[dict[str, Any]] = []
            for row in rows:
                repo_url = (row.get("RepoURL") or row.get("ModuleSource") or "").strip()
                raw_url = _readme_raw_url(repo_url)
                if not raw_url:
                    skipped += 1
                    continue
                readme = await _fetch_readme(client, raw_url)
                if readme is None:
                    skipped += 1
                    continue
                normalised = normalize(row, readme, flavor)
                if normalised is None:
                    skipped += 1
                    continue
                prev_sha = existing_shas.get(normalised["source_id"])
                if prev_sha == normalised["metadata"]["readme_sha"]:
                    unchanged += 1
                    continue
                docs_to_index.append(normalised)

            if docs_to_index:
                try:
                    async with session_scope() as session:
                        indexed += await index_documents(
                            session, CORPUS_AVM, docs_to_index, replace=False
                        )
                except Exception as exc:
                    _log.exception("avm_ingest.index_failed", flavor=flavor, error=str(exc))
                    errors += 1

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary: dict[str, Any] = {
        "ok": errors == 0,
        "fetched_rows": fetched_rows,
        "indexed": indexed,
        "unchanged": unchanged,
        "skipped": skipped,
        "errors": errors,
        "duration_s": round(duration_s, 2),
    }
    _log.info("avm_ingest.completed", **summary)
    return summary


__all__ = ["CORPUS_AVM", "normalize", "run_ingest"]
