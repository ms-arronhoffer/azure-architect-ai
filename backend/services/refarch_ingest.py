"""Weekly ingest of the Microsoft Architecture Center catalog.

Pulls the undocumented Learn ContentBrowser API
(`https://learn.microsoft.com/api/contentbrowser/search/architectures`),
normalises each entry onto the canonical `RefArch` shape, and upserts by
slug. Preserves user-toggled `featured` flags on updates and never touches
rows whose `source` is `custom` or `community`.

Exposed for both the APScheduler job (`services/scheduler.py`) and the
manual `POST /api/refarch/ingest` admin endpoint.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import httpx
from sqlalchemy import select

from config import settings
from db import RefArch, session_scope
from middleware.logging import get_logger
from services.rag_service import CORPUS_REFERENCE_ARCHS, index_documents

_log = get_logger("refarch_ingest")

_BASE_URL = "https://learn.microsoft.com"
_FIRST_PAGE = (
    "/api/contentbrowser/search/architectures"
    "?locale=en-us&$top=30&$skip=0"
)


async def fetch_architectures() -> list[dict[str, Any]]:
    """Walk the ContentBrowser paginated feed and return every entry."""
    headers = {"User-Agent": settings.ingest_user_agent, "Accept": "application/json"}
    out: list[dict[str, Any]] = []
    next_path: str | None = _FIRST_PAGE
    pages = 0
    async with httpx.AsyncClient(
        timeout=15.0, follow_redirects=True, headers=headers, base_url=_BASE_URL
    ) as client:
        while next_path:
            resp = await client.get(next_path)
            resp.raise_for_status()
            payload = resp.json()
            results = payload.get("results") or []
            out.extend(results)
            pages += 1
            next_link = payload.get("@nextLink")
            next_path = next_link if next_link else None
            if pages > 60:
                _log.warning("refarch_ingest.pagination_cap_hit", pages=pages)
                break
    _log.info("refarch_ingest.fetched", pages=pages, entries=len(out))
    return out


def _slug_from_url(url: str) -> str:
    return (url or "").rstrip("/").rsplit("/", 1)[-1].lower()


def normalize(api_entry: dict[str, Any]) -> dict[str, Any] | None:
    """Map a Learn API entry onto the canonical RefArch dict shape.

    Returns None if the entry is missing the fields we need to key on.
    """
    url = api_entry.get("url") or ""
    title = api_entry.get("title") or ""
    if not url or not title:
        return None
    slug = _slug_from_url(url)
    if not slug:
        return None

    azure_categories: list[str] = list(api_entry.get("azure_categories") or [])
    products: list[str] = list(api_entry.get("display_products") or api_entry.get("products") or [])
    tags = sorted({*azure_categories, *products})

    learn_url = url if url.startswith("http") else f"{_BASE_URL}{url}"
    thumb = api_entry.get("thumbnail_url")
    diagram_url = (
        thumb if (thumb and thumb.startswith("http")) else (f"{_BASE_URL}{thumb}" if thumb else None)
    )

    return {
        "slug": slug,
        "title": title,
        "summary": (api_entry.get("summary") or "").strip(),
        "category": (azure_categories[0] if azure_categories else "general"),
        "tags": tags,
        "services": products,
        "patterns": [],
        "waf_score": {},
        "estimated_monthly": {},
        "complexity": "Medium",
        "learn_url": learn_url,
        "repo_url": None,
        "bicep_avm_module": None,
        "diagram_url": diagram_url,
        "source": "microsoft_official",
    }


async def upsert_architectures(entries: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert a batch of normalised entries. Returns counts."""
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    inserted = updated = unchanged = skipped = 0

    async with session_scope() as session:
        for entry in entries:
            slug = entry["slug"]
            existing: RefArch | None = (
                await session.execute(select(RefArch).where(RefArch.slug == slug))
            ).scalars().first()

            if existing is None:
                session.add(RefArch(
                    id=str(uuid.uuid4()),
                    slug=slug,
                    title=entry["title"],
                    summary=entry["summary"],
                    category=entry["category"],
                    tags=entry["tags"],
                    services=entry["services"],
                    patterns=entry["patterns"],
                    waf_score=entry["waf_score"],
                    estimated_monthly=entry["estimated_monthly"],
                    complexity=entry["complexity"],
                    learn_url=entry["learn_url"],
                    repo_url=entry["repo_url"],
                    bicep_avm_module=entry["bicep_avm_module"],
                    diagram_url=entry["diagram_url"],
                    source="microsoft_official",
                    featured=False,
                    created_at=now,
                    last_synced_at=now,
                ))
                inserted += 1
                continue

            if existing.source in ("custom", "community"):
                skipped += 1
                continue

            changed = (
                existing.title != entry["title"]
                or existing.summary != entry["summary"]
                or existing.category != entry["category"]
                or (existing.tags or []) != entry["tags"]
                or (existing.services or []) != entry["services"]
                or existing.learn_url != entry["learn_url"]
                or existing.diagram_url != entry["diagram_url"]
            )
            if changed:
                existing.title = entry["title"]
                existing.summary = entry["summary"]
                existing.category = entry["category"]
                existing.tags = entry["tags"]
                existing.services = entry["services"]
                existing.learn_url = entry["learn_url"]
                existing.diagram_url = entry["diagram_url"]
                updated += 1
            else:
                unchanged += 1
            existing.last_synced_at = now
        await session.commit()

    return {"inserted": inserted, "updated": updated, "unchanged": unchanged, "skipped": skipped}


def _arch_to_rag_content(entry: dict[str, Any]) -> str:
    parts = [
        entry["title"],
        entry.get("summary", ""),
        "Category: " + (entry.get("category") or "general"),
        "Tags: " + ", ".join(entry.get("tags") or []),
        "Services: " + ", ".join(entry.get("services") or []),
    ]
    return "\n".join(p for p in parts if p)


async def index_into_rag(entries: list[dict[str, Any]]) -> int:
    """Mirror upserted entries into the RAG ``reference_archs`` corpus so the
    Architect agent can cite Microsoft-official architectures alongside the
    hand-curated `data.reference_archs` set.
    """
    if not entries:
        return 0
    now_iso = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    docs = [
        {
            "source_id": entry["slug"],
            "title": entry["title"],
            "url": entry.get("learn_url"),
            "content": _arch_to_rag_content(entry),
            "metadata": {
                "corpus_type": "reference_arch",
                "slug": entry["slug"],
                "category": entry.get("category"),
                "tags": entry.get("tags") or [],
                "services": entry.get("services") or [],
                "diagram_url": entry.get("diagram_url"),
                "source": entry.get("source") or "microsoft_official",
                "synced_at": now_iso,
            },
        }
        for entry in entries
    ]
    async with session_scope() as session:
        return await index_documents(session, CORPUS_REFERENCE_ARCHS, docs, replace=False)


async def run_ingest() -> dict[str, Any]:
    """Top-level entry point — fetch, normalise, upsert, log."""
    started = dt.datetime.now(dt.UTC)
    try:
        raw = await fetch_architectures()
    except Exception as exc:
        _log.exception("refarch_ingest.fetch_failed", error=str(exc))
        return {"ok": False, "stage": "fetch", "error": str(exc)}

    normalised: list[dict[str, Any]] = []
    for entry in raw:
        norm = normalize(entry)
        if norm is not None:
            normalised.append(norm)

    try:
        counts = await upsert_architectures(normalised)
    except Exception as exc:
        _log.exception("refarch_ingest.upsert_failed", error=str(exc))
        return {"ok": False, "stage": "upsert", "error": str(exc)}

    rag_indexed = 0
    try:
        rag_indexed = await index_into_rag(normalised)
    except Exception as exc:
        # RAG mirror is best-effort — the canonical RefArch table is the
        # source of truth for the library UI, so a failed mirror should not
        # fail the whole ingest.
        _log.exception("refarch_ingest.rag_mirror_failed", error=str(exc))

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "fetched": len(raw),
        "normalised": len(normalised),
        "rag_indexed": rag_indexed,
        "duration_s": round(duration_s, 2),
        **counts,
    }
    _log.info("refarch_ingest.completed", **summary)
    return summary


__all__ = ["fetch_architectures", "index_into_rag", "normalize", "run_ingest", "upsert_architectures"]
