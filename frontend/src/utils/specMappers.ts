import type { WorkloadSpec } from "../types";

export interface StrategyFormInputs {
  workloadName: string;
  workloadType: string;
  description: string;
  businessDrivers: string[];
  successCriteria: string;
  timeline: string;
  maturity: string;
  constraints: string;
}

export interface ArchitectureFormState {
  requirements: string;
  constraints: string;
}

const WORKLOAD_TYPE_TO_STRATEGY_LABEL: Record<string, string> = {
  "web-app": "Cloud-Native Application",
  "microservices": "Cloud-Native Application",
  "data-pipeline": "Data Platform",
  "ml": "AI / ML Workload",
  "event-driven": "Cloud-Native Application",
  "other": "Other",
};

const MATURITY_TO_LABEL: Record<string, string> = {
  "greenfield": "Greenfield (new workload, no legacy)",
  "migrating": "Legacy Migration (moving from on-prem)",
  "modernizing": "Hybrid (split on-prem / cloud)",
  "optimizing": "Cloud-Optimizing (already in cloud, improving)",
};

export function formatSla(availability: string): string {
  if (!availability) return "99.9%";
  return availability.includes("%") ? availability : `${availability}%`;
}

function synthesizeDescription(spec: WorkloadSpec): string {
  const lines: string[] = [];
  if (spec.additionalNotes) lines.push(spec.additionalNotes);

  const profile: string[] = [];
  if (spec.criticality) profile.push(`Criticality: ${spec.criticality}`);
  if (spec.peakUsers) profile.push(`${spec.peakUsers.toLocaleString()} peak users`);
  if (spec.avgRps) profile.push(`${spec.avgRps} avg RPS`);
  if (spec.dataVolumeGb) profile.push(`${spec.dataVolumeGb} GB data`);
  if (spec.latencyP99Ms) profile.push(`P99 latency target ${spec.latencyP99Ms}ms`);
  if (spec.rtoHours || spec.rpoHours) profile.push(`RTO ${spec.rtoHours}h / RPO ${spec.rpoHours}h`);
  if (spec.dataClassification) profile.push(`Data classification: ${spec.dataClassification}`);
  if (profile.length) lines.push(profile.join(" • "));

  if (spec.businessOwner) lines.push(`Business owner: ${spec.businessOwner}`);
  if (spec.existingServices?.length) lines.push(`Existing Azure services: ${spec.existingServices.join(", ")}`);
  if (spec.integrations) lines.push(`Integrations: ${spec.integrations}`);
  if (spec.currentInfrastructure) lines.push(`Current infrastructure: ${spec.currentInfrastructure}`);
  if (spec.migrationTimeline) lines.push(`Migration timeline: ${spec.migrationTimeline}`);

  return lines.filter(Boolean).join("\n\n");
}

function synthesizeConstraints(spec: WorkloadSpec): string {
  const parts: string[] = [];
  if (spec.regulatoryNotes) parts.push(spec.regulatoryNotes);
  if (spec.complianceFrameworks?.length) parts.push(`Compliance frameworks: ${spec.complianceFrameworks.join(", ")}`);
  if (spec.primaryRegion) parts.push(`Primary region: ${spec.primaryRegion}${spec.multiRegion && spec.drRegion ? ` (DR: ${spec.drRegion})` : ""}`);
  if (spec.monthlyBudgetUsd) parts.push(`Monthly budget: $${spec.monthlyBudgetUsd.toLocaleString()}`);
  if (spec.networkIsolation) parts.push("Network isolation required (private endpoints, no public exposure)");
  if (spec.dataClassification && spec.dataClassification !== "public") parts.push(`Data classification: ${spec.dataClassification}`);
  return parts.filter(Boolean).join(". ");
}

export function specToStrategyInputs(spec: WorkloadSpec): Partial<StrategyFormInputs> {
  return {
    workloadName: spec.name,
    workloadType: WORKLOAD_TYPE_TO_STRATEGY_LABEL[spec.type] ?? "Cloud-Native Application",
    description: synthesizeDescription(spec),
    maturity: MATURITY_TO_LABEL[spec.cloudMaturity] ?? "",
    constraints: synthesizeConstraints(spec),
  };
}

export function specToArchitectureForm(spec: WorkloadSpec): ArchitectureFormState {
  const reqLines: string[] = [];
  if (spec.name) reqLines.push(`Workload: ${spec.name} (${spec.type})`);
  if (spec.criticality) reqLines.push(`Criticality: ${spec.criticality}`);
  if (spec.peakUsers || spec.avgRps) {
    const scale: string[] = [];
    if (spec.peakUsers) scale.push(`${spec.peakUsers.toLocaleString()} peak users`);
    if (spec.avgRps) scale.push(`${spec.avgRps} avg RPS`);
    reqLines.push(`Scale: ${scale.join(", ")}`);
  }
  if (spec.dataVolumeGb) reqLines.push(`Data volume: ${spec.dataVolumeGb} GB`);
  if (spec.latencyP99Ms) reqLines.push(`Target P99 latency: ${spec.latencyP99Ms}ms`);
  if (spec.availabilitySla) reqLines.push(`Availability SLA: ${formatSla(spec.availabilitySla)}`);
  if (spec.rtoHours || spec.rpoHours) reqLines.push(`RTO ${spec.rtoHours}h / RPO ${spec.rpoHours}h`);
  if (spec.identityModel) reqLines.push(`Identity model: ${spec.identityModel}`);
  if (spec.existingServices?.length) reqLines.push(`Existing services: ${spec.existingServices.join(", ")}`);
  if (spec.integrations) reqLines.push(`Integrations: ${spec.integrations}`);
  if (spec.additionalNotes) reqLines.push(`\n${spec.additionalNotes}`);

  return {
    requirements: reqLines.filter(Boolean).join("\n"),
    constraints: synthesizeConstraints(spec),
  };
}
