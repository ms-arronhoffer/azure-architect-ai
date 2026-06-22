// Runtime feature flags.
//
// Historically the unified-agents surface was gated by the build-time
// `VITE_UNIFIED_AGENTS` env var, so flipping it required a rebuild + redeploy.
// We now resolve the flag at runtime, with this precedence (highest first):
//
//   1. User override   — persisted in localStorage (`azure_unified_agents`),
//                        toggled from the Settings drawer. Per-browser.
//   2. Server config    — fetched once at boot from `GET /api/config`. Lets an
//                        operator flip the default with only a backend restart.
//   3. Build-time env   — `VITE_UNIFIED_AGENTS` fallback for the window before
//                        the server responds (or if the request fails).
//
// Components read the flag through `useUnifiedAgents()` (or the synchronous
// `getUnifiedAgents()` accessor) and re-render when it changes via the simple
// subscriber registry below.
import { apiFetch } from "./api";

const OVERRIDE_KEY = "azure_unified_agents";
const TRUTHY = new Set(["true", "1", "yes", "on"]);

// Build-time default — the last-resort fallback before the server responds.
// Unified agents are opt-in: only an explicit truthy value enables them.
function envDefault(): boolean {
  const raw = (import.meta.env.VITE_UNIFIED_AGENTS ?? "").trim().toLowerCase();
  return TRUTHY.has(raw);
}

// Server-provided default, populated by loadRuntimeConfig(). null = not yet known.
let serverValue: boolean | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeRuntimeFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw === null) return null;
    return TRUTHY.has(raw.trim().toLowerCase());
  } catch {
    return null;
  }
}

// Synchronous accessor used by render code and non-React modules.
export function getUnifiedAgents(): boolean {
  const override = readOverride();
  if (override !== null) return override;
  if (serverValue !== null) return serverValue;
  return envDefault();
}

// Whether the user has pinned an explicit override (vs. following the server default).
export function hasUnifiedAgentsOverride(): boolean {
  return readOverride() !== null;
}

// Persist (or clear) the per-browser override and notify subscribers.
export function setUnifiedAgentsOverride(value: boolean | null): void {
  try {
    if (value === null) localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, String(value));
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
  notify();
}

// Fetch the server-provided defaults once at app startup. Failures are swallowed
// so the SPA still boots on the env/override fallback.
export async function loadRuntimeConfig(): Promise<void> {
  try {
    const resp = await apiFetch("/api/config");
    if (!resp.ok) return;
    const data = (await resp.json()) as { unified_agents?: unknown };
    if (typeof data.unified_agents === "boolean") {
      serverValue = data.unified_agents;
      notify();
    }
  } catch {
    /* keep fallback value */
  }
}
