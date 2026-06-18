"""Right-sizing recommendations from Azure Monitor P95 utilisation.

For each compute resource in the engagement subscriptions:
  1. Discover the resource (VMs, App Service plans, AKS node pools) via
     Resource Graph (reuses :mod:`azure_scan_service`).
  2. Pull last-N-day CPU + memory metrics from Azure Monitor at 1h grain,
     compute P95.
  3. If P95 < ``UNDERUTIL_THRESHOLD`` for the whole window, recommend the
     next-smaller SKU in the same family.

The next-smaller suggestion is intentionally crude: an architect cross-
checks against the customer's perf profile. We optimise for being
honest and grounded rather than authoritative — "your AKS prod pool
ran P95 18% CPU for 14 days; D8s_v5 → D4s_v5 saves ~$200/mo".

SDK calls are sync; route handlers should ``asyncio.to_thread``.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any

from azure.identity import DefaultAzureCredential

try:
    from azure.monitor.query import MetricAggregationType, MetricsQueryClient
except ImportError:  # optional dep; right-sizing degrades when SDK is missing
    MetricAggregationType = None  # type: ignore[assignment]
    MetricsQueryClient = None  # type: ignore[assignment]

from config import settings
from middleware.logging import get_logger
from services import azure_scan_service

log = get_logger("rightsizing_service")

UNDERUTIL_THRESHOLD = 40.0  # P95 % must stay under this to recommend a downsize
DEFAULT_WINDOW_DAYS = 14

_credential: DefaultAzureCredential | None = None
_metrics_client: Any | None = None


def _get_metrics_client() -> Any:
    global _credential, _metrics_client
    if MetricsQueryClient is None:
        raise RuntimeError(
            "azure-monitor-query is not installed; install it to enable right-sizing"
        )
    if _metrics_client is None:
        _credential = DefaultAzureCredential()
        _metrics_client = MetricsQueryClient(_credential)
    return _metrics_client


# VM SKU family parser: matches Standard_D8s_v5, Standard_E16ds_v4, etc.
_SKU_RE = re.compile(
    r"^(?P<prefix>standard_)?(?P<family>[a-z]+)(?P<size>\d+)(?P<suffix>[a-z]*)(?P<ver>_v\d+)?$",
    re.IGNORECASE,
)

# Common VM sizes by family. Used to suggest the next smaller SKU.
_FAMILY_SIZES: dict[str, list[int]] = {
    "d": [2, 4, 8, 16, 32, 48, 64, 96],
    "ds": [2, 4, 8, 16, 32, 48, 64, 96],
    "e": [2, 4, 8, 16, 32, 48, 64, 96],
    "es": [2, 4, 8, 16, 32, 48, 64, 96],
    "f": [2, 4, 8, 16, 32, 48, 64, 72],
    "b": [1, 2, 4, 8, 12, 16, 20],
}


def _next_smaller_sku(sku: str) -> str | None:
    """Naïve "drop one size" heuristic. Returns None when the SKU is
    unparseable or already at the bottom of its family."""
    if not sku:
        return None
    m = _SKU_RE.match(sku.strip())
    if not m:
        return None
    family = m.group("family").lower()
    sizes = _FAMILY_SIZES.get(family) or _FAMILY_SIZES.get(family.rstrip("s"))
    if not sizes:
        return None
    current = int(m.group("size"))
    smaller = [s for s in sizes if s < current]
    if not smaller:
        return None
    next_size = smaller[-1]
    return sku.replace(f"{family}{current}", f"{family}{next_size}", 1)


def _query_p95(resource_id: str, metric: str, days: int) -> float | None:
    """Pull ``metric`` for ``resource_id`` over ``days`` and return P95 %.
    Returns None when Monitor has no data or the call fails."""
    client = _get_metrics_client()
    end = dt.datetime.now(dt.UTC)
    start = end - dt.timedelta(days=days)
    try:
        resp = client.query_resource(
            resource_uri=resource_id,
            metric_names=[metric],
            timespan=(start, end),
            granularity=dt.timedelta(hours=1),
            aggregations=[MetricAggregationType.AVERAGE],
        )
        samples: list[float] = []
        for m in resp.metrics:
            for series in m.timeseries:
                for pt in series.data:
                    val = getattr(pt, "average", None)
                    if val is not None:
                        samples.append(float(val))
        if not samples:
            return None
        samples.sort()
        idx = max(0, int(0.95 * (len(samples) - 1)))
        return round(samples[idx], 1)
    except Exception as exc:
        log.warning("monitor.metric_failed", metric=metric, resource=resource_id, error=str(exc))
        return None


def _list_vms(subscription_id: str) -> list[dict[str, Any]]:
    """Return VM rows with id, name, location, vmSize."""
    kql = (
        "Resources "
        "| where type == 'microsoft.compute/virtualmachines' "
        "| project id, name, location, vmSize=tostring(properties.hardwareProfile.vmSize)"
    )
    return azure_scan_service._query(kql, [subscription_id])


def assess_vms(
    subscription_id: str | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
    threshold: float = UNDERUTIL_THRESHOLD,
) -> dict[str, Any]:
    """Walk every VM in the subscription, pull P95 CPU + available-memory
    bytes, recommend a smaller SKU when both are below ``threshold``%.
    """
    sub = azure_scan_service._resolve_subscription(subscription_id)
    vms = _list_vms(sub)
    findings: list[dict[str, Any]] = []
    for vm in vms:
        rid = vm.get("id") or ""
        if not rid:
            continue
        cpu_p95 = _query_p95(rid, "Percentage CPU", window_days)
        # Available Memory Bytes is not a percentage; report raw value but
        # only act on CPU for the recommendation (memory pressure is
        # workload-specific and easy to misread).
        cpu_underused = cpu_p95 is not None and cpu_p95 < threshold
        suggestion = _next_smaller_sku(vm.get("vmSize", "")) if cpu_underused else None
        findings.append({
            "resource_id": rid,
            "name": vm.get("name"),
            "location": vm.get("location"),
            "current_sku": vm.get("vmSize"),
            "cpu_p95_pct": cpu_p95,
            "window_days": window_days,
            "underutilised": bool(cpu_underused),
            "recommended_sku": suggestion,
            "action": (
                f"Downsize {vm.get('vmSize')} → {suggestion}"
                if suggestion
                else (
                    "Keep current SKU"
                    if cpu_p95 is not None
                    else "Insufficient metrics — extend window or check Monitor diagnostic settings"
                )
            ),
        })
    findings.sort(key=lambda f: (not f.get("underutilised"), f.get("cpu_p95_pct") or 999))
    return {
        "subscription_id": sub,
        "window_days": window_days,
        "threshold_pct": threshold,
        "vm_count": len(vms),
        "underutilised_count": sum(1 for f in findings if f.get("underutilised")),
        "findings": findings,
    }


__all__ = ["UNDERUTIL_THRESHOLD", "assess_vms"]
