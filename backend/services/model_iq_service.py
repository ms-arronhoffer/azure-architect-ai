"""Port of model-iq scoring.ts + calculator.ts logic."""

import json
import math
import re
import time
from collections import defaultdict
from datetime import date, datetime
from functools import lru_cache
from html.parser import HTMLParser
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


# ── live model catalog (Microsoft Learn, daily refresh) ───────────────────────

_LEARN_URL = (
    "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/"
    "models-sold-directly-by-azure?tabs=global-standard&pivots=azure-openai"
)
_live_cache: dict = {"models": [], "fetched_at": 0.0}
_LIVE_TTL = 86400.0


class _ModelIdTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_table = False
        self._col_idx = 0
        self._model_col: int | None = None
        self._header_done = False
        self._buf = ""
        self._capture = False
        self.models: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "table":
            self._in_table = True
            self._model_col = None
            self._header_done = False
        elif tag == "tr":
            self._col_idx = 0
        elif tag in ("th", "td") and self._in_table:
            self._buf = ""
            self._capture = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "table":
            self._in_table = False
        elif tag == "th" and self._capture:
            self._capture = False
            if "model id" in self._buf.lower():
                self._model_col = self._col_idx
            self._col_idx += 1
        elif tag == "tr" and self._in_table and not self._header_done and self._model_col is not None:
            self._header_done = True
        elif tag == "td" and self._capture:
            self._capture = False
            if self._header_done and self._col_idx == self._model_col:
                mid = _clean_model_id(self._buf)
                if mid:
                    self.models.append(mid)
            self._col_idx += 1

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buf += data


def _clean_model_id(raw: str) -> str:
    clean = re.sub(r'\([^)]*\)', '', raw)
    clean = re.sub(r'\bpreview\b', '', clean, flags=re.IGNORECASE).strip()
    token = clean.split()[0] if clean.split() else ""
    if token and re.match(r'^[a-z][a-z0-9._-]{1,40}$', token):
        return token
    return ""


def _fetch_live_models() -> list[str]:
    try:
        import httpx
        resp = httpx.get(_LEARN_URL, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        parser = _ModelIdTableParser()
        parser.feed(resp.text)
        return sorted(set(parser.models))
    except Exception:
        return []


def get_live_models() -> list[str]:
    global _live_cache
    now = time.time()
    if not _live_cache["models"] or now - _live_cache["fetched_at"] > _LIVE_TTL:
        fresh = _fetch_live_models()
        if fresh:
            _live_cache = {"models": fresh, "fetched_at": now}
    return _live_cache["models"]


# ── retirement report analyzer ────────────────────────────────────────────────

_URGENCY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "unknown": 0}
_RANK_TO_URGENCY = {v: k for k, v in _URGENCY_RANK.items()}
_TIER_LABELS = {
    4: "4-Very High (>2.5M/wk)", 3: "3-High (500k-2.5M/wk)",
    2: "2-Medium (75k-500k/wk)", 1: "1-Low (<75k/wk)", 0: "Unknown",
}

_REPORT_COLS = [
    "region", "accountability_unit", "segment", "tpid", "tp_name",
    "subscription_id", "subscription_name", "deployment_region",
    "offering_name", "model", "version", "upgrade_option", "retirement_date",
    "unified", "tokens_w3", "tokens_w2", "tokens_w1", "csam",
]


def _token_tier_score(s: str) -> int:
    d = s.strip()[:1]
    return int(d) if d and d in "1234" else 0


def _parse_report_date(s: str) -> date | None:
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%-m/%-d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _urgency(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days < 0:
        return "critical"
    if days <= 30:
        return "high"
    if days <= 90:
        return "medium"
    return "low"


def _migration_rec(
    model_name: str,
    days: int | None,
    urgency: str,
    peak_score: int,
    upgrade_option: str,
    migration_options: list[dict],
) -> str:
    parts: list[str] = []

    if urgency == "critical":
        parts.append(f"CRITICAL — {model_name} has passed its retirement date. Immediate action required.")
    elif urgency == "high":
        parts.append(f"URGENT — {model_name} retires in {days} day(s). Begin migration now.")
    elif urgency == "medium":
        parts.append(f"ACTION NEEDED — {model_name} retires in {days} days. Schedule migration this sprint.")
    else:
        parts.append(f"Plan migration for {model_name} (retires in {days or '?'} days).")

    usage_desc = {
        4: "very high (>2.5M tokens/wk)", 3: "high (500k-2.5M/wk)",
        2: "medium (75k-500k/wk)", 1: "low (<75k/wk)", 0: "unknown",
    }
    parts.append(f"Usage: {usage_desc.get(peak_score, 'unknown')} — validate target capacity before cutover.")

    if upgrade_option == "NoAutoUpgrade":
        parts.append("Manual upgrade required (NoAutoUpgrade) — customer must update the deployment explicitly.")
    elif upgrade_option == "OnceCurrentVersionExpired":
        parts.append("Auto-upgrades at version expiry — test new default version proactively to avoid regression.")
    elif upgrade_option == "OnceNewDefaultVersionAvailable":
        parts.append("Auto-upgrades when new default is available — validate compatibility now.")

    if migration_options:
        best = migration_options[0]
        parts.append(
            f"Top migration candidate: {best['model']} "
            f"(score {best['score']}/100, {best.get('risk_level', '?')} risk; "
            f"quality {best.get('quality_score', 'N/A')}, "
            f"cost delta {best.get('cost_delta_pct', 'N/A')}%, "
            f"prompt effort {best.get('prompt_change_effort', 'N/A')})."
        )
        if len(migration_options) > 1:
            parts.append(f"Alternatives: {', '.join(m['model'] for m in migration_options[1:])}.")
    else:
        normalized = model_name.removesuffix("-chat")
        parts.append(
            f"No pre-scored candidates found for '{normalized}' in advisor data — "
            "review benchmark data and evaluate manually."
        )

    return " ".join(parts)


def analyze_retirement_report(tsv_text: str) -> dict:
    """Parse a tab- or comma-separated Azure OpenAI retirement report and produce
    prioritized migration recommendations using migration advisor scoring data."""
    import csv
    import io

    today = date.today()

    # ── Auto-detect delimiter and parse rows ───────────────────────────────────
    text = tsv_text.strip()
    first_line = text.splitlines()[0] if text else ""
    delimiter = "\t" if "\t" in first_line else ","

    raw_rows: list[dict] = []
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    for parts in reader:
        if len(parts) < 3:
            continue
        padded = parts + [""] * max(0, len(_REPORT_COLS) - len(parts))
        raw_rows.append(dict(zip(_REPORT_COLS, padded[: len(_REPORT_COLS)], strict=False)))

    # Detect and skip header row
    if raw_rows and raw_rows[0].get("tpid", "").strip().upper() == "TPID":
        raw_rows = raw_rows[1:]

    # ── Group by (tpid, subscription_id, model, version) → collect regions ────
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in raw_rows:
        key = (
            row["tpid"].strip(),
            row["subscription_id"].strip(),
            row["model"].strip(),
            row["version"].strip(),
        )
        groups[key].append(row)

    # ── Build per-customer deployment records ──────────────────────────────────
    customer_map: dict[str, dict] = {}

    for (tpid, sub_id, model_name, version), grp in groups.items():
        r0 = grp[0]
        ret_d = _parse_report_date(r0["retirement_date"])
        days = None if ret_d is None else (ret_d - today).days
        urg = _urgency(days)

        peak_score = max(
            (_token_tier_score(r[col]) for r in grp for col in ("tokens_w3", "tokens_w2", "tokens_w1")),
            default=0,
        )
        regions = sorted({r["deployment_region"].strip() for r in grp if r["deployment_region"].strip()})
        upgrade_opt = r0["upgrade_option"].strip()
        normalized = model_name.removesuffix("-chat")
        migrations = rank_replacements(normalized)[:3]

        deployment = {
            "subscription_id": sub_id,
            "subscription_name": r0["subscription_name"].strip(),
            "model": model_name,
            "normalized_model": normalized,
            "version": version,
            "retirement_date": r0["retirement_date"].strip(),
            "days_until_retirement": days,
            "urgency": urg,
            "peak_usage": _TIER_LABELS[peak_score],
            "peak_usage_score": peak_score,
            "upgrade_option": upgrade_opt,
            "unified": r0["unified"].strip(),
            "regions": regions,
            "region_count": len(regions),
            "migration_options": migrations,
            "recommendation": _migration_rec(
                model_name=model_name,
                days=days,
                urgency=urg,
                peak_score=peak_score,
                upgrade_option=upgrade_opt,
                migration_options=migrations,
            ),
        }

        if tpid not in customer_map:
            customer_map[tpid] = {
                "tpid": tpid,
                "tp_name": r0["tp_name"].strip(),
                "csam": r0["csam"].strip(),
                "deployments": [],
            }
        customer_map[tpid]["deployments"].append(deployment)

    for c in customer_map.values():
        max_rank = max(_URGENCY_RANK.get(d["urgency"], 0) for d in c["deployments"])
        c["priority"] = _RANK_TO_URGENCY.get(max_rank, "unknown")
        c["deployments"].sort(key=lambda d: (-_URGENCY_RANK.get(d["urgency"], 0), -d["peak_usage_score"]))

    customers = sorted(
        customer_map.values(),
        key=lambda c: (-_URGENCY_RANK.get(c["priority"], 0), c["tp_name"]),
    )

    # ── Model-level summary ────────────────────────────────────────────────────
    model_seen: dict[str, dict] = {}
    for row in raw_rows:
        m = row["model"].strip()
        if not m:
            continue
        if m not in model_seen:
            ret_d = _parse_report_date(row["retirement_date"])
            days = None if ret_d is None else (ret_d - today).days
            normalized = m.removesuffix("-chat")
            model_seen[m] = {
                "model": m,
                "normalized_id": normalized,
                "retirement_date": row["retirement_date"].strip(),
                "days_until_retirement": days,
                "urgency": _urgency(days),
                "row_count": 0,
                "_tpids": set(),
                "migration_options": rank_replacements(normalized)[:3],
            }
        model_seen[m]["row_count"] += 1
        model_seen[m]["_tpids"].add(row["tpid"].strip())

    model_summary = []
    for mv in model_seen.values():
        mv["customer_count"] = len(mv.pop("_tpids"))
        model_summary.append(mv)
    model_summary.sort(
        key=lambda m: (-_URGENCY_RANK.get(m["urgency"], 0), m.get("days_until_retirement") or 9999)
    )

    # ── Executive summary ──────────────────────────────────────────────────────
    all_deps = [d for c in customers for d in c["deployments"]]
    urgency_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for d in all_deps:
        urgency_counts[d["urgency"]] = urgency_counts.get(d["urgency"], 0) + 1

    very_high_critical = [
        d for d in all_deps
        if d["urgency"] in ("critical", "high") and d["peak_usage_score"] >= 3
    ]

    return {
        "summary": {
            "analysis_date": today.isoformat(),
            "total_rows": len(raw_rows),
            "unique_customers": len(customers),
            "unique_models": len(model_seen),
            "unique_deployments": len(all_deps),
            "critical": urgency_counts["critical"],
            "high": urgency_counts["high"],
            "medium": urgency_counts["medium"],
            "low": urgency_counts["low"],
            "unknown": urgency_counts["unknown"],
            "high_usage_urgent": len(very_high_critical),
        },
        "customers": customers,
        "model_summary": model_summary,
    }


def analyze_retirement_reports(texts: list[str]) -> dict:
    """Analyze multiple retirement-report CSVs/TSVs and merge results.

    Customers from different files are merged by `tpid`; collisions on
    `(tpid, subscription_id, model, version)` keep the entry from the
    last file (last-write-wins, matches single-file behaviour where a
    duplicate row would also be merged into the same group).
    Model summary entries are merged by model name; counts are summed
    and the most-urgent retirement date wins.
    """
    if not texts:
        raise ValueError("analyze_retirement_reports requires at least one input")

    merged_customers: dict[str, dict] = {}
    merged_models: dict[str, dict] = {}
    total_rows = 0

    for tsv_text in texts:
        result = analyze_retirement_report(tsv_text)
        total_rows += int(result["summary"].get("total_rows", 0))

        for c in result.get("customers", []):
            existing = merged_customers.get(c["tpid"])
            if existing is None:
                merged_customers[c["tpid"]] = {
                    "tpid": c["tpid"],
                    "tp_name": c["tp_name"],
                    "csam": c.get("csam", ""),
                    "deployments": list(c.get("deployments", [])),
                }
            else:
                # Dedup deployments on (subscription_id, model, version)
                key_of = lambda d: (d.get("subscription_id", ""), d.get("model", ""), d.get("version", ""))
                by_key = {key_of(d): d for d in existing["deployments"]}
                for d in c.get("deployments", []):
                    by_key[key_of(d)] = d  # last write wins
                existing["deployments"] = list(by_key.values())

        for m in result.get("model_summary", []):
            mid = m["model"]
            existing_m = merged_models.get(mid)
            if existing_m is None:
                merged_models[mid] = dict(m)
            else:
                existing_m["row_count"] = existing_m.get("row_count", 0) + m.get("row_count", 0)
                existing_m["customer_count"] = existing_m.get("customer_count", 0) + m.get("customer_count", 0)
                # Prefer the most-urgent record's retirement date.
                cur_rank = _URGENCY_RANK.get(existing_m.get("urgency", "unknown"), 0)
                new_rank = _URGENCY_RANK.get(m.get("urgency", "unknown"), 0)
                if new_rank > cur_rank:
                    existing_m["urgency"] = m["urgency"]
                    existing_m["retirement_date"] = m.get("retirement_date", "")
                    existing_m["days_until_retirement"] = m.get("days_until_retirement")

    # Recompute per-customer priority and sort.
    for c in merged_customers.values():
        max_rank = max(
            (_URGENCY_RANK.get(d.get("urgency", "unknown"), 0) for d in c["deployments"]),
            default=0,
        )
        c["priority"] = _RANK_TO_URGENCY.get(max_rank, "unknown")
        c["deployments"].sort(
            key=lambda d: (
                -_URGENCY_RANK.get(d.get("urgency", "unknown"), 0),
                -d.get("peak_usage_score", 0),
            )
        )

    customers = sorted(
        merged_customers.values(),
        key=lambda c: (-_URGENCY_RANK.get(c["priority"], 0), c.get("tp_name", "")),
    )
    model_summary = sorted(
        merged_models.values(),
        key=lambda m: (
            -_URGENCY_RANK.get(m.get("urgency", "unknown"), 0),
            m.get("days_until_retirement") or 9999,
        ),
    )

    all_deps = [d for c in customers for d in c["deployments"]]
    urgency_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    for d in all_deps:
        urgency_counts[d.get("urgency", "unknown")] = (
            urgency_counts.get(d.get("urgency", "unknown"), 0) + 1
        )
    very_high_critical = [
        d for d in all_deps
        if d.get("urgency") in ("critical", "high") and d.get("peak_usage_score", 0) >= 3
    ]

    return {
        "summary": {
            "analysis_date": date.today().isoformat(),
            "files": len(texts),
            "total_rows": total_rows,
            "unique_customers": len(customers),
            "unique_models": len(model_summary),
            "unique_deployments": len(all_deps),
            "critical": urgency_counts["critical"],
            "high": urgency_counts["high"],
            "medium": urgency_counts["medium"],
            "low": urgency_counts["low"],
            "unknown": urgency_counts["unknown"],
            "high_usage_urgent": len(very_high_critical),
        },
        "customers": customers,
        "model_summary": model_summary,
    }
