"""LLM reranker for hybrid RAG hits.

Cuts a top-30 RRF candidate set down to a top-5 the architect actually
sees. Cosine + lexical scoring is cheap but noisy: a glossary page and a
deep how-to can sit at adjacent ranks. A small model reads the snippets
and decides which ones actually answer the query.

Cache keyed by ``hash(query + ordered doc_ids)`` for 24 h so reasking the
same question (very common in pipeline mode) doesn't repay the call.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from config import settings
from middleware.logging import get_logger
from services.openai_service import call_with_retry, get_client

log = get_logger("rag_reranker")

# 24-hour TTL is generous because the underlying corpus only mutates on
# ingest jobs (daily Azure Updates, weekly AVM). A shorter TTL would burn
# tokens without improving freshness.
_CACHE_TTL_S = 24 * 3600
_CACHE: dict[str, tuple[float, list[dict]]] = {}
# Bound the cache so a long-running process doesn't grow unbounded; the
# rerank cost is small so eviction is cheap.
_CACHE_MAX = 512

_RERANK_PROMPT = (
    "You are a retrieval reranker for an Azure Solutions Architect. "
    "Given a USER QUERY and a numbered list of CANDIDATE PASSAGES, return JSON: "
    '{"picks":[{"i":<index>,"score":<0..1>,"why":"<<=12 words>"}]} '
    "with the top {top_k} candidates that BEST answer the query. "
    "Score reflects how directly the passage answers, not topical adjacency. "
    "Penalise outdated material, marketing fluff, and off-topic SKU lists. "
    "Return only the JSON, no prose."
)


def _cache_key(query: str, hits: list[dict]) -> str:
    doc_ids = "|".join(str(h.get("source_id") or h.get("url") or "") for h in hits)
    raw = f"{query.strip().lower()}::{doc_ids}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _evict_if_full() -> None:
    if len(_CACHE) <= _CACHE_MAX:
        return
    # Drop the oldest 10% so we don't churn on every insert past the cap.
    victims = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[: _CACHE_MAX // 10]
    for key, _ in victims:
        _CACHE.pop(key, None)


def _build_candidate_block(hits: list[dict]) -> str:
    lines: list[str] = []
    for i, h in enumerate(hits):
        title = (h.get("title") or "").strip()
        corpus = h.get("corpus") or ""
        snippet = (h.get("content") or "").strip().replace("\n", " ")
        if len(snippet) > 400:
            snippet = snippet[:400] + "…"
        lines.append(f"[{i}] ({corpus}) {title}\n    {snippet}")
    return "\n".join(lines)


def _parse_picks(raw: str, hit_count: int) -> list[dict]:
    text = raw.strip()
    if text.startswith("```"):
        # Tolerate accidental markdown fences from the model.
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    picks = parsed.get("picks") if isinstance(parsed, dict) else None
    if not isinstance(picks, list):
        return []
    out: list[dict] = []
    for p in picks:
        if not isinstance(p, dict):
            continue
        idx = p.get("i")
        if not isinstance(idx, int) or idx < 0 or idx >= hit_count:
            continue
        score_raw = p.get("score", 0.0)
        try:
            score = float(score_raw)
        except (TypeError, ValueError):
            score = 0.0
        out.append({"i": idx, "score": max(0.0, min(1.0, score)), "why": str(p.get("why", ""))[:120]})
    return out


async def rerank(query: str, hits: list[dict], top_k: int = 5) -> list[dict]:
    """Return up to ``top_k`` reranked hits, each enriched with
    ``rerank_score`` and ``rerank_reason``. Falls back to the input order
    (truncated) on any failure -- never raises.
    """
    if not hits:
        return []
    if not query.strip():
        return hits[:top_k]

    key = _cache_key(query, hits)
    cached = _CACHE.get(key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_S:
        return cached[1][:top_k]

    prompt = _RERANK_PROMPT.format(top_k=top_k)
    body = (
        f"USER QUERY:\n{query.strip()}\n\n"
        f"CANDIDATE PASSAGES:\n{_build_candidate_block(hits)}"
    )

    try:
        client = get_client()
        deployment = settings.azure_openai_deployment_chat
        resp = call_with_retry(
            lambda: client.chat.completions.create(
                model=deployment,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": body},
                ],
                temperature=0,
                max_completion_tokens=512,
                response_format={"type": "json_object"},
            ),
            model_name=deployment,
        )
        raw = resp.choices[0].message.content or ""
    except Exception as exc:
        log.warning("rag.rerank_failed", error=str(exc))
        return hits[:top_k]

    picks = _parse_picks(raw, len(hits))
    if not picks:
        log.info("rag.rerank_empty_picks", raw_preview=raw[:120])
        return hits[:top_k]

    # Re-sort by model score (desc); keep the model's intended order on ties.
    picks.sort(key=lambda p: p["score"], reverse=True)
    seen: set[int] = set()
    out: list[dict] = []
    for p in picks[:top_k]:
        if p["i"] in seen:
            continue
        seen.add(p["i"])
        hit = dict(hits[p["i"]])
        hit["rerank_score"] = p["score"]
        hit["rerank_reason"] = p["why"]
        out.append(hit)
    if not out:
        return hits[:top_k]
    _CACHE[key] = (time.time(), out)
    _evict_if_full()
    return out


def best_confidence(reranked: list[dict]) -> float:
    """Convenience: the top rerank_score, or 0.0 when absent."""
    if not reranked:
        return 0.0
    top = reranked[0]
    score = top.get("rerank_score")
    try:
        return float(score) if score is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


__all__ = ["best_confidence", "rerank"]
