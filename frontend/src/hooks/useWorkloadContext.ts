import { useCallback, useState } from "react";
import type { WorkloadContext } from "../types";

const STORAGE_KEY = "workload-context";

const EMPTY: WorkloadContext = {
  region: "",
  complianceFramework: "",
  budgetRange: "",
  teamSize: "",
  notes: "",
};

function load(): WorkloadContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(ctx: WorkloadContext) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

export function toPromptPrefix(ctx: WorkloadContext): string {
  if (!hasContext(ctx)) return "";
  const parts: string[] = [];
  if (ctx.region) parts.push(`Region: ${ctx.region}`);
  if (ctx.complianceFramework) parts.push(`Compliance: ${ctx.complianceFramework}`);
  if (ctx.budgetRange) parts.push(`Budget: ${ctx.budgetRange}`);
  if (ctx.teamSize) parts.push(`Team: ${ctx.teamSize}`);
  if (ctx.notes) parts.push(`Notes: ${ctx.notes}`);
  return `[WORKLOAD CONTEXT: ${parts.join(" | ")}]\n\n`;
}

export function hasContext(ctx: WorkloadContext): boolean {
  return !!(ctx.region || ctx.complianceFramework || ctx.budgetRange || ctx.teamSize || ctx.notes);
}

export function useWorkloadContext() {
  const [context, setContextState] = useState<WorkloadContext>(load);

  const setContext = useCallback((ctx: WorkloadContext) => {
    save(ctx);
    setContextState(ctx);
  }, []);

  const clearContext = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setContextState(EMPTY);
  }, []);

  return { context, setContext, clearContext, hasContext: hasContext(context) };
}
