"""Weekly ingest of the awesome-azd Microsoft-authored templates catalog.

Pulls the single JSON manifest published by the awesome-azd repo
(`Azure/awesome-azd:website/static/templates.json`), filters to
Microsoft-tagged entries, normalises each onto the canonical `Demo`
shape, and upserts by stable awesome-azd UUID. Preserves user-toggled
`featured` flags on updates and never touches rows whose `source` is
`custom` or `community`.

Exposed for both the APScheduler job (`services/scheduler.py`) and the
manual `POST /api/demos/ingest` admin endpoint.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

import httpx
from sqlalchemy import select

from config import settings
from db import Demo, session_scope
from middleware.logging import get_logger

_log = get_logger("demo_ingest")

_AZD_URL = (
    "https://raw.githubusercontent.com/Azure/awesome-azd/main/"
    "website/static/templates.json"
)
_PREVIEW_BASE = "https://azure.github.io/awesome-azd/"


async def fetch_templates() -> list[dict[str, Any]]:
    """Fetch the awesome-azd templates manifest (single JSON file)."""
    headers = {"User-Agent": settings.ingest_user_agent, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as client:
        resp = await client.get(_AZD_URL)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, list):
        _log.warning("demo_ingest.unexpected_payload_type", got=type(data).__name__)
        return []
    _log.info("demo_ingest.fetched", entries=len(data))
    return data


def _resolve_thumbnail(preview: str | None) -> str | None:
    if not preview:
        return None
    if preview.startswith(("http://", "https://")):
        return preview
    return _PREVIEW_BASE + preview.lstrip("./")


def normalize(entry: dict[str, Any]) -> dict[str, Any] | None:
    """Map an awesome-azd entry onto the canonical Demo dict shape.

    Returns None for non-msft entries or entries missing required fields.
    """
    tags_raw = entry.get("tags") or []
    if "msft" not in tags_raw:
        return None
    title = (entry.get("title") or "").strip()
    repo_url = (entry.get("source") or "").strip()
    azd_id = (entry.get("id") or "").strip()
    if not title or not repo_url or not azd_id:
        return None

    flat_tags = {
        *(t for t in tags_raw if t and t != "msft"),
        *(entry.get("IaC") or []),
        *(entry.get("languages") or []),
        *(entry.get("azureServices") or []),
    }
    tags = sorted(t for t in flat_tags if t)

    return {
        "id": f"azd-{azd_id}",
        "title": title,
        "description": (entry.get("description") or "").strip(),
        "tags": tags,
        "video_url": None,
        "repo_url": repo_url,
        "live_url": None,
        "thumbnail_url": _resolve_thumbnail(entry.get("preview")),
        "source": "microsoft_official",
    }


async def upsert_demos(entries: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert a batch of normalised demos. Returns counts."""
    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    inserted = updated = unchanged = skipped = 0

    async with session_scope() as session:
        for entry in entries:
            demo_id = entry["id"]
            existing: Demo | None = (
                await session.execute(select(Demo).where(Demo.id == demo_id))
            ).scalars().first()

            if existing is None:
                session.add(Demo(
                    id=demo_id,
                    title=entry["title"],
                    description=entry["description"],
                    tags=entry["tags"],
                    video_url=entry["video_url"],
                    repo_url=entry["repo_url"],
                    live_url=entry["live_url"],
                    thumbnail_url=entry["thumbnail_url"],
                    featured=False,
                    created_at=now,
                    source="microsoft_official",
                    last_synced_at=now,
                ))
                inserted += 1
                continue

            if existing.source in ("custom", "community"):
                skipped += 1
                continue

            changed = (
                existing.title != entry["title"]
                or existing.description != entry["description"]
                or (existing.tags or []) != entry["tags"]
                or existing.repo_url != entry["repo_url"]
                or existing.thumbnail_url != entry["thumbnail_url"]
            )
            if changed:
                existing.title = entry["title"]
                existing.description = entry["description"]
                existing.tags = entry["tags"]
                existing.repo_url = entry["repo_url"]
                existing.thumbnail_url = entry["thumbnail_url"]
                updated += 1
            else:
                unchanged += 1
            existing.last_synced_at = now
        await session.commit()

    return {"inserted": inserted, "updated": updated, "unchanged": unchanged, "skipped": skipped}


async def run_ingest() -> dict[str, Any]:
    """Top-level entry point — fetch, normalise, upsert, log."""
    started = dt.datetime.now(dt.UTC)
    try:
        raw = await fetch_templates()
    except Exception as exc:
        _log.exception("demo_ingest.fetch_failed", error=str(exc))
        return {"ok": False, "stage": "fetch", "error": str(exc)}

    normalised: list[dict[str, Any]] = []
    for entry in raw:
        norm = normalize(entry)
        if norm is not None:
            normalised.append(norm)

    try:
        counts = await upsert_demos(normalised)
    except Exception as exc:
        _log.exception("demo_ingest.upsert_failed", error=str(exc))
        return {"ok": False, "stage": "upsert", "error": str(exc)}

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "fetched": len(raw),
        "normalised": len(normalised),
        "duration_s": round(duration_s, 2),
        **counts,
    }
    _log.info("demo_ingest.completed", **summary)
    return summary


__all__ = ["fetch_templates", "normalize", "upsert_demos", "run_ingest"]
