# FinOps Tagging Standard (reference)

Cost allocation in Azure depends on consistent resource tagging. The FinOps
Foundation recommends a minimal, enforced tag set so every dollar of spend can
be attributed to a team and a cost center.

## Required tags and why they matter

- **CostCenter**: enables chargeback/showback. Without it, spend lands in an
  "unallocated" bucket and cannot be billed back to a business unit.
- **Environment**: separates production cost (which must be optimized
  carefully) from non-production cost (which is a candidate for auto-shutdown
  and aggressive rightsizing).
- **Owner**: gives the FinOps team a human to contact about anomalies, idle
  resources, and rightsizing opportunities.

## Enforcement

Use Azure Policy `Require a tag on resources` (and the `Inherit a tag from the
resource group` modify effect) to enforce these at scale. Tags applied at the
subscription or management-group level do **not** automatically flow to child
resources — inheritance must be configured explicitly.
