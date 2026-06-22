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

export type DemoJobStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface DemoPipelineRequestShape {
  demo_slug: string;
  demo_title: string;
  description: string;
  audience: string;
  duration_minutes: number;
  target_persona: string;
  key_features: string[];
  azure_services: string[];
}

export interface DemoPhaseEvent {
  phase: DemoPhase;
  type: "started" | "complete" | "skipped" | "failed" | "progress";
  reason?: string;
  error?: string;
  degraded?: boolean;
  azureServices?: string[];
  filesAdded?: number;
  elapsedS?: number;
  extra?: Record<string, unknown>;
}

export interface DemoPipelineState {
  request_hash: string;
  started_at: string;
  job_id: string | null;
  status: DemoJobStatus;
  publish: boolean;
  azure_services: string[];
  request_shape: DemoPipelineRequestShape | null;
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
    description: (req.description || "").trim(),
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
    // Backfill fields added after the original schema so older persisted
    // states still load cleanly.
    return {
      request_hash: parsed.request_hash,
      started_at: parsed.started_at ?? new Date().toISOString(),
      job_id: typeof parsed.job_id === "string" ? parsed.job_id : null,
      status:
        typeof parsed.status === "string"
          ? parsed.status
          : parsed.result
            ? "done"
            : "idle",
      publish: Boolean(parsed.publish),
      azure_services: Array.isArray(parsed.azure_services) ? parsed.azure_services : [],
      request_shape: parsed.request_shape ?? null,
      events: parsed.events,
      result: parsed.result ?? null,
    } as DemoPipelineState;
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

export function newDemoState(
  requestHash: string,
  opts?: { jobId?: string; publish?: boolean; requestShape?: DemoPipelineRequestShape },
): DemoPipelineState {
  return {
    request_hash: requestHash,
    started_at: new Date().toISOString(),
    job_id: opts?.jobId ?? null,
    status: "running",
    publish: opts?.publish ?? false,
    azure_services: opts?.requestShape?.azure_services ?? [],
    request_shape: opts?.requestShape ?? null,
    events: [],
    result: null,
  };
}
