import type { WafPillarResult, BicepPreview } from "../types";

const STORAGE_KEY = "azure_pipeline_state";

export type PipelinePhase = "architecture" | "sizing" | "security" | "waf";

export interface PipelineRequestShape {
  requirements: string;
  constraints?: string;
  region?: string;
  compliance?: string[];
  budget_usd?: number;
}

export interface PipelinePhaseArtifacts {
  runbook?: string;
  bicep?: string;
  bicep_preview?: BicepPreview;
  waf_pillars?: WafPillarResult[];
}

export interface PipelineState {
  request_hash: string;
  started_at: string;
  completed_phases: PipelinePhase[];
  phase_texts: Partial<Record<PipelinePhase, string>>;
  phase_artifacts: Partial<Record<PipelinePhase, PipelinePhaseArtifacts>>;
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function hashRequest(req: PipelineRequestShape): string {
  const normalized = JSON.stringify({
    requirements: (req.requirements || "").trim(),
    constraints: (req.constraints || "").trim(),
    region: (req.region || "").trim(),
    compliance: [...(req.compliance || [])].sort(),
    budget_usd: req.budget_usd || 0,
  });
  return djb2(normalized);
}

export function loadState(): PipelineState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.request_hash !== "string") return null;
    if (!Array.isArray(parsed.completed_phases)) return null;
    return parsed as PipelineState;
  } catch {
    return null;
  }
}

export function saveState(state: PipelineState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / serialization errors
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function newState(requestHash: string): PipelineState {
  return {
    request_hash: requestHash,
    started_at: new Date().toISOString(),
    completed_phases: [],
    phase_texts: {},
    phase_artifacts: {},
  };
}
