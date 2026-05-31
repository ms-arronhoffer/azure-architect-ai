"""Live security posture: Azure Policy compliance + Defender recommendations.

Read-only; same DefaultAzureCredential path as the other scan services.
Compares an arch's expected security baseline against actuals to surface gaps.

Baselines per reference arch are pulled from a small inline map keyed by
`reference_arch.id`; expand as new patterns get hardening requirements.
"""
from __future__ import annotations

from typing import Iterable

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
    if _security is None or _security._config.subscription_id != subscription_id:  # noqa: SLF001
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


def list_defender_recommendations(subscription_id: str | None = None) -> list[dict]:
    """Active Defender for Cloud recommendations (assessments) in the sub."""
    sub = _resolve_subscription(subscription_id)
    client = _security_client(sub)
    out: list[dict] = []
    try:
        for assessment in client.assessments.list(scope=f"/subscriptions/{sub}"):
            status = (assessment.status.code or "").lower() if assessment.status else ""
            if status not in ("unhealthy", "notapplicable"):
                continue
            if status == "notapplicable":
                continue
            out.append({
                "id": assessment.id,
                "display_name": assessment.display_name,
                "severity": (assessment.metadata.severity if assessment.metadata else None),
                "status": status,
                "resource": assessment.resource_details.id if assessment.resource_details else None,
            })
    except Exception as exc:
        log.warning("defender.list_failed", error=str(exc))
        return []
    log.info("defender.unhealthy", subscription=sub, count=len(out))
    return out


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
    "list_policy_states",
    "scan_security_posture",
]
