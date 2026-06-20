import type { DemoBuilt } from "../types";

const STORAGE_KEY = "azure_demo_pipeline_state";

export type DemoPhase =
  | "intake_normalize"
  | "recommendations"
  | "architecture_design"
  | "build"
  | "build.code"
  | "build.infra"
  | "build.docs"
  | "verify"
  | "publish";

export interface DemoPipelineRequestShape {
  demo_slug: string;
  demo_title: string;
  audience: string;
  duration_minutes: number;
  target_persona: string;
  key_features: string[];
  azure_services: string[];
}

export interface DemoPhaseEvent {
  phase: DemoPhase;
  type: "started" | "complete" | "skipped" | "failed";
  reason?: string;
  error?: string;
  extra?: Record<string, unknown>;
}

export interface DemoPipelineState {
  request_hash: string;
  started_at: string;
  events: DemoPhaseEvent[];
  result: DemoBuilt | null;
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function hashDemoRequest(req: DemoPipelineRequestShape): string {
  const normalized = JSON.stringify({
    demo_slug: (req.demo_slug || "").trim(),
    demo_title: (req.demo_title || "").trim(),
    audience: (req.audience || "").trim(),
    duration_minutes: req.duration_minutes,
    target_persona: (req.target_persona || "").trim(),
    key_features: [...(req.key_features || [])].sort(),
    azure_services: [...(req.azure_services || [])].sort(),
  });
  return djb2(normalized);
}

export function loadDemoState(): DemoPipelineState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.request_hash !== "string") return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed as DemoPipelineState;
  } catch {
    return null;
  }
}

export function saveDemoState(state: DemoPipelineState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearDemoState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function newDemoState(requestHash: string): DemoPipelineState {
  return {
    request_hash: requestHash,
    started_at: new Date().toISOString(),
    events: [],
    result: null,
  };
}
