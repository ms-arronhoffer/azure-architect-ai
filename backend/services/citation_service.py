"""
Enrich free-text recommendations with citations.

Two-tier lookup:
1. **RAG-first** — search the local `RagDocument` corpora (`reference_archs`,
   `avm`, `azure_updates`, `learn`). When a hit is found, the citation
   carries `corpus`, `published_at`, `freshness_days`, and a confidence
   score derived from the cosine similarity. This is the path that gives
   the architect a *trustworthy* citation: they can see WHEN the source
   was published and what KIND of source it is.
2. **MCP fallback** — when nothing in the local corpus is relevant enough,
   fall back to the live `mcp_documentation` lookup (Learn search). Those
   citations land with `corpus="learn_live"` and no freshness signal —
   intentionally distinct so the UI can render them with a "live lookup"
   chip rather than implying staleness/freshness we don't know.

Cache is caller-supplied so it lives for the duration of one assessment
(WAF restates many of the same recommendations across pillars; don't pay
the round-trip 3x for "Enable Defender for Cloud").
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from collections.abc import Iterable
from typing import Any

from db import session_scope
from services.mcp_service import call_mcp_tool

log = logging.getLogger(__name__)

_LEARN_HOST_RE = re.compile(r"https?://learn\.microsoft\.com/[^\s)\"']+", re.IGNORECASE)

_RAG_CORPORA = ["reference_archs", "avm", "azure_updates", "learn"]
# Cosine score below this means "we don't have anything good locally" — fall
# back to live MCP search. Tuned to the 0..1 cosine range produced by
# `embeddings_service.embed_texts` (text-embedding-3-small).
_RAG_CONFIDENCE_FLOOR = 0.28


def _normalize_query(text: str) -> str:
    # Cache key — collapse whitespace and lowercase. Recommendations restated
    # with slightly different wording will still share a cache entry.
    return " ".join(text.lower().split())[:240]


def _extract_first_learn_url(payload: str) -> str | None:
    """Find the first learn.microsoft.com URL in a raw MCP response."""
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except Exception:
        parsed = None

    candidates: list[str] = []

    def _walk(node):
        if isinstance(node, dict):
            for _k, v in node.items():
                if isinstance(v, str) and "learn.microsoft.com" in v:
                    candidates.append(v)
                else:
                    _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    if parsed is not None:
        _walk(parsed)

    if not candidates:
        m = _LEARN_HOST_RE.search(payload)
        if m:
            candidates.append(m.group(0))

    return candidates[0] if candidates else None


def _freshness_days(published_iso: str | None) -> int | None:
    if not published_iso:
        return None
    try:
        parsed = dt.datetime.fromisoformat(published_iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.UTC)
    delta = dt.datetime.now(dt.UTC) - parsed
    return max(delta.days, 0)


async def _rag_lookup(text: str) -> dict[str, Any] | None:
    """Search the local RAG corpora and return the top hit if confident."""
    # Lazy import to avoid a cycle (rag_service may import other services).
    from services.rag_service import search

    try:
        async with session_scope() as session:
            hits = await search(session, text, corpora=_RAG_CORPORA, top_k=1)
    except Exception as exc:
        log.debug("rag citation lookup failed for %r: %s", text[:60], exc)
        return None
    if not hits:
        return None
    top = hits[0]
    score = float(top.get("score") or 0.0)
    if score < _RAG_CONFIDENCE_FLOOR:
        return None
    meta = top.get("metadata") or {}
    published_at = meta.get("published_at") or meta.get("synced_at")
    record: dict[str, Any] = {
        "url": top.get("url"),
        "title": top.get("title"),
        "corpus": top.get("corpus"),
        "corpus_type": meta.get("corpus_type") or top.get("corpus"),
        "published_at": published_at,
        "freshness_days": _freshness_days(published_at),
        "confidence": round(score, 3),
        "source": "rag",
    }
    if meta.get("latest_version"):
        record["version"] = meta["latest_version"]
    if meta.get("module_path"):
        record["module_path"] = meta["module_path"]
    return record


async def build_citation(
    text: str,
    cache: dict[str, dict[str, Any] | None],
    *,
    timeout_hint: int = 5,
) -> dict[str, Any] | None:
    """Return a citation *record* (not just a URL) for the recommendation.

    Order of precedence: RAG hit > MCP live Learn lookup > None.
    """
    if not text or not text.strip():
        return None
    key = _normalize_query(text)
    if key in cache:
        return cache[key]

    rag_record = await _rag_lookup(text)
    if rag_record and rag_record.get("url"):
        cache[key] = rag_record
        return rag_record

    try:
        raw = await call_mcp_tool("mcp_documentation", {"query": text})
    except Exception as exc:
        log.debug("citation lookup failed for %r: %s", text[:60], exc)
        cache[key] = None
        return None
    url = _extract_first_learn_url(raw or "")
    if not url:
        cache[key] = None
        return None
    record = {
        "url": url,
        "title": None,
        "corpus": "learn_live",
        "corpus_type": "learn_live",
        "published_at": None,
        "freshness_days": None,
        "confidence": None,
        "source": "azure-mcp:documentation",
    }
    cache[key] = record
    return record


async def lookup_citation(
    text: str,
    cache: dict[str, str | None] | dict[str, dict[str, Any] | None],
    *,
    timeout_hint: int = 5,
) -> str | None:
    """Backward-compatible: return just the URL string.

    Older callers expect a string cache; we accept either shape but always
    return the URL only.
    """
    # The richer build_citation() uses dict-valued cache. For legacy callers
    # that pass a string-valued cache, mirror writes through a local dict.
    record = await build_citation(text, cache, timeout_hint=timeout_hint)  # type: ignore[arg-type]
    return record["url"] if record and record.get("url") else None


async def enrich_recommendations(
    recs: Iterable[str],
    cache: dict[str, dict[str, Any] | None],
) -> list[dict]:
    """Convert recommendation strings into structured records with full
    citation metadata. One record per non-empty input; if no citation could
    be resolved, the record still ships (with just `text`) so downstream UIs
    can render uniformly.
    """
    out: list[dict] = []
    for r in recs:
        text = (r or "").strip()
        if not text:
            continue
        record: dict = {"text": text}
        citation = await build_citation(text, cache)
        if citation and citation.get("url"):
            record["learn_url"] = citation["url"]
            record["source"] = citation.get("source") or "azure-mcp:documentation"
            record["citation"] = {
                k: v
                for k, v in citation.items()
                if k in (
                    "url",
                    "title",
                    "corpus",
                    "corpus_type",
                    "published_at",
                    "freshness_days",
                    "confidence",
                    "version",
                    "module_path",
                )
                and v is not None
            }
        out.append(record)
    return out
