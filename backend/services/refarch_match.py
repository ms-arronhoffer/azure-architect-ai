"""Reference architecture matching — pure keyword/tag overlap scoring.

Given a workload spec, score every entry in the merged ref-arch corpus and
return the top N candidates. No LLM call: cheap, deterministic, runs on
every Workload Analysis invocation as a seed-prompt enricher.

Score weights chosen so that:
  - explicit workload-type / pattern match dominates (it's the strongest signal)
  - service overlap is the next-strongest (the user knows what they want to use)
  - tag overlap is supporting evidence (less precise than services)
  - category match is a small bonus

A `Ranked` is `{arch, score, signals}` where signals is a dict of which
buckets contributed to the score — useful for the UI "matched on
X, Y, Z" chip and for debugging why a low match showed up.
"""
from __future__ import annotations

from typing import Any


def _tokens(value: Any) -> set[str]:
    """Lowercase token set extracted from a string / list / dict-of-strings."""
    if value is None:
        return set()
    if isinstance(value, str):
        return {t.strip().lower() for t in value.replace(",", " ").split() if t.strip()}
    if isinstance(value, (list, tuple, set)):
        out: set[str] = set()
        for item in value:
            out |= _tokens(item)
        return out
    if isinstance(value, dict):
        out = set()
        for v in value.values():
            out |= _tokens(v)
        return out
    return {str(value).lower()}


def _spec_signals(spec: dict) -> dict[str, set[str]]:
    """Extract the comparable buckets from a workload spec.

    `spec` is the loose dict the frontend builds in `useWorkloadSpec`. We try a
    handful of common keys and silently skip missing ones — the spec shape is
    not fully stable across the codebase.
    """
    return {
        "patterns": _tokens(spec.get("workload_type")) | _tokens(spec.get("patterns")),
        "services": _tokens(spec.get("services")) | _tokens(spec.get("azure_services")),
        "tags": (
            _tokens(spec.get("tags"))
            | _tokens(spec.get("compliance"))
            | _tokens(spec.get("data_classification"))
            | _tokens(spec.get("regions"))
            | _tokens(spec.get("industry"))
        ),
        "category": _tokens(spec.get("category")) | _tokens(spec.get("domain")),
        "freeform": _tokens(spec.get("description")) | _tokens(spec.get("summary")),
    }


def _arch_signals(arch: dict) -> dict[str, set[str]]:
    return {
        "patterns": _tokens(arch.get("patterns")),
        "services": _tokens(arch.get("services")),
        "tags": _tokens(arch.get("tags")),
        "category": _tokens(arch.get("category")),
        "title": _tokens(arch.get("title")) | _tokens(arch.get("summary")) | _tokens(arch.get("description")),
    }


_WEIGHTS = {
    "patterns": 4.0,
    "services": 2.0,
    "tags": 1.0,
    "category": 1.5,
    "freeform_title": 0.5,
}


def _score(spec_sig: dict[str, set[str]], arch_sig: dict[str, set[str]]) -> tuple[float, dict[str, list[str]]]:
    """Return (normalised_score 0-1, per-bucket hit lists)."""
    hits: dict[str, list[str]] = {}
    raw = 0.0
    max_possible = 0.0
    for bucket in ("patterns", "services", "tags", "category"):
        spec_set = spec_sig.get(bucket, set())
        arch_set = arch_sig.get(bucket, set())
        if not arch_set:
            continue
        # Max possible for this bucket = full arch coverage by the spec
        max_possible += _WEIGHTS[bucket] * len(arch_set)
        overlap = spec_set & arch_set
        if overlap:
            raw += _WEIGHTS[bucket] * len(overlap)
            hits[bucket] = sorted(overlap)
    # Freeform description vs arch title/summary — weak signal but useful for
    # one-paragraph intake where the spec has no structured fields yet.
    free = spec_sig.get("freeform", set())
    title = arch_sig.get("title", set())
    if free and title:
        overlap = free & title
        if overlap:
            raw += _WEIGHTS["freeform_title"] * len(overlap)
            hits["freeform"] = sorted(overlap)[:8]
        max_possible += _WEIGHTS["freeform_title"] * min(len(title), 8)
    if max_possible == 0:
        return 0.0, hits
    return min(1.0, raw / max_possible), hits


def match_spec(spec: dict, corpus: list[dict], top_n: int = 3) -> list[dict]:
    """Rank `corpus` against `spec`, return top N with score + signals."""
    spec_sig = _spec_signals(spec or {})
    ranked = []
    for arch in corpus:
        score, hits = _score(spec_sig, _arch_signals(arch))
        if score <= 0:
            continue
        ranked.append({"arch": arch, "score": round(score, 3), "signals": hits})
    ranked.sort(key=lambda r: r["score"], reverse=True)
    return ranked[:top_n]


__all__ = ["match_spec"]
