"""Daily ingest of Azure Updates announcements into the RAG corpus.

Shares the HTTP fetch with `whats_new_service.fetch_announcements()` — one
network call powers both the WhatsNewPanel UI surface AND the
`corpus="azure_updates"` rows that the Architect agent cites from.

Metadata recorded per row:
- ``published_at`` — ISO-8601 UTC, parsed from the feed's pubDate (RFC 822
  or ISO 8601 from atom). Drives the freshness badge in citations.
- ``source_label`` — human-readable feed name ("Azure Updates").
- ``feed_source`` — internal feed id.

Idempotent: rows are upserted by ``source_id`` (the announcement URL), so
re-runs only re-embed entries whose body actually changed.
"""
from __future__ import annotations

import datetime as dt
from email.utils import parsedate_to_datetime
from typing import Any

from db import session_scope
from middleware.logging import get_logger
from services.rag_service import index_documents
from services.whats_new_service import fetch_announcements

_log = get_logger("azure_updates_ingest")

CORPUS_AZURE_UPDATES = "azure_updates"

# Skip announcements older than this. Azure Updates RSS sometimes carries
# multi-year backlog; we only want the rolling window architects care about.
_MAX_AGE_DAYS = 365


def _parse_pub_date(raw: str) -> dt.datetime | None:
    """Parse RSS pubDate (RFC 822) or Atom updated/published (ISO 8601)."""
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed is not None:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.UTC)
            return parsed.astimezone(dt.UTC)
    except (TypeError, ValueError):
        pass
    try:
        iso = raw.replace("Z", "+00:00")
        parsed = dt.datetime.fromisoformat(iso)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.UTC)
        return parsed.astimezone(dt.UTC)
    except (TypeError, ValueError):
        return None


def normalize(item: dict[str, Any], now: dt.datetime) -> dict[str, Any] | None:
    """Map a whats_new item onto a rag_service.index_documents() doc dict."""
    url = (item.get("url") or "").strip()
    title = (item.get("title") or "").strip()
    if not url or not title:
        return None

    published = _parse_pub_date(item.get("pub_date") or "")
    if published is not None:
        age_days = (now - published).days
        if age_days > _MAX_AGE_DAYS or age_days < -1:
            return None
        published_iso = published.isoformat()
    else:
        age_days = None
        published_iso = None

    description = (item.get("description") or "").strip()
    body = f"{title}\n\n{description}" if description else title

    return {
        "source_id": url,
        "title": title,
        "url": url,
        "content": body,
        "metadata": {
            "corpus_type": "azure_update",
            "published_at": published_iso,
            "age_days_at_ingest": age_days,
            "source_label": item.get("source_label") or "Azure Updates",
            "feed_source": item.get("source") or "azure-updates",
        },
    }


async def run_ingest() -> dict[str, Any]:
    """Fetch the Azure Updates feed, normalise, and upsert into the RAG corpus."""
    started = dt.datetime.now(dt.UTC)
    try:
        announcements = await fetch_announcements(force_refresh=True)
    except Exception as exc:
        _log.exception("azure_updates_ingest.fetch_failed", error=str(exc))
        return {"ok": False, "stage": "fetch", "error": str(exc)}

    updates = [a for a in announcements if a.get("source") == "azure-updates"]
    normalised: list[dict[str, Any]] = []
    skipped_too_old = 0
    for item in updates:
        norm = normalize(item, started)
        if norm is None:
            skipped_too_old += 1
            continue
        normalised.append(norm)

    indexed = 0
    if normalised:
        try:
            async with session_scope() as session:
                indexed = await index_documents(
                    session, CORPUS_AZURE_UPDATES, normalised, replace=False
                )
        except Exception as exc:
            _log.exception("azure_updates_ingest.index_failed", error=str(exc))
            return {"ok": False, "stage": "index", "error": str(exc)}

    duration_s = (dt.datetime.now(dt.UTC) - started).total_seconds()
    summary = {
        "ok": True,
        "fetched": len(updates),
        "normalised": len(normalised),
        "skipped_too_old": skipped_too_old,
        "indexed": indexed,
        "duration_s": round(duration_s, 2),
    }
    _log.info("azure_updates_ingest.completed", **summary)
    return summary


__all__ = ["CORPUS_AZURE_UPDATES", "normalize", "run_ingest"]
