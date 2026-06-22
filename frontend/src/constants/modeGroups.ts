// Shared mode-group constants and the unified-agents feature flag.
//
// These arrays previously lived as named exports inside the heavy panel
// components (AdvisorPanel, NetworkDeskPanel, …). App.tsx imported them
// alongside the default component, which forced every panel module — and its
// transitive deps (docx, xlsx, jspdf, react-syntax-highlighter, …) — into the
// initial bundle, defeating any attempt to `React.lazy` the panels.
//
// Centralizing the constants here lets App.tsx reference the routing arrays
// eagerly (they are tiny) while loading the panel components on demand.

import type { Mode } from "../types";

export const ADVISOR_MODES: Mode[] = [
  "qa", "situation", "certprep", "regional", "compare",
  "governance", "compliance", "identity",
  "security", "devsecops",
  "migration", "cost", "monitoring", "ops",
];

export const ARCH_MODES: Mode[] = [
  "architecture", "network", "aiarchitecture", "dataplatform", "apim",
];

export const NETWORK_DESK_MODES: Mode[] = [
  "netvnet", "netfirewall", "netsecurity", "nethybrid", "netprivatelink",
  "netvwan", "netdns", "netmonitor", "nettroubleshoot", "netiac", "netpricing",
];

export const COMPUTE_DESK_MODES: Mode[] = [
  "compsku", "compscale", "compdisk", "compha", "compdr",
  "compperf", "compmonitor", "comptroubleshoot", "compsecurity", "compcost",
];

export const AI_DESK_MODES: Mode[] = [
  "aifoundry", "aimodel", "airag", "aiagents", "aifinetune",
  "aimlops", "aieval", "aisafety", "aicost", "aiiac",
];

export const DATA_DESK_MODES: Mode[] = [
  "datalake", "datawarehouse", "datastream", "datalakehouse", "datagovernance",
  "datasecurity", "datamigration", "datacost", "dataquality", "dataiac",
  "datapipelineadvisor", "fabricplanner", "adfpipeline", "medalliondesigner",
];

// Panel-style modes that persist via the panel-session path (not the chat path).
export const PANEL_MODES: Mode[] = [
  ...ARCH_MODES, "waf", "review", "drbc", "threatmodel", "reliability",
  "landingzone", "troubleshoot", "strategy", "pipelineforge", "runbookstudio",
  "namingstandards", "cost-optimize", "demo-build",
];

// ── Unified 5-agent surface ────────────────────────────────────────────────

export type AgentToken =
  | "architect"
  | "cost"
  | "operations"
  | "compliance"
  | "engagement";

export const AGENT_TOKENS: AgentToken[] = [
  "architect",
  "cost",
  "operations",
  "compliance",
  "engagement",
];

export function isAgentToken(m: Mode): m is AgentToken {
  return (AGENT_TOKENS as Mode[]).includes(m);
}

// The 5-agent surface is the intended default experience. It is opt-out:
// set VITE_UNIFIED_AGENTS=false to fall back to the legacy 84-mode navigation
// during the deprecation window. Anything other than an explicit falsey value
// (or an unset variable) resolves to the unified surface.
export function unifiedAgentsEnabled(): boolean {
  const raw = (import.meta.env.VITE_UNIFIED_AGENTS ?? "").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}
