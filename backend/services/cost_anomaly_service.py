"""Cost anomaly detection + budget alert design.

Emits Bicep snippets for Microsoft.Consumption/budgets and supplies KQL for
2-sigma daily-spend anomaly detection. `fetch_current_spend` reads live MTD
spend via Cost Management; wrapped to return `{error: str}` on auth failures.
"""
from __future__ import annotations

from datetime import UTC, datetime

from middleware.logging import get_logger

log = get_logger("cost_anomaly_service")


def design_budget_alerts(
    subscription_id: str,
    monthly_budget: float,
    alert_thresholds: list[int] | None = None,
) -> dict:
    """Return a Bicep snippet for a subscription-scoped budget + action group.

    thresholds are percentages of the budget; 50/80/100/110 by default.
    """
    thresholds = alert_thresholds or [50, 80, 100, 110]
    start = datetime.now(UTC).strftime("%Y-%m-01")

    notification_blocks = "\n".join(
        f"""    Actual_GreaterThan_{t}_Percent: {{
      enabled: true
      operator: 'GreaterThan'
      threshold: {t}
      contactEmails: contactEmails
      contactRoles: ['Owner', 'Contributor']
      thresholdType: 'Actual'
      contactGroups: [actionGroup.id]
    }}"""
        for t in thresholds
    )

    bicep = f"""targetScope = 'subscription'

@description('Monthly budget amount in USD')
param monthlyBudget int = {int(monthly_budget)}

@description('Emails to notify on threshold breach')
param contactEmails array = ['finops@example.com']

@description('Budget start date (first of month, UTC)')
param startDate string = '{start}'

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {{
  name: 'ag-budget-alerts'
  location: 'global'
  properties: {{
    groupShortName: 'budgetAG'
    enabled: true
    emailReceivers: [for email in contactEmails: {{
      name: 'email-${{uniqueString(email)}}'
      emailAddress: email
      useCommonAlertSchema: true
    }}]
  }}
}}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {{
  name: 'budget-{subscription_id[:8]}-monthly'
  properties: {{
    timePeriod: {{
      startDate: startDate
    }}
    timeGrain: 'Monthly'
    amount: monthlyBudget
    category: 'Cost'
    notifications: {{
{notification_blocks}
    }}
  }}
}}

output budgetId string = budget.id
output actionGroupId string = actionGroup.id
"""
    return {
        "subscription_id": subscription_id,
        "monthly_budget_usd": monthly_budget,
        "thresholds": thresholds,
        "bicep": bicep,
        "resources": [
            "Microsoft.Consumption/budgets",
            "Microsoft.Insights/actionGroups",
        ],
        "deploy_command": (
            f"az deployment sub create --location eastus2 "
            f"--template-file budget.bicep --parameters monthlyBudget={int(monthly_budget)}"
        ),
    }


def generate_anomaly_kql() -> str:
    """KQL query that flags services with daily cost > 2 stddev above 30-day mean.

    Designed to run against Cost Management exports landed in a Log Analytics
    workspace (table `AzureCostExports_CL`) or `AzureDiagnostics` if available.
    """
    return """// Cost anomaly detection: services whose daily cost exceeds mean + 2*stddev over last 30 days.
// Assumes Cost Management exports landing in Log Analytics as AzureCostExports_CL.
let lookback = 30d;
let baseline =
    AzureCostExports_CL
    | where TimeGenerated > ago(lookback)
    | summarize daily = sum(CostInBillingCurrency_d) by ServiceName_s, bin(TimeGenerated, 1d)
    | summarize mean_cost = avg(daily), std_cost = stdev(daily), samples = count() by ServiceName_s
    | where samples >= 7;
AzureCostExports_CL
| where TimeGenerated > ago(2d)
| summarize todays_cost = sum(CostInBillingCurrency_d) by ServiceName_s, bin(TimeGenerated, 1d)
| join kind=inner baseline on ServiceName_s
| extend z_score = (todays_cost - mean_cost) / iif(std_cost == 0, 1.0, std_cost)
| where z_score > 2.0 and todays_cost > 5.0
| project TimeGenerated, ServiceName_s, todays_cost, mean_cost, std_cost, z_score
| order by z_score desc
"""


def fetch_current_spend(subscription_id: str) -> dict:
    """Live MTD spend by service via Cost Management `query` API.

    Returns `{total_usd, by_service}` on success or `{error}` on failure.
    """
    try:
        from azure.identity import DefaultAzureCredential
        from azure.mgmt.costmanagement import CostManagementClient
        from azure.mgmt.costmanagement.models import (
            QueryAggregation,
            QueryDataset,
            QueryDefinition,
            QueryGrouping,
            QueryTimePeriod,
            TimeframeType,
        )
    except ImportError as exc:
        return {"error": f"azure-mgmt-costmanagement not installed: {exc}"}

    try:
        cred = DefaultAzureCredential()
        client = CostManagementClient(cred)
        scope = f"/subscriptions/{subscription_id}"
        now = datetime.now(UTC)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        query = QueryDefinition(
            type="Usage",
            timeframe=TimeframeType.CUSTOM,
            time_period=QueryTimePeriod(from_property=start, to=now),
            dataset=QueryDataset(
                granularity="None",
                aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
                grouping=[QueryGrouping(type="Dimension", name="ServiceName")],
            ),
        )
        resp = client.query.usage(scope=scope, parameters=query)
        cols = [c.name for c in (resp.columns or [])]
        rows = resp.rows or []
        cost_idx = cols.index("Cost") if "Cost" in cols else 0
        svc_idx = cols.index("ServiceName") if "ServiceName" in cols else 1

        by_service: dict[str, float] = {}
        total = 0.0
        for row in rows:
            cost = float(row[cost_idx] or 0)
            svc = str(row[svc_idx]) if svc_idx < len(row) else "Unknown"
            by_service[svc] = by_service.get(svc, 0.0) + cost
            total += cost

        log.info("cost.mtd.fetched", subscription=subscription_id, total=total, services=len(by_service))
        return {
            "subscription_id": subscription_id,
            "period_start": start.isoformat(),
            "period_end": now.isoformat(),
            "total_usd": round(total, 2),
            "by_service": {k: round(v, 2) for k, v in by_service.items()},
        }
    except Exception as exc:
        log.warning("cost.mtd.failed", error=str(exc))
        return {"error": f"Cost Management query failed: {exc}"}


__all__ = ["design_budget_alerts", "fetch_current_spend", "generate_anomaly_kql"]
