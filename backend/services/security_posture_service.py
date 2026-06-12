"""Live security posture: Azure Policy compliance + Defender recommendations.

Read-only; same DefaultAzureCredential path as the other scan services.
Compares an arch's expected security baseline against actuals to surface gaps.

Baselines per reference arch are pulled from a small inline map keyed by
`reference_arch.id`; expand as new patterns get hardening requirements.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC

from azure.identity import DefaultAzureCredential
from azure.mgmt.policyinsights import PolicyInsightsClient
from azure.mgmt.security import SecurityCenter

from config import settings
from data.reference_archs import REFERENCE_ARCHS
from middleware.logging import get_logger

log = get_logger("security_posture_service")

# reference_arch.id → list of policy display-name substrings expected to be assigned
_EXPECTED_POLICIES: dict[str, list[str]] = {
    "web-app-zone-redundant": [
        "Azure Web App should require TLS",
        "App Service apps should have authentication enabled",
        "Azure SQL Database should have Transparent Data Encryption",
    ],
    "microservices-aks": [
        "Kubernetes clusters should use only allowed",
        "Azure Policy Add-on for Kubernetes",
        "Container Registry should have anonymous pull disabled",
    ],
    "hub-spoke-enterprise": [
        "All Internet traffic should be routed via your deployed Azure Firewall",
        "Subnets should be associated with a Network Security Group",
        "DDoS Protection Standard should be enabled",
    ],
}

_credential: DefaultAzureCredential | None = None
_policy: PolicyInsightsClient | None = None
_security: SecurityCenter | None = None


def _creds() -> DefaultAzureCredential:
    global _credential
    if _credential is None:
        _credential = DefaultAzureCredential()
    return _credential


def _policy_client() -> PolicyInsightsClient:
    global _policy
    if _policy is None:
        _policy = PolicyInsightsClient(_creds())
    return _policy


def _security_client(subscription_id: str) -> SecurityCenter:
    # SecurityCenter is subscription-scoped; rebuild if sub changes.
    global _security
    if _security is None or _security._config.subscription_id != subscription_id:
        _security = SecurityCenter(_creds(), subscription_id, asc_location="centralus")
    return _security


def _resolve_subscription(subscription_id: str | None) -> str:
    sub = subscription_id or settings.azure_subscription_id
    if not sub:
        raise ValueError("subscription_id not provided and AZURE_SUBSCRIPTION_ID not configured")
    return sub


def list_policy_states(subscription_id: str | None = None) -> list[dict]:
    """All non-compliant policy states in the subscription."""
    sub = _resolve_subscription(subscription_id)
    client = _policy_client()
    results = client.policy_states.list_query_results_for_subscription(
        policy_states_resource="latest", subscription_id=sub
    )
    out: list[dict] = []
    for state in results:
        if state.compliance_state and state.compliance_state.lower() == "noncompliant":
            out.append({
                "policy_definition": state.policy_definition_name,
                "policy_assignment": state.policy_assignment_name,
                "resource_id": state.resource_id,
                "resource_type": state.resource_type,
                "compliance_state": state.compliance_state,
            })
    log.info("policy.noncompliant", subscription=sub, count=len(out))
    return out


_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def list_defender_recommendations(
    subscription_id: str | None = None,
    severity_min: str = "Low",
) -> list[dict]:
    """Active Defender for Cloud recommendations (assessments) in the sub.

    Filters by severity floor (Low | Medium | High | Critical).
    """
    sub = _resolve_subscription(subscription_id)
    min_rank = _SEVERITY_RANK.get(severity_min.lower(), 1)
    try:
        client = _security_client(sub)
        out: list[dict] = []
        for assessment in client.assessments.list(scope=f"/subscriptions/{sub}"):
            status = (assessment.status.code or "").lower() if assessment.status else ""
            if status != "unhealthy":
                continue
            sev = (assessment.metadata.severity if assessment.metadata else None) or "Low"
            if _SEVERITY_RANK.get(sev.lower(), 1) < min_rank:
                continue
            out.append({
                "id": assessment.id,
                "display_name": assessment.display_name,
                "severity": sev,
                "status": status,
                "resource": assessment.resource_details.id if assessment.resource_details else None,
            })
        log.info("defender.unhealthy", subscription=sub, count=len(out))
        return out
    except Exception as exc:
        log.warning("defender.list_failed", error=str(exc))
        return [{"error": f"Defender query failed: {exc}"}]


def list_policy_assignments(subscription_id: str | None = None) -> list[dict]:
    """All policy assignments in the subscription (with compliance state if available)."""
    sub = _resolve_subscription(subscription_id)
    try:
        try:
            from azure.mgmt.resource import PolicyClient  # type: ignore
        except ImportError:
            from azure.mgmt.resource.policy import PolicyClient  # type: ignore
        cred = _creds()
        client = PolicyClient(cred, sub)
        out: list[dict] = []
        compliance_by_assignment: dict[str, str] = {}
        try:
            states = _policy_client().policy_states.list_query_results_for_subscription(
                policy_states_resource="latest", subscription_id=sub
            )
            for s in states:
                if s.policy_assignment_id:
                    compliance_by_assignment.setdefault(
                        s.policy_assignment_id.lower(),
                        s.compliance_state or "Unknown",
                    )
        except Exception as exc:
            log.warning("policy.states.failed", error=str(exc))

        for a in client.policy_assignments.list():
            out.append({
                "id": a.id,
                "displayName": a.display_name or a.name,
                "policyDefinitionId": a.policy_definition_id,
                "enforcementMode": str(a.enforcement_mode) if a.enforcement_mode else "Default",
                "scope": a.scope,
                "complianceState": compliance_by_assignment.get((a.id or "").lower(), "Unknown"),
            })
        log.info("policy.assignments", subscription=sub, count=len(out))
        return out
    except Exception as exc:
        log.warning("policy.assignments.failed", error=str(exc))
        return [{"error": f"Policy assignments query failed: {exc}"}]


def list_sentinel_incidents(
    workspace_resource_id: str,
    lookback_hours: int = 24,
) -> list[dict]:
    """List Sentinel incidents in the given workspace from the last N hours."""
    try:
        from azure.mgmt.securityinsight import SecurityInsights
    except ImportError as exc:
        return [{"error": f"azure-mgmt-securityinsight not installed: {exc}"}]

    try:
        # workspace_resource_id form:
        # /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{ws}
        parts = workspace_resource_id.strip("/").split("/")
        sub = parts[1]
        rg = parts[3]
        ws = parts[-1]
        client = SecurityInsights(_creds(), sub)
        from datetime import datetime, timedelta
        cutoff = datetime.now(UTC) - timedelta(hours=lookback_hours)
        out: list[dict] = []
        for inc in client.incidents.list(resource_group_name=rg, workspace_name=ws):
            created = getattr(inc, "created_time_utc", None) or getattr(inc, "properties", None)
            if created and hasattr(created, "isoformat") and created < cutoff:
                continue
            out.append({
                "id": inc.id,
                "title": getattr(inc, "title", None),
                "severity": str(getattr(inc, "severity", "")),
                "status": str(getattr(inc, "status", "")),
                "createdTime": created.isoformat() if hasattr(created, "isoformat") else None,
            })
        log.info("sentinel.incidents", workspace=ws, count=len(out))
        return out
    except Exception as exc:
        log.warning("sentinel.incidents.failed", error=str(exc))
        return [{"error": f"Sentinel incidents query failed: {exc}"}]


def score_security_posture(subscription_id: str | None = None) -> dict:
    """Aggregate Defender + Policy into a single 0-100 score with top findings."""
    sub = _resolve_subscription(subscription_id)
    try:
        assignments = list_policy_assignments(sub)
        defender = list_defender_recommendations(sub, severity_min="Medium")

        # Score: prefer Defender secure score if available; else heuristic.
        score: float
        try:
            sc_client = _security_client(sub)
            secure_scores = list(sc_client.secure_scores.list())
            if secure_scores:
                # secure score percentage * 100
                ss = secure_scores[0]
                score = float(getattr(ss.score, "percentage", 0.0) or 0.0) * 100
            else:
                raise RuntimeError("no secure scores")
        except Exception:
            # Heuristic: policy compliance %.
            assigned = [a for a in assignments if "error" not in a]
            compliant = [a for a in assigned if a.get("complianceState", "").lower() == "compliant"]
            score = (len(compliant) / len(assigned) * 100) if assigned else 50.0

        sev_buckets: dict[str, int] = {}
        for d in defender:
            if "error" in d:
                continue
            sev = (d.get("severity") or "low").lower()
            sev_buckets[sev] = sev_buckets.get(sev, 0) + 1

        top = [d for d in defender if "error" not in d][:10]
        summary = (
            f"Security posture score: {score:.0f}/100. "
            f"{sev_buckets.get('high', 0) + sev_buckets.get('critical', 0)} high/critical Defender findings; "
            f"{len([a for a in assignments if 'error' not in a])} policy assignments active."
        )
        return {
            "subscription_id": sub,
            "score": round(score, 1),
            "summary": summary,
            "top_findings": top,
            "severity_breakdown": sev_buckets,
        }
    except Exception as exc:
        log.warning("posture.score.failed", error=str(exc))
        return {"error": f"Security posture scoring failed: {exc}"}


def _expected_policy_gap(
    arch_id: str, assigned_display_names: Iterable[str]
) -> list[str]:
    expected = _EXPECTED_POLICIES.get(arch_id, [])
    assigned = list(assigned_display_names)
    return [e for e in expected if not any(e.lower() in a.lower() for a in assigned)]


def scan_security_posture(
    reference_arch_id: str,
    subscription_id: str | None = None,
) -> dict:
    arch = next((a for a in REFERENCE_ARCHS if a["id"] == reference_arch_id), None)
    if arch is None:
        raise ValueError(f"unknown reference architecture: {reference_arch_id}")

    sub = _resolve_subscription(subscription_id)
    log.info("posture.start", subscription=sub, reference_arch=reference_arch_id)

    noncompliant = list_policy_states(sub)
    defender = list_defender_recommendations(sub)
    assigned_names = {n.get("policy_definition", "") for n in noncompliant}
    baseline_gap = _expected_policy_gap(reference_arch_id, assigned_names)

    by_severity: dict[str, int] = {}
    for d in defender:
        sev = (d.get("severity") or "unknown").lower()
        by_severity[sev] = by_severity.get(sev, 0) + 1

    return {
        "subscription_id": sub,
        "reference_arch": {"id": arch["id"], "title": arch["title"]},
        "summary": {
            "noncompliant_policies": len(noncompliant),
            "defender_recommendations": len(defender),
            "defender_by_severity": by_severity,
            "missing_baseline_policies": len(baseline_gap),
        },
        "findings": {
            "noncompliant_policies": noncompliant[:50],
            "defender_recommendations": defender[:50],
            "missing_baseline_policies": baseline_gap,
        },
    }


__all__ = [
    "list_defender_recommendations",
    "list_policy_assignments",
    "list_policy_states",
    "list_sentinel_incidents",
    "scan_security_posture",
    "score_security_posture",
]
