"""
Enrich free-text recommendations with citations from learn.microsoft.com
via the MCP `documentation` tool.

Designed to be cheap to call repeatedly inside a WAF pass — the cache is
passed in from the caller so it lives for the duration of one assessment
(WAF restates many of the same recommendations across pillars; we don't
want to pay the MCP round-trip 3x for "Enable Defender for Cloud").
"""
from __future__ import annotations

import json
import logging
import re
from typing import Iterable

from services.mcp_service import call_mcp_tool

log = logging.getLogger(__name__)

_LEARN_HOST_RE = re.compile(r"https?://learn\.microsoft\.com/[^\s)\"']+", re.IGNORECASE)


def _normalize_query(text: str) -> str:
    # Cache key — collapse whitespace and lowercase. Recommendations restated
    # with slightly different wording will still share a cache entry.
    return " ".join(text.lower().split())[:240]


def _extract_first_learn_url(payload: str) -> str | None:
    """Find the first learn.microsoft.com URL in a raw MCP response."""
    if not payload:
        return None
    # First try parsing JSON-shaped responses (MCP often returns structured arrays)
    try:
        parsed = json.loads(payload)
    except Exception:
        parsed = None

    candidates: list[str] = []

    def _walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
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


async def lookup_citation(
    text: str,
    cache: dict[str, str | None],
    *,
    timeout_hint: int = 5,
) -> str | None:
    """
    Return a learn.microsoft.com URL for the given recommendation text,
    or None if no result/error. Results are memoized in the caller-supplied
    cache dict.
    """
    if not text or not text.strip():
        return None
    key = _normalize_query(text)
    if key in cache:
        return cache[key]
    try:
        raw = await call_mcp_tool("mcp_documentation", {"query": text})
    except Exception as exc:
        log.debug("citation lookup failed for %r: %s", text[:60], exc)
        cache[key] = None
        return None
    url = _extract_first_learn_url(raw or "")
    cache[key] = url
    return url


async def enrich_recommendations(
    recs: Iterable[str],
    cache: dict[str, str | None],
) -> list[dict]:
    """
    Convert a list of recommendation strings into structured records with
    a learn_url citation (when available). Always returns a record per
    input string, even when no URL was found, so downstream UIs can
    render uniformly.
    """
    out: list[dict] = []
    for r in recs:
        text = (r or "").strip()
        if not text:
            continue
        url = await lookup_citation(text, cache)
        record: dict = {"text": text}
        if url:
            record["learn_url"] = url
            record["source"] = "azure-mcp:documentation"
        out.append(record)
    return out
