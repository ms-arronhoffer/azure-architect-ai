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
const CUSTOM_SKILLS_OVERRIDE_KEY = "azure_custom_skills";
const TRUTHY = new Set(["true", "1", "yes", "on"]);

// Build-time default — the last-resort fallback before the server responds.
// Unified agents are opt-in: only an explicit truthy value enables them.
function envDefault(): boolean {
  const raw = (import.meta.env.VITE_UNIFIED_AGENTS ?? "").trim().toLowerCase();
  return TRUTHY.has(raw);
}

// Build-time default for the custom-skills surface (on by default).
function customSkillsEnvDefault(): boolean {
  const raw = (import.meta.env.VITE_CUSTOM_SKILLS ?? "").trim().toLowerCase();
  if (raw === "") return true;
  return TRUTHY.has(raw);
}

// Server-provided default, populated by loadRuntimeConfig(). null = not yet known.
let serverValue: boolean | null = null;
let customSkillsServerValue: boolean | null = null;

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

function readCustomSkillsOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(CUSTOM_SKILLS_OVERRIDE_KEY);
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

// Synchronous accessor for the custom-skills surface.
export function getCustomSkills(): boolean {
  const override = readCustomSkillsOverride();
  if (override !== null) return override;
  if (customSkillsServerValue !== null) return customSkillsServerValue;
  return customSkillsEnvDefault();
}

// Whether the user has pinned an explicit override (vs. following the server default).
export function hasUnifiedAgentsOverride(): boolean {
  return readOverride() !== null;
}

export function hasCustomSkillsOverride(): boolean {
  return readCustomSkillsOverride() !== null;
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

export function setCustomSkillsOverride(value: boolean | null): void {
  try {
    if (value === null) localStorage.removeItem(CUSTOM_SKILLS_OVERRIDE_KEY);
    else localStorage.setItem(CUSTOM_SKILLS_OVERRIDE_KEY, String(value));
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
    const data = (await resp.json()) as { unified_agents?: unknown; custom_skills?: unknown };
    let changed = false;
    if (typeof data.unified_agents === "boolean") {
      serverValue = data.unified_agents;
      changed = true;
    }
    if (typeof data.custom_skills === "boolean") {
      customSkillsServerValue = data.custom_skills;
      changed = true;
    }
    if (changed) notify();
  } catch {
    /* keep fallback value */
  }
}
