"""Port of model-iq scoring.ts + calculator.ts logic."""

import json
import math
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).parent.parent / "data" / "model_iq"


@lru_cache(maxsize=1)
def _load_models() -> list[dict]:
    return json.loads((_DATA / "models.json").read_text())


@lru_cache(maxsize=1)
def _load_evaluations() -> list[dict]:
    return json.loads((_DATA / "evaluations.json").read_text())


@lru_cache(maxsize=1)
def _load_benchmarks() -> list[dict]:
    return json.loads((_DATA / "benchmarks.json").read_text())


@lru_cache(maxsize=1)
def _load_retirements() -> dict:
    return json.loads((_DATA / "retirements.json").read_text())


# ── scoring ───────────────────────────────────────────────────────────────────

_RISK_WEIGHTS = {
    "qualityScore": 0.4,
    "driftPct": 0.2,
    "latencyDeltaPct": 0.15,
    "costDeltaPct": 0.1,
    "capacityStatus": 0.1,
    "promptChangeEffort": 0.05,
}

_CAPACITY_SCORES = {"GREEN": 1.0, "AMBER": 0.6, "RED": 0.2}
_EFFORT_SCORES = {"LOW": 1.0, "MED": 0.6, "HIGH": 0.2}


def _composite_score(ev: dict) -> float:
    quality = ev["qualityScore"] / 100.0
    drift = max(0.0, 1.0 - ev["driftPct"] / 20.0)
    latency = max(0.0, 1.0 - abs(ev["latencyDeltaPct"]) / 100.0) if ev["latencyDeltaPct"] < 0 else min(1.0, 1.0 - ev["latencyDeltaPct"] / 100.0)
    cost = max(0.0, 1.0 - abs(ev["costDeltaPct"]) / 200.0) if ev["costDeltaPct"] > 0 else min(1.0, 1.0 + ev["costDeltaPct"] / 100.0)
    capacity = _CAPACITY_SCORES.get(ev.get("capacityStatus", "GREEN"), 0.6)
    effort = _EFFORT_SCORES.get(ev.get("promptChangeEffort", "MED"), 0.6)

    score = (
        quality * _RISK_WEIGHTS["qualityScore"]
        + drift * _RISK_WEIGHTS["driftPct"]
        + latency * _RISK_WEIGHTS["latencyDeltaPct"]
        + cost * _RISK_WEIGHTS["costDeltaPct"]
        + capacity * _RISK_WEIGHTS["capacityStatus"]
        + effort * _RISK_WEIGHTS["promptChangeEffort"]
    )
    return round(score * 100, 1)


def _risk_level(score: float) -> str:
    if score >= 80:
        return "low"
    if score >= 60:
        return "medium"
    return "high"


def compute_feasibility(source_model: str, target_model: str) -> dict | None:
    evs = _load_evaluations()
    matches = [
        e for e in evs
        if e["sourceModelId"] == source_model and e["candidateModelId"] == target_model
    ]
    if not matches:
        return None
    ev = matches[-1]
    score = _composite_score(ev)
    return {
        "source": source_model,
        "target": target_model,
        "scenario": ev.get("scenarioId", ""),
        "score": score,
        "risk_level": _risk_level(score),
        "quality_score": ev["qualityScore"],
        "drift_pct": ev["driftPct"],
        "latency_delta_pct": ev["latencyDeltaPct"],
        "cost_delta_pct": ev["costDeltaPct"],
        "prompt_change_effort": ev.get("promptChangeEffort", "MED"),
        "capacity_status": ev.get("capacityStatus", "GREEN"),
    }


def rank_replacements(source_model: str) -> list[dict]:
    evs = _load_evaluations()
    candidates: dict[str, list[dict]] = {}
    for ev in evs:
        if ev["sourceModelId"] == source_model:
            mid = ev["candidateModelId"]
            candidates.setdefault(mid, []).append(ev)

    results = []
    for mid, evs_for_target in candidates.items():
        best = max(evs_for_target, key=lambda e: e["qualityScore"])
        score = _composite_score(best)
        results.append({
            "model": mid,
            "score": score,
            "risk_level": _risk_level(score),
            "quality_score": best["qualityScore"],
            "drift_pct": best["driftPct"],
            "latency_delta_pct": best["latencyDeltaPct"],
            "cost_delta_pct": best["costDeltaPct"],
            "prompt_change_effort": best.get("promptChangeEffort", "MED"),
            "capacity_status": best.get("capacityStatus", "GREEN"),
            "scenario": best.get("scenarioId", ""),
        })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results


def get_source_models() -> list[str]:
    evs = _load_evaluations()
    seen: set[str] = set()
    result = []
    for ev in evs:
        mid = ev["sourceModelId"]
        if mid not in seen:
            seen.add(mid)
            result.append(mid)
    return sorted(result)


def get_target_models(source_model: str) -> list[str]:
    evs = _load_evaluations()
    seen: set[str] = set()
    result = []
    for ev in evs:
        if ev["sourceModelId"] == source_model:
            mid = ev["candidateModelId"]
            if mid not in seen:
                seen.add(mid)
                result.append(mid)
    return sorted(result)


# ── PTU sizing (port of calculator.ts) ───────────────────────────────────────

_TPM_PER_PTU: dict[str, dict[str, int]] = {
    "gpt-4o": {"input": 2500, "output": 833},
    "gpt-4o-mini": {"input": 6100, "output": 4333},
    "gpt-4": {"input": 500, "output": 200},
    "gpt-35-turbo": {"input": 3000, "output": 2000},
    "gpt-4.1": {"input": 2500, "output": 833},
    "gpt-4.1-mini": {"input": 6100, "output": 4333},
    "gpt-4.1-nano": {"input": 12000, "output": 8000},
    "o1": {"input": 500, "output": 200},
    "o3-mini": {"input": 1100, "output": 333},
    "o4-mini": {"input": 1100, "output": 333},
    "gpt-5": {"input": 2500, "output": 833},
    "gpt-5-mini": {"input": 6100, "output": 4333},
}

_MIN_PTU: dict[str, int] = {
    "gpt-4o": 15, "gpt-4o-mini": 15, "gpt-4": 50, "gpt-35-turbo": 50,
    "gpt-4.1": 15, "gpt-4.1-mini": 15, "gpt-4.1-nano": 15,
    "o1": 50, "o3-mini": 50, "o4-mini": 50, "gpt-5": 15, "gpt-5-mini": 15,
}


def get_ptu_supported_models() -> list[str]:
    return list(_TPM_PER_PTU.keys())


def estimate_ptu(
    model: str,
    avg_input_tokens: int,
    avg_output_tokens: int,
    peak_rpm: int,
    hours_per_week: float = 168.0,
    ptu_monthly_price: float = 0.0,
    paygo_input_price: float | None = None,
    paygo_output_price: float | None = None,
) -> dict:
    rates = _TPM_PER_PTU.get(model)
    if not rates:
        raise ValueError(f"Unsupported model for PTU sizing: {model}. Supported: {', '.join(_TPM_PER_PTU)}")

    input_tpm = peak_rpm * avg_input_tokens
    output_tpm = peak_rpm * avg_output_tokens
    total_tpm = input_tpm + output_tpm

    total_tokens = avg_input_tokens + avg_output_tokens
    input_ratio = avg_input_tokens / total_tokens
    output_ratio = avg_output_tokens / total_tokens
    effective_tpm_per_ptu = 1 / (input_ratio / rates["input"] + output_ratio / rates["output"])

    raw_ptus = math.ceil(total_tpm / effective_tpm_per_ptu)
    min_ptu = _MIN_PTU.get(model, 50)
    recommended_ptus = max(raw_ptus, min_ptu)
    aligned_ptus = math.ceil(recommended_ptus / min_ptu) * min_ptu

    result: dict = {
        "model": model,
        "recommended_ptus": aligned_ptus,
        "minimum_ptus": min_ptu,
        "effective_tpm_per_ptu": round(effective_tpm_per_ptu),
        "total_tpm_needed": total_tpm,
        "input_tpm_needed": input_tpm,
        "output_tpm_needed": output_tpm,
    }

    # Cost comparison if prices provided
    if ptu_monthly_price > 0 and paygo_input_price is not None and paygo_output_price is not None:
        hours_per_month = hours_per_week * 4.33
        minutes_per_month = hours_per_month * 60
        requests_per_month = peak_rpm * minutes_per_month

        paygo_input_cost = (avg_input_tokens / 1000) * paygo_input_price * requests_per_month
        paygo_output_cost = (avg_output_tokens / 1000) * paygo_output_price * requests_per_month
        paygo_monthly = round(paygo_input_cost + paygo_output_cost, 2)

        ptu_monthly = round(ptu_monthly_price * aligned_ptus, 2)
        savings_pct = round(((paygo_monthly - ptu_monthly) / paygo_monthly * 100) if paygo_monthly > 0 else 0, 1)

        if savings_pct > 20:
            recommendation = "PTU recommended — significant savings over PAYGO."
        elif savings_pct > 0:
            recommendation = "PTU marginally cheaper — consider for guaranteed throughput."
        else:
            recommendation = "PAYGO recommended — PTU would cost more at this utilization."

        total_tpm_capacity = round(effective_tpm_per_ptu) * aligned_ptus
        max_rpm = total_tpm_capacity / total_tokens
        max_requests_per_month = max_rpm * 60 * 730
        paygo_at_100 = round(max_requests_per_month * (
            (avg_input_tokens / 1000) * paygo_input_price +
            (avg_output_tokens / 1000) * paygo_output_price
        ), 2)
        breakeven_pct = round((ptu_monthly / paygo_at_100 * 100) if paygo_at_100 > 0 else 100, 1)

        result["cost_comparison"] = {
            "paygo_monthly": paygo_monthly,
            "ptu_monthly": ptu_monthly,
            "savings_pct": savings_pct,
            "recommendation": recommendation,
            "breakeven_utilization_pct": breakeven_pct,
            "hours_per_week": hours_per_week,
            "hours_per_month": round(hours_per_month, 1),
            "requests_per_month": round(requests_per_month),
        }

    return result


# ── catalog helpers ───────────────────────────────────────────────────────────

def get_models() -> list[dict]:
    return _load_models()


def get_benchmarks() -> list[dict]:
    return _load_benchmarks()


def get_retirements() -> dict:
    return _load_retirements()
