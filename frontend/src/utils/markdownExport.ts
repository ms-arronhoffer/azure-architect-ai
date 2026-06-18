import type { BundledDesign, WorkloadSpec } from "../types";
import type { SavedDesign } from "./bundledDesignStore";

function specToMarkdownTable(spec: WorkloadSpec | null): string {
  if (!spec) return "_No workload spec recorded._";
  const rows: Array<[string, string | number | boolean]> = [
    ["Name", spec.name || "—"],
    ["Type", spec.type],
    ["Criticality", spec.criticality],
    ["Business Owner", spec.businessOwner || "—"],
    ["Peak Users", spec.peakUsers],
    ["Avg RPS", spec.avgRps],
    ["Data Volume (GB)", spec.dataVolumeGb],
    ["p99 Latency (ms)", spec.latencyP99Ms],
    ["Availability SLA", spec.availabilitySla],
    ["RTO (hours)", spec.rtoHours],
    ["RPO (hours)", spec.rpoHours],
    ["Multi-region", spec.multiRegion ? "Yes" : "No"],
    ["Primary Region", spec.primaryRegion || "—"],
    ["DR Region", spec.drRegion || "—"],
    ["Compliance", (spec.complianceFrameworks || []).join(", ") || "—"],
    ["Data Classification", spec.dataClassification],
    ["Identity Model", spec.identityModel],
    ["Network Isolation", spec.networkIsolation ? "Yes" : "No"],
    ["Monthly Budget (USD)", spec.monthlyBudgetUsd],
    ["Team Size", spec.teamSize || "—"],
    ["Cloud Maturity", spec.cloudMaturity],
    ["Existing Services", (spec.existingServices || []).join(", ") || "—"],
    ["Migration Timeline", spec.migrationTimeline || "—"],
  ];
  const filtered = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  const header = "| Field | Value |\n|---|---|";
  const body = filtered.map(([k, v]) => `| ${k} | ${String(v)} |`).join("\n");
  return `${header}\n${body}`;
}

export function bundleToMarkdown(saved: SavedDesign): string {
  return bundleAndSpecToMarkdown(saved.bundle, saved.spec_snapshot);
}

export function bundleAndSpecToMarkdown(
  bundle: BundledDesign,
  spec: WorkloadSpec | null
): string {
  const parts: string[] = [];
  parts.push(`# ${bundle.workload_name || "Workload"}`);
  parts.push(`_Generated: ${bundle.generated_at}_`);
  parts.push("");

  parts.push("## Workload Specification");
  parts.push(specToMarkdownTable(spec));
  parts.push("");

  parts.push("## Architecture");
  parts.push(bundle.architecture.text || "_No architecture text._");
  if (bundle.architecture.runbook) {
    parts.push("");
    parts.push("### Runbook");
    parts.push(bundle.architecture.runbook);
  }
  if (bundle.architecture.bicep) {
    parts.push("");
    parts.push("### Bicep");
    parts.push("```bicep");
    parts.push(bundle.architecture.bicep);
    parts.push("```");
  }
  parts.push("");

  parts.push("## Sizing");
  parts.push(bundle.sizing.text || "_No sizing text._");
  parts.push("");

  parts.push("## Security");
  parts.push(bundle.security.text || "_No security text._");
  parts.push("");

  parts.push("## Well-Architected Review");
  const pillars = bundle.waf?.pillars || [];
  if (pillars.length === 0) {
    parts.push("_No WAF pillar data._");
  } else {
    for (const p of pillars) {
      parts.push(`### ${p.pillar} — Score: ${p.score}`);
      if (p.findings && p.findings.length) {
        parts.push("**Findings:**");
        for (const f of p.findings) parts.push(`- ${f}`);
      }
      if (p.recommendations && p.recommendations.length) {
        parts.push("");
        parts.push("**Recommendations:**");
        for (const r of p.recommendations) {
          if (typeof r === "string") parts.push(`- ${r}`);
          else parts.push(r.learn_url ? `- ${r.text} ([Microsoft Docs](${r.learn_url}))` : `- ${r.text}`);
        }
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}
