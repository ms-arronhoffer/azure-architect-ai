import type { BundledDesign, WorkloadSpec } from "../types";

const STORAGE_KEY = "azure_bundled_designs";

interface RawStoreV1Entry {
  bundle?: BundledDesign;
  spec_hash?: string | null;
  spec_snapshot?: WorkloadSpec | null;
  saved_at?: string;
  // legacy: direct BundledDesign at top level
  workload_name?: string;
  generated_at?: string;
}

type Store = Record<string, RawStoreV1Entry | BundledDesign>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, RawStoreV1Entry>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / serialization errors
  }
}

function safeName(name: string): string {
  return (name || "workload").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 64);
}

export interface SavedDesign {
  key: string;
  bundle: BundledDesign;
  spec_hash: string | null;
  spec_snapshot: WorkloadSpec | null;
  saved_at: string;
}

function isLegacyBundle(entry: unknown): entry is BundledDesign {
  if (!entry || typeof entry !== "object") return false;
  const obj = entry as Record<string, unknown>;
  return (
    typeof obj.workload_name === "string" &&
    typeof obj.generated_at === "string" &&
    typeof obj.architecture === "object" &&
    !("bundle" in obj)
  );
}

function normalize(key: string, raw: RawStoreV1Entry | BundledDesign): SavedDesign | null {
  if (isLegacyBundle(raw)) {
    return {
      key,
      bundle: raw,
      spec_hash: null,
      spec_snapshot: null,
      saved_at: raw.generated_at,
    };
  }
  const entry = raw as RawStoreV1Entry;
  if (!entry.bundle) return null;
  return {
    key,
    bundle: entry.bundle,
    spec_hash: entry.spec_hash ?? null,
    spec_snapshot: entry.spec_snapshot ?? null,
    saved_at: entry.saved_at || entry.bundle.generated_at,
  };
}

export interface SavedDesignEntry {
  key: string;
  design: BundledDesign;
}

export function listDesigns(): SavedDesignEntry[] {
  return listSavedDesigns().map((s) => ({ key: s.key, design: s.bundle }));
}

export function listSavedDesigns(): SavedDesign[] {
  const store = readStore();
  const out: SavedDesign[] = [];
  for (const [key, raw] of Object.entries(store)) {
    const norm = normalize(key, raw);
    if (norm) out.push(norm);
  }
  return out.sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
}

export function getDesign(key: string): BundledDesign | undefined {
  const raw = readStore()[key];
  if (!raw) return undefined;
  const norm = normalize(key, raw);
  return norm?.bundle;
}

export function getSavedDesign(key: string): SavedDesign | undefined {
  const raw = readStore()[key];
  if (!raw) return undefined;
  return normalize(key, raw) ?? undefined;
}

function hashSpec(spec: WorkloadSpec): string {
  const normalized = JSON.stringify({
    name: spec.name,
    type: spec.type,
    criticality: spec.criticality,
    peakUsers: spec.peakUsers,
    avgRps: spec.avgRps,
    dataVolumeGb: spec.dataVolumeGb,
    latencyP99Ms: spec.latencyP99Ms,
    availabilitySla: spec.availabilitySla,
    rtoHours: spec.rtoHours,
    rpoHours: spec.rpoHours,
    multiRegion: spec.multiRegion,
    primaryRegion: spec.primaryRegion,
    drRegion: spec.drRegion,
    complianceFrameworks: [...(spec.complianceFrameworks || [])].sort(),
    dataClassification: spec.dataClassification,
    identityModel: spec.identityModel,
    networkIsolation: spec.networkIsolation,
    monthlyBudgetUsd: spec.monthlyBudgetUsd,
    cloudMaturity: spec.cloudMaturity,
    existingServices: [...(spec.existingServices || [])].sort(),
  });
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function saveDesign(design: BundledDesign, spec?: WorkloadSpec | null): string {
  const rawStore = readStore();
  const store: Record<string, RawStoreV1Entry> = {};
  for (const [k, v] of Object.entries(rawStore)) {
    const norm = normalize(k, v);
    if (norm) {
      store[k] = {
        bundle: norm.bundle,
        spec_hash: norm.spec_hash,
        spec_snapshot: norm.spec_snapshot,
        saved_at: norm.saved_at,
      };
    }
  }
  const key = `${safeName(design.workload_name)}-${design.generated_at}`;
  store[key] = {
    bundle: design,
    spec_hash: spec ? hashSpec(spec) : null,
    spec_snapshot: spec ?? null,
    saved_at: new Date().toISOString(),
  };
  writeStore(store);
  return key;
}

export function deleteDesign(key: string): void {
  const rawStore = readStore();
  const store: Record<string, RawStoreV1Entry> = {};
  for (const [k, v] of Object.entries(rawStore)) {
    if (k === key) continue;
    const norm = normalize(k, v);
    if (norm) {
      store[k] = {
        bundle: norm.bundle,
        spec_hash: norm.spec_hash,
        spec_snapshot: norm.spec_snapshot,
        saved_at: norm.saved_at,
      };
    }
  }
  writeStore(store);
}
