import type { Mode } from "../types";

const STORAGE_KEY = "azure_app_telemetry";

export interface TelemetryState {
  modeOpens: Partial<Record<Mode, number>>;
  pipelineRuns: number;
  quickRuns: number;
  pipelineCancellations: number;
  pipelineCompletions: number;
  designsSaved: number;
  designsExported: number;
  designsCompared: number;
  autofillApplied: Record<"strategy" | "bootstrap" | "architecture", number>;
  firstSeen: string;
  lastSeen: string;
}

export type TelemetryEvent =
  | { kind: "mode_open"; mode: Mode }
  | { kind: "run_started"; mode: "pipeline" | "quick" }
  | { kind: "pipeline_completed" }
  | { kind: "pipeline_cancelled" }
  | { kind: "design_saved" }
  | { kind: "design_exported" }
  | { kind: "design_compared" }
  | { kind: "autofill_applied"; panel: "strategy" | "bootstrap" | "architecture" };

function emptyState(): TelemetryState {
  const now = new Date().toISOString();
  return {
    modeOpens: {},
    pipelineRuns: 0,
    quickRuns: 0,
    pipelineCancellations: 0,
    pipelineCompletions: 0,
    designsSaved: 0,
    designsExported: 0,
    designsCompared: 0,
    autofillApplied: { strategy: 0, bootstrap: 0, architecture: 0 },
    firstSeen: now,
    lastSeen: now,
  };
}

function read(): TelemetryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyState();
    return { ...emptyState(), ...(parsed as Partial<TelemetryState>) } as TelemetryState;
  } catch {
    return emptyState();
  }
}

function write(state: TelemetryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function track(event: TelemetryEvent): void {
  const state = read();
  state.lastSeen = new Date().toISOString();
  switch (event.kind) {
    case "mode_open":
      state.modeOpens[event.mode] = (state.modeOpens[event.mode] || 0) + 1;
      break;
    case "run_started":
      if (event.mode === "pipeline") state.pipelineRuns += 1;
      else state.quickRuns += 1;
      break;
    case "pipeline_completed":
      state.pipelineCompletions += 1;
      break;
    case "pipeline_cancelled":
      state.pipelineCancellations += 1;
      break;
    case "design_saved":
      state.designsSaved += 1;
      break;
    case "design_exported":
      state.designsExported += 1;
      break;
    case "design_compared":
      state.designsCompared += 1;
      break;
    case "autofill_applied":
      state.autofillApplied[event.panel] = (state.autofillApplied[event.panel] || 0) + 1;
      break;
  }
  write(state);
}

export function getStats(): TelemetryState {
  return read();
}

export function resetStats(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
