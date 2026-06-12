"""Cost governance service.

Three concerns:
  1. Read actual costs via Cost Management query (subscription scope, MTD).
  2. Emit a Bicep module for a Budget + Action Group at deploy time.
  3. Emit an anomaly-detection KQL query that runs in Log Analytics or
     Azure Monitor against the cost-export table.

Uses `DefaultAzureCredential` (same auth path as the scanner). Cost Management
SDK methods are synchronous; route handlers should call via `asyncio.to_thread`.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

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

from config import settings
from middleware.logging import get_logger

log = get_logger("cost_service")

_credential: DefaultAzureCredential | None = None
_client: CostManagementClient | None = None


def _get_client() -> CostManagementClient:
    global _credential, _client
    if _client is None:
        _credential = DefaultAzureCredential()
        _client = CostManagementClient(_credential)
    return _client


def _resolve_subscription(subscription_id: str | None) -> str:
    sub = subscription_id or settings.azure_subscription_id
    if not sub:
        raise ValueError("subscription_id not provided and AZURE_SUBSCRIPTION_ID not configured")
    return sub


def query_mtd_by_service(subscription_id: str | None = None) -> list[dict]:
    """Month-to-date cost grouped by ServiceName."""
    sub = _resolve_subscription(subscription_id)
    today = dt.datetime.now(dt.UTC)
    start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    definition = QueryDefinition(
        type="ActualCost",
        timeframe=TimeframeType.CUSTOM,
        time_period=QueryTimePeriod(from_property=start, to=today),
        dataset=QueryDataset(
            granularity="None",
            aggregation={"totalCost": QueryAggregation(name="Cost", function="Sum")},
            grouping=[QueryGrouping(type="Dimension", name="ServiceName")],
        ),
    )
    scope = f"/subscriptions/{sub}"
    resp = _get_client().query.usage(scope=scope, parameters=definition)
    cols = [c.name for c in (resp.columns or [])]
    rows = resp.rows or []
    out = []
    for row in rows:
        item: dict[str, Any] = dict(zip(cols, row, strict=False))
        out.append({
            "service": item.get("ServiceName") or item.get("servicename"),
            "cost": float(item.get("totalCost") or item.get("PreTaxCost") or 0.0),
            "currency": item.get("Currency") or item.get("currency"),
        })
    out.sort(key=lambda x: x["cost"], reverse=True)
    log.info("cost.mtd_query", subscription=sub, rows=len(out))
    return out


def emit_budget_bicep(
    budget_name: str,
    amount: float,
    contact_emails: list[str],
    thresholds: tuple[int, ...] = (50, 80, 100, 110),
) -> str:
    """Return Bicep source for a subscription-scope Budget + Action Group.

    Notifications fire at each threshold (percent of budget). Action Group
    delivers email to `contact_emails`; extend with webhook/SMS as needed.
    """
    ag_name = f"{budget_name}-ag"
    emails = "[\n" + ",\n".join(
        f"      {{ name: 'contact{i}', emailAddress: '{e}', useCommonAlertSchema: true }}"
        for i, e in enumerate(contact_emails)
    ) + "\n    ]"
    notifications_block = ",\n".join(
        f"""    Actual_GreaterThan_{t}_Percent: {{
      enabled: true
      operator: 'GreaterThan'
      threshold: {t}
      thresholdType: 'Actual'
      contactEmails: contactEmails
      contactGroups: [ actionGroup.id ]
    }}"""
        for t in thresholds
    )
    return f"""targetScope = 'subscription'

@description('Budget amount in subscription currency.')
param budgetAmount int = {int(amount)}

@description('Emails for budget breach notifications.')
param contactEmails array = {contact_emails!r}

@description('Start date for the budget period (YYYY-MM-01).')
param startDate string = utcNow('yyyy-MM-01')

resource actionGroup 'Microsoft.Insights/actionGroups@2023-09-01-preview' = {{
  name: '{ag_name}'
  location: 'global'
  properties: {{
    groupShortName: '{ag_name[:12]}'
    enabled: true
    emailReceivers: {emails}
  }}
}}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {{
  name: '{budget_name}'
  properties: {{
    timeGrain: 'Monthly'
    amount: budgetAmount
    category: 'Cost'
    timePeriod: {{
      startDate: startDate
    }}
    notifications: {{
{notifications_block}
    }}
  }}
}}

output budgetId string = budget.id
output actionGroupId string = actionGroup.id
"""


def anomaly_detection_kql(lookback_days: int = 30, sigma: float = 2.5) -> str:
    """KQL that flags services whose daily cost exceeds mean + sigma·stdev
    over the lookback window. Run against the cost-export Log Analytics table.
    """
    return f"""// Anomaly: daily service cost > mean + {sigma} * stdev over last {lookback_days} days
let lookback = {lookback_days}d;
let sigma = {sigma};
CostExport_CL
| where TimeGenerated > ago(lookback)
| summarize daily_cost = sum(CostInBillingCurrency_d)
    by bin(TimeGenerated, 1d), ServiceName_s, SubscriptionGuid_g
| summarize
    avg_cost = avg(daily_cost),
    stdev_cost = stdev(daily_cost),
    latest_cost = arg_max(TimeGenerated, daily_cost)
    by ServiceName_s, SubscriptionGuid_g
| extend threshold = avg_cost + sigma * stdev_cost
| where latest_cost > threshold and latest_cost > 5  // suppress noise below $5
| project SubscriptionGuid_g, ServiceName_s, latest_cost, avg_cost, threshold,
          delta_pct = round(100.0 * (latest_cost - avg_cost) / avg_cost, 1)
| order by delta_pct desc
"""


__all__ = [
    "anomaly_detection_kql",
    "emit_budget_bicep",
    "query_mtd_by_service",
]
