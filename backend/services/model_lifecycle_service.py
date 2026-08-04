"""Azure Foundry model retirement schedule — daily-refreshed catalog.

Powers the AI Model Lifecycle panel. The schedule used to be a hardcoded table
in the frontend, so it went stale the moment Microsoft published a change.

Source of truth is the Microsoft Learn article "Model retirement schedule"
(`learn.microsoft.com/azure/foundry/openai/concepts/model-retirement-schedule`).
The rendered HTML is brittle to parse, so we read the same content from its
published docs source in `MicrosoftDocs/azure-ai-docs`, where every provider
section is a plain Markdown table with stable columns:

    | Model | Version | Lifecycle | Retirement date | Replacement |

Freshness model (why every user sees fresh data without extra config):

- ``fetch_lifecycle()`` is a three-tier read: process memory → DB row → live
  fetch. The DB row is shared by every replica and every user, so one fetch a
  day serves the whole deployment.
- The DB row is treated as fresh for ``_MAX_AGE_SECONDS`` (24h). Once it ages
  out, the next read refreshes it. That keeps the panel current even when
  ``INGEST_ENABLED=false`` and the scheduler job never runs.
- ``refresh_lifecycle()`` is the scheduler entry point (daily cron).
- If the network is unreachable, the last-known DB rows are served, falling
  back to a committed seed snapshot so the panel always renders (flagged with
  ``stale: true`` so the UI can say so).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from config import settings
from middleware.logging import get_logger

_log = get_logger("model_lifecycle")

_SEED_FILE = Path(__file__).parent.parent / "data" / "model_iq" / "model_lifecycle_seed.json"

# Human-facing Learn page (linked from the UI).
LEARN_URL = (
    "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule"
)

# Docs source for the same page. The article itself is a thin wrapper around an
# INCLUDE file; `_fetch_markdown` follows that one level of indirection so the
# URL keeps working if Microsoft renames or inlines the include.
SCHEDULE_SOURCES = [
    "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main"
    "/articles/foundry/openai/includes/concepts-model-retirement-schedule-content.md",
    "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main"
    "/articles/foundry/openai/concepts/model-retirement-schedule.md",
]

_CACHE_KEY = "default"
_MAX_AGE_SECONDS = 24 * 60 * 60  # refresh at most once a day
_MEMORY_TTL_SECONDS = 15 * 60
# Forced refreshes (Refresh button, scheduler start-up job) bypass the caches,
# so keep a floor between live fetches to protect the docs source.
_FORCE_REFRESH_INTERVAL_SECONDS = 60

_memory: dict[str, Any] | None = None
_memory_time: float = 0.0
_last_live_fetch: float = 0.0

_SOLD_BY_AZURE_HEADING = "foundry models sold by azure"
_SOLD_BY_PARTNER_HEADING = "foundry models from partners and community"

_LIFECYCLE_VALUES = {
    "ga": "GA",
    "generally available": "GA",
    "preview": "Preview",
    "deprecated": "Deprecated",
    "retired": "Retired",
    "legacy": "Legacy",
}

_EMPTY_CELLS = {"", "-", "--", "\u2014", "\u2013", "n/a", "na", "none", "tbd"}
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_INCLUDE = re.compile(r"\[!INCLUDE\s*\[[^\]]*\]\(([^)]+)\)\]", re.IGNORECASE)
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HTML_TAG = re.compile(r"<[^>]+>")


# ── parsing ───────────────────────────────────────────────────────────────────


def _clean_cell(raw: str) -> str:
    text = _MD_LINK.sub(r"\1", raw)
    text = _HTML_TAG.sub("", text)  # footnote markers like <sup>1</sup>
    text = text.replace("*", "").replace("`", "")
    return " ".join(text.split()).strip()


def _optional(value: str) -> str | None:
    return None if value.lower() in _EMPTY_CELLS else value


def _normalize_lifecycle(value: str) -> str:
    return _LIFECYCLE_VALUES.get(value.lower(), value or "GA")


def _parse_retirement(value: str) -> str | None:
    """Return an ISO date, or None when the cell carries no concrete date.

    Some rows read "No earlier than 2027-04-14" — take the first ISO date so
    the countdown still works.
    """
    if value.lower() in _EMPTY_CELLS:
        return None
    match = _ISO_DATE.search(value)
    return match.group(0) if match else None


def _split_row(line: str) -> list[str]:
    inner = line.strip().strip("|")
    return [_clean_cell(cell) for cell in inner.split("|")]


def parse_schedule_markdown(markdown: str) -> list[dict[str, Any]]:
    """Parse the retirement-schedule doc into model lifecycle entries.

    Sections map to metadata: `## Foundry Models sold by Azure` / `... from
    partners and community` set `soldBy`, and each `### <Provider>` heading
    names the provider. `#### Fine-tuned models` sub-tables use a different
    column layout and are skipped.
    """
    sold_by = "Azure"
    provider: str | None = None
    skip_subsection = False
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()

    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            heading = stripped[level:].strip()
            lowered = heading.lower()
            if level <= 2:
                if lowered.startswith(_SOLD_BY_PARTNER_HEADING):
                    sold_by = "Partner"
                elif lowered.startswith(_SOLD_BY_AZURE_HEADING):
                    sold_by = "Azure"
                provider = None
                skip_subsection = False
            elif level == 3:
                provider = heading
                skip_subsection = False
            else:
                skip_subsection = True
            continue

        if not stripped.startswith("|") or provider is None or skip_subsection:
            continue

        cells = _split_row(stripped)
        if len(cells) < 5:
            continue
        model, version, lifecycle, retirement, replacement = cells[:5]
        if not model or model.lower() == "model":
            continue
        if set(model) <= {"-", ":"}:  # table separator row
            continue

        version_value = _optional(version) or "—"
        key = (sold_by, provider.lower(), model.lower(), version_value.lower())
        if key in seen:  # the doc repeats some rows
            continue
        seen.add(key)

        entries.append({
            "provider": provider,
            "model": model,
            "version": version_value,
            "lifecycle": _normalize_lifecycle(lifecycle),
            "retirement": _parse_retirement(retirement),
            "replacement": _optional(replacement),
            "soldBy": sold_by,
        })

    return entries


# ── live fetch ────────────────────────────────────────────────────────────────


async def _fetch_markdown(client: httpx.AsyncClient, url: str, depth: int = 1) -> str:
    resp = await client.get(url)
    resp.raise_for_status()
    text = resp.text
    if "|" in text and "---" in text:
        return text
    include = _INCLUDE.search(text)
    if include and depth > 0:
        return await _fetch_markdown(client, urljoin(url, include.group(1)), depth - 1)
    return text


async def _fetch_live() -> list[dict[str, Any]]:
    headers = {"User-Agent": settings.ingest_user_agent, "Accept": "text/plain, */*"}
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as client:
        for url in SCHEDULE_SOURCES:
            try:
                markdown = await _fetch_markdown(client, url)
            except Exception as exc:
                _log.warning("model_lifecycle.fetch_failed", url=url, error=str(exc))
                continue
            entries = parse_schedule_markdown(markdown)
            if entries:
                _log.info("model_lifecycle.fetched", url=url, count=len(entries))
                return entries
            _log.warning("model_lifecycle.empty_parse", url=url)
    return []


# ── persistence ───────────────────────────────────────────────────────────────


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


def _load_seed() -> tuple[list[dict[str, Any]], str | None]:
    try:
        payload = json.loads(_SEED_FILE.read_text())
    except (OSError, ValueError) as exc:
        _log.warning("model_lifecycle.seed_unavailable", error=str(exc))
        return [], None
    return list(payload.get("models") or []), payload.get("fetchedAt")


async def _load_from_db() -> tuple[list[dict[str, Any]], dt.datetime | None]:
    from db import ModelLifecycleCache, session_scope

    async with session_scope() as s:
        row = await s.get(ModelLifecycleCache, _CACHE_KEY)
        if row is None:
            return [], None
        return list(row.models or []), row.fetched_at


async def _persist_to_db(models: list[dict[str, Any]]) -> None:
    from db import ModelLifecycleCache, session_scope

    async with session_scope() as s:
        row = await s.get(ModelLifecycleCache, _CACHE_KEY)
        if row is None:
            s.add(ModelLifecycleCache(cache_key=_CACHE_KEY, models=models, fetched_at=_now()))
        else:
            row.models = models
            row.fetched_at = _now()
        await s.commit()


def _envelope(
    models: list[dict[str, Any]],
    fetched_at: dt.datetime | str | None,
    stale: bool,
) -> dict[str, Any]:
    if isinstance(fetched_at, dt.datetime):
        last_refreshed = fetched_at.replace(tzinfo=dt.UTC).isoformat()
    else:
        last_refreshed = fetched_at
    return {
        "models": models,
        "count": len(models),
        "last_refreshed": last_refreshed,
        "source_url": LEARN_URL,
        "stale": stale,
    }


def _is_fresh(fetched_at: dt.datetime | None) -> bool:
    if fetched_at is None:
        return False
    age = (_now() - fetched_at).total_seconds()
    return 0 <= age < _MAX_AGE_SECONDS


async def fetch_lifecycle(force_refresh: bool = False) -> dict[str, Any]:
    """Return the model lifecycle envelope, refreshing at most once a day."""
    global _memory, _memory_time, _last_live_fetch
    now = time.monotonic()

    if force_refresh and _memory is not None and (now - _last_live_fetch) < _FORCE_REFRESH_INTERVAL_SECONDS:
        # A live fetch just happened (e.g. the start-up job) — serve it rather
        # than re-hitting the docs source on every Refresh click.
        return _memory

    if not force_refresh and _memory is not None and (now - _memory_time) < _MEMORY_TTL_SECONDS:
        return _memory

    db_models: list[dict[str, Any]] = []
    db_fetched_at: dt.datetime | None = None
    try:
        db_models, db_fetched_at = await _load_from_db()
    except Exception as exc:
        _log.warning("model_lifecycle.db_read_failed", error=str(exc))

    if not force_refresh and db_models and _is_fresh(db_fetched_at):
        result = _envelope(db_models, db_fetched_at, stale=False)
        _memory, _memory_time = result, now
        return result

    models = await _fetch_live()
    _last_live_fetch = time.monotonic()
    if models:
        try:
            await _persist_to_db(models)
        except Exception as exc:
            _log.warning("model_lifecycle.db_write_failed", error=str(exc))
        result = _envelope(models, _now(), stale=False)
        _memory, _memory_time = result, now
        return result

    # Live fetch failed — serve the last known data rather than an empty table.
    if db_models:
        result = _envelope(db_models, db_fetched_at, stale=not _is_fresh(db_fetched_at))
        _memory, _memory_time = result, now
        return result

    seed_models, seed_fetched_at = _load_seed()
    result = _envelope(seed_models, seed_fetched_at, stale=True)
    _memory, _memory_time = result, now
    return result


async def refresh_lifecycle() -> int:
    """Scheduler entry point — force a live refresh. Returns the model count."""
    result = await fetch_lifecycle(force_refresh=True)
    _log.info(
        "model_lifecycle.refreshed",
        count=result["count"],
        stale=result["stale"],
    )
    return int(result["count"])


def reset_cache() -> None:
    """Drop the in-memory cache (tests + admin refresh)."""
    global _memory, _memory_time, _last_live_fetch
    _memory = None
    _memory_time = 0.0
    _last_live_fetch = 0.0


__all__ = [
    "LEARN_URL",
    "SCHEDULE_SOURCES",
    "fetch_lifecycle",
    "parse_schedule_markdown",
    "refresh_lifecycle",
    "reset_cache",
]
