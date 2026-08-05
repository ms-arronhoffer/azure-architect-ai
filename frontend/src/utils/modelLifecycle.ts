/** Filtering + ordering rules for the AI Model Lifecycle panel.
 *
 * Kept out of the component so the rules are unit-testable: a model whose
 * retirement date has passed is effectively retired, so it never counts as
 * "retiring soon", never appears in the GA/Preview quick filters, and always
 * sorts below models that are still live.
 */

export type Lifecycle = "GA" | "Preview" | "Deprecated" | "Retired" | "Legacy";

export type FilterTab = "soon" | "ga" | "preview" | "atrisk" | "retired" | "all";

export interface ModelEntry {
  provider: string;
  model: string;
  version: string;
  lifecycle: Lifecycle;
  retirement: string | null;
  replacement: string | null;
  soldBy: "Azure" | "Partner";
}

export const SOON_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(dateStr: string, now: number = Date.now()): number {
  return Math.ceil((new Date(dateStr).getTime() - now) / DAY_MS);
}

/** A model is past due once its retirement date has passed, or once Microsoft
 *  marks it Retired outright. */
export function isPastDue(m: ModelEntry, now: number = Date.now()): boolean {
  if (m.lifecycle === "Retired") return true;
  if (!m.retirement) return false;
  return daysUntil(m.retirement, now) < 0;
}

export function isRetiringSoon(m: ModelEntry, now: number = Date.now()): boolean {
  if (!m.retirement || isPastDue(m, now)) return false;
  return daysUntil(m.retirement, now) <= SOON_DAYS;
}

export function matchesTab(m: ModelEntry, filter: FilterTab, now: number = Date.now()): boolean {
  switch (filter) {
    case "soon":
      return isRetiringSoon(m, now);
    case "ga":
      return m.lifecycle === "GA" && !isPastDue(m, now);
    case "preview":
      return m.lifecycle === "Preview" && !isPastDue(m, now);
    case "atrisk":
      return (m.lifecycle === "Deprecated" || m.lifecycle === "Legacy") && !isPastDue(m, now);
    case "retired":
      return isPastDue(m, now);
    case "all":
      return true;
  }
}

/** Live models lead, soonest retirement first; models without a date follow;
 *  past-due models sink to the bottom, most recently retired first. */
export function compareModels(a: ModelEntry, b: ModelEntry, now: number = Date.now()): number {
  const aPast = isPastDue(a, now);
  const bPast = isPastDue(b, now);
  if (aPast !== bPast) return aPast ? 1 : -1;

  const aMs = a.retirement ? new Date(a.retirement).getTime() : null;
  const bMs = b.retirement ? new Date(b.retirement).getTime() : null;
  if (aMs === null && bMs === null) return 0;
  if (aMs === null) return 1;
  if (bMs === null) return -1;

  // Past due: most recently retired first. Live: soonest retirement first.
  return aPast ? bMs - aMs : aMs - bMs;
}

export function filterAndSortModels(
  models: ModelEntry[],
  opts: { filter: FilterTab; search?: string; provider?: string | null; now?: number },
): ModelEntry[] {
  const now = opts.now ?? Date.now();
  const q = (opts.search ?? "").trim().toLowerCase();

  return models
    .filter((m) => {
      if (q) {
        const matches =
          m.model.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          (m.replacement ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (opts.provider && m.provider !== opts.provider) return false;
      return matchesTab(m, opts.filter, now);
    })
    .sort((a, b) => compareModels(a, b, now));
}
