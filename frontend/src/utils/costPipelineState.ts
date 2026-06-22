import type { CostOptimization } from "../types";

const STORAGE_KEY = "azure_cost_pipeline_state";

export type CostPhase =
  | "estimate"
  | "live_price"
  | "carbon"
  | "reservations"
  | "rightsizing"
  | "break_even"
  | "recommendations"
  | "narration";

export interface CostPipelineRequestShape {
  items: Array<{ service: string; sku?: string; region?: string }>;
  region?: string;
}

export interface CostPhaseEvent {
  phase: CostPhase;
  type: "started" | "complete" | "skipped" | "failed";
  reason?: string;
  error?: string;
  extra?: Record<string, unknown>;
}

export interface CostPipelineState {
  request_hash: string;
  started_at: string;
  events: CostPhaseEvent[];
  result: CostOptimization | null;
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function hashCostRequest(req: CostPipelineRequestShape): string {
  const normalized = JSON.stringify({
    region: (req.region || "").trim(),
    items: (req.items || []).map((it) => ({
      service: (it.service || "").trim(),
      sku: (it.sku || "").trim(),
      region: (it.region || "").trim(),
    })),
  });
  return djb2(normalized);
}

export function loadCostState(): CostPipelineState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.request_hash !== "string") return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed as CostPipelineState;
  } catch {
    return null;
  }
}

export function saveCostState(state: CostPipelineState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearCostState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function newCostState(requestHash: string): CostPipelineState {
  return {
    request_hash: requestHash,
    started_at: new Date().toISOString(),
    events: [],
    result: null,
  };
}
