"""Deterministic fuzzy resolver for Azure Retail price meters.

Given a (service, sku, region) hint and a list of candidate catalog rows for
that service+region, return the single most-likely meter **plus a confidence
score and the alternatives considered** — even when the input isn't an exact
match.

This is the heart of the pricing-accuracy fix. The old loose
``contains(tolower(skuName), '<sku>')`` filter silently collapsed misses onto
the cheapest meter (e.g. ``P1v4`` → ``Shared App`` $0.01/hr). Here we:

* normalise SKUs into token sets so compact ARM/diagram forms (``P1v4``,
  ``Standard_D2s_v3``) collide with the Retail display form (``P1 v4``,
  ``D2s v3``);
* score candidates exact > token-subset > fuzzy;
* apply guardrails so a high-tier hint never silently resolves onto a
  ``Shared`` / ``Free`` / ``Self Hosted Gateway`` / ``trial`` meter unless the
  hint explicitly asks for it;
* tie-break toward the cheapest row *within the already-matched SKU group*,
  never across SKUs.

The functions here are pure (no DB / no network) so they unit-test trivially;
``pricing_catalog`` wires them to the live catalog.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

# Default confidence floor below which callers should switch to honesty mode /
# clarification rather than quote a number. Overridable per call.
DEFAULT_CONFIDENCE_FLOOR = 0.45

# Meter / product terms that a hint must explicitly request before a candidate
# carrying them is allowed to win. Codifies the known traps: the cheapest
# "Shared App" meter, free tiers, the APIM "Self Hosted Gateway" meter, spot /
# low-priority compute, and trial SKUs.
_TRAP_TERMS: tuple[str, ...] = (
    "shared",
    "free",
    "self hosted gateway",
    "self-hosted gateway",
    "trial",
    "dev/test",
    "devtest",
    "spot",
    "low priority",
    "low-priority",
)

_SEP_RE = re.compile(r"[\s_\-/,]+")
# A compute/tier token glued to a trailing version, e.g. p1v4, d2sv3, p1mv3.
_VERSION_RE = re.compile(r"^([a-z]+\d+[a-z]*?)(v\d+)$")


def normalize_tokens(text: str) -> set[str]:
    """Lowercase + split into a token set, splitting glued version suffixes so
    ``P1v4`` and ``P1 v4`` both yield ``{"p1", "v4"}``."""
    if not text:
        return set()
    out: set[str] = set()
    for raw in _SEP_RE.split(text.lower().strip()):
        if not raw:
            continue
        m = _VERSION_RE.match(raw)
        if m:
            out.add(m.group(1))
            out.add(m.group(2))
        else:
            out.add(raw)
    return out


def search_key(text: str) -> str:
    """Stable normalised key (sorted token string) for indexing/dedup."""
    return " ".join(sorted(normalize_tokens(text)))


def _has_trap(*texts: str) -> bool:
    blob = " ".join(t.lower() for t in texts if t)
    return any(term in blob for term in _TRAP_TERMS)


def _hint_requests_trap(hint: str) -> bool:
    blob = (hint or "").lower()
    return any(term in blob for term in _TRAP_TERMS)


def _token_match(hint: set[str], cand: set[str]) -> float:
    """Score how well a hint token set matches a candidate token set (0..1)."""
    if not hint or not cand:
        return 0.0
    if hint == cand:
        return 1.0
    if hint <= cand:
        # All hint tokens present; reward tight coverage (fewer extra tokens).
        coverage = len(hint) / len(cand)
        return 0.7 + 0.25 * coverage
    inter = hint & cand
    if inter:
        jaccard = len(inter) / len(hint | cand)
        return 0.4 + 0.4 * jaccard
    ratio = SequenceMatcher(
        None, " ".join(sorted(hint)), " ".join(sorted(cand))
    ).ratio()
    return 0.5 * ratio


def score_candidate(sku_hint: str, meter_hint: str, row: dict[str, Any]) -> float:
    """Score one catalog row against the SKU/meter hint (0..1)."""
    hint_tokens = normalize_tokens(sku_hint) | normalize_tokens(meter_hint)

    sku_name = row.get("skuName") or ""
    arm_sku = row.get("armSkuName") or ""
    meter_name = row.get("meterName") or ""
    product_name = row.get("productName") or ""

    if not hint_tokens:
        # No SKU preference at all — neutral base; caller tie-breaks on price.
        base = 0.5
    else:
        base = max(
            _token_match(hint_tokens, normalize_tokens(sku_name)),
            0.95 * _token_match(hint_tokens, normalize_tokens(arm_sku)),
            0.9 * _token_match(hint_tokens, normalize_tokens(meter_name)),
        )

    # Guardrail: heavily penalise trap meters unless the hint asked for one.
    if _has_trap(sku_name, meter_name, product_name) and not _hint_requests_trap(
        f"{sku_hint} {meter_hint}"
    ):
        base *= 0.2

    return round(base, 4)


def resolve(
    sku_hint: str,
    rows: list[dict[str, Any]],
    *,
    meter_hint: str = "",
    confidence_floor: float = DEFAULT_CONFIDENCE_FLOOR,
    max_candidates: int = 5,
) -> dict[str, Any]:
    """Resolve the most-likely meter from already service+region-filtered rows.

    Returns ``{matched, confidence, candidates, unmatched_reason, low_confidence}``.
    ``matched`` is the best row (or ``None`` when ``rows`` is empty); callers
    inspect ``confidence`` / ``low_confidence`` to decide honesty mode.
    """
    if not rows:
        return {
            "matched": None,
            "confidence": 0.0,
            "candidates": [],
            "unmatched_reason": "no_catalog_rows",
            "low_confidence": True,
        }

    scored = [(score_candidate(sku_hint, meter_hint, r), r) for r in rows]
    # Highest score wins; tie-break toward the cheapest row within that group
    # (never across SKUs — the score already keyed on SKU identity).
    scored.sort(
        key=lambda sr: (-sr[0], _retail_price(sr[1]), sr[1].get("skuName") or "")
    )

    top_score, top_row = scored[0]
    candidates = [
        {**row, "_score": score} for score, row in scored[:max_candidates]
    ]
    low_confidence = top_score < confidence_floor

    return {
        "matched": top_row,
        "confidence": top_score,
        "candidates": candidates,
        "unmatched_reason": "low_confidence" if low_confidence else None,
        "low_confidence": low_confidence,
    }


def _retail_price(row: dict[str, Any]) -> float:
    try:
        return float(row.get("retailPrice") or 0.0)
    except (TypeError, ValueError):
        return float("inf")


def resolve_service_name(
    hint: str, known_services: list[str], service_map: dict[str, str] | None = None
) -> tuple[str, float]:
    """Map a service hint to a canonical ``serviceName`` from the catalog.

    Tries the explicit ``service_map`` first, then an exact (case-insensitive)
    match, then a fuzzy match against the catalog's distinct service names.
    Returns ``(resolved_name, confidence)``.
    """
    if not hint:
        return hint, 0.0
    h = hint.strip()
    if service_map:
        mapped = service_map.get(h.lower())
        if mapped:
            return mapped, 1.0
    lower_index = {s.lower(): s for s in known_services}
    if h.lower() in lower_index:
        return lower_index[h.lower()], 1.0

    hint_tokens = normalize_tokens(h)
    best_name, best_score = h, 0.0
    for svc in known_services:
        svc_tokens = normalize_tokens(svc)
        if hint_tokens and hint_tokens <= svc_tokens:
            score = 0.9
        else:
            score = SequenceMatcher(None, h.lower(), svc.lower()).ratio()
        if score > best_score:
            best_name, best_score = svc, score
    return best_name, round(best_score, 4)


__all__ = [
    "DEFAULT_CONFIDENCE_FLOOR",
    "normalize_tokens",
    "resolve",
    "resolve_service_name",
    "score_candidate",
    "search_key",
]
