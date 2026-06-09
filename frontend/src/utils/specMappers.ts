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

export interface BootstrapFormState {
  workloadName: string;
  workloadType: string;
  workloadDescription: string;
  usersPerDay: string;
  dataVolume: string;
  primaryRegion: string;
  drRegion: string;
  compliance: string;
  identity: string;
  networkIsolation: boolean;
  budget: string;
  sla: string;
  includeDr: boolean;
}

export interface ArchitectureFormState {
  requirements: string;
  constraints: string;
}

const WORKLOAD_TYPE_TO_LABEL: Record<string, string> = {
  "web-app": "Web App",
  "microservices": "Microservices",
  "data-pipeline": "Data Pipeline",
  "ml": "Machine Learning",
  "event-driven": "Event-Driven",
  "other": "Other",
};

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

const IDENTITY_TO_LABEL: Record<string, string> = {
  "workforce": "Entra ID (workforce)",
  "b2c": "Entra External ID (B2C)",
  "both": "Both",
  "service-to-service": "None",
};

export function bucketizeBudget(usd: number): string {
  if (!usd || usd <= 0) return "$5k–20k/mo";
  if (usd < 1000) return "< $1k/mo";
  if (usd < 5000) return "$1k–5k/mo";
  if (usd < 20000) return "$5k–20k/mo";
  if (usd < 100000) return "$20k–100k/mo";
  return "> $100k/mo";
}

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

export function specToBootstrapState(spec: WorkloadSpec): Partial<BootstrapFormState> {
  const usersPerDay = spec.peakUsers ? spec.peakUsers.toLocaleString() : "";
  const dataVolume = spec.dataVolumeGb ? `${spec.dataVolumeGb} GB` : "";

  const descriptionLines: string[] = [];
  if (spec.additionalNotes) descriptionLines.push(spec.additionalNotes);
  if (spec.businessOwner) descriptionLines.push(`Business owner: ${spec.businessOwner}`);
  if (spec.criticality) descriptionLines.push(`Criticality: ${spec.criticality}`);
  if (spec.latencyP99Ms) descriptionLines.push(`Target P99 latency: ${spec.latencyP99Ms}ms`);
  if (spec.rtoHours || spec.rpoHours) descriptionLines.push(`RTO ${spec.rtoHours}h / RPO ${spec.rpoHours}h`);
  if (spec.existingServices?.length) descriptionLines.push(`Existing services: ${spec.existingServices.join(", ")}`);
  if (spec.integrations) descriptionLines.push(`Integrations: ${spec.integrations}`);
  if (spec.migrationTimeline) descriptionLines.push(`Migration timeline: ${spec.migrationTimeline}`);
  if (spec.dataClassification) descriptionLines.push(`Data classification: ${spec.dataClassification}`);
  if (spec.currentInfrastructure) descriptionLines.push(`Current infrastructure: ${spec.currentInfrastructure}`);
  if (spec.regulatoryNotes) descriptionLines.push(`Regulatory notes: ${spec.regulatoryNotes}`);

  return {
    workloadName: spec.name,
    workloadType: WORKLOAD_TYPE_TO_LABEL[spec.type] ?? "Web App",
    workloadDescription: descriptionLines.filter(Boolean).join("\n\n"),
    usersPerDay,
    dataVolume,
    primaryRegion: spec.primaryRegion || "East US",
    drRegion: spec.drRegion || "",
    compliance: spec.complianceFrameworks?.[0] || "None",
    identity: IDENTITY_TO_LABEL[spec.identityModel] ?? "Entra ID (workforce)",
    networkIsolation: spec.networkIsolation,
    budget: bucketizeBudget(spec.monthlyBudgetUsd),
    sla: formatSla(spec.availabilitySla),
    includeDr: spec.multiRegion,
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
