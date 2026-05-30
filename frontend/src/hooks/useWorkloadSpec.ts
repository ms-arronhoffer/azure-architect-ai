import { useCallback, useState } from "react";
import type { WorkloadSpec } from "../types";

const STORAGE_KEY = "azure_workload_spec";

const DEFAULT_SPEC: WorkloadSpec = {
  name: "",
  type: "web-app",
  criticality: "standard",
  businessOwner: "",
  peakUsers: 0,
  avgRps: 0,
  dataVolumeGb: 0,
  latencyP99Ms: 500,
  availabilitySla: "99.9",
  rtoHours: 4,
  rpoHours: 1,
  multiRegion: false,
  primaryRegion: "",
  drRegion: "",
  complianceFrameworks: [],
  dataClassification: "internal",
  identityModel: "workforce",
  networkIsolation: false,
  monthlyBudgetUsd: 0,
  teamSize: "",
  cloudMaturity: "greenfield",
  currentInfrastructure: "",
  existingServices: [],
  integrations: "",
  migrationTimeline: "",
  regulatoryNotes: "",
  additionalNotes: "",
};

function load(): WorkloadSpec {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SPEC, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SPEC };
}

export function useWorkloadSpec() {
  const [spec, setSpecState] = useState<WorkloadSpec>(load);

  const setSpec = useCallback((updates: Partial<WorkloadSpec>) => {
    setSpecState((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSpecState({ ...DEFAULT_SPEC });
  }, []);

  return { spec, setSpec, reset };
}

export function toSpecPromptPrefix(spec: WorkloadSpec): string {
  if (!spec.name) return "";
  const lines: string[] = [
    `## Workload Context`,
    `**Name:** ${spec.name}`,
    `**Type:** ${spec.type} | **Criticality:** ${spec.criticality}`,
    `**Region:** ${spec.primaryRegion}${spec.multiRegion && spec.drRegion ? ` (DR: ${spec.drRegion})` : ""}`,
    `**Scale:** ${spec.peakUsers.toLocaleString()} peak users, ${spec.avgRps} avg RPS, ${spec.dataVolumeGb} GB data`,
    `**Reliability:** ${spec.availabilitySla}% SLA, RTO ${spec.rtoHours}h, RPO ${spec.rpoHours}h`,
    `**Compliance:** ${spec.complianceFrameworks.length ? spec.complianceFrameworks.join(", ") : "None specified"}`,
    `**Data classification:** ${spec.dataClassification}`,
    `**Budget:** $${spec.monthlyBudgetUsd.toLocaleString()}/month`,
    `**Team:** ${spec.teamSize} | **Maturity:** ${spec.cloudMaturity}`,
  ];
  if (spec.additionalNotes) lines.push(`**Notes:** ${spec.additionalNotes}`);
  lines.push("");
  return lines.join("\n");
}
