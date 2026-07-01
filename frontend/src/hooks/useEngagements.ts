import { useCallback, useEffect, useState } from "react";
import { apiFetch, setEngagementProvider } from "../config/api";
import { notifyEngagementChange } from "./usePersistentPanelState";

export interface Engagement {
  id: string;
  name: string;
  customer_name: string;
  industry: string | null;
  compliance_frameworks: string[];
  subscription_ids: string[];
  region_preference: string | null;
  notes: string;
  reservation_commitments: Record<string, unknown>;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface EngagementWrite {
  name: string;
  customer_name?: string;
  industry?: string | null;
  compliance_frameworks?: string[];
  subscription_ids?: string[];
  region_preference?: string | null;
  notes?: string;
  reservation_commitments?: Record<string, unknown>;
  status?: string;
}

const ACTIVE_KEY = "azure_active_engagement_id";

export function useEngagements() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY),
  );
  const [loading, setLoading] = useState(false);

  // Register the engagement provider so apiFetch attaches X-Engagement-Id
  // automatically. Always read from localStorage so background tabs stay in sync.
  useEffect(() => {
    setEngagementProvider(() => localStorage.getItem(ACTIVE_KEY));
    return () => setEngagementProvider(null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/engagements");
      if (r.ok) {
        const data: Engagement[] = await r.json();
        setEngagements(data);
        // Drop active pointer if it no longer exists server-side.
        const id = localStorage.getItem(ACTIVE_KEY);
        if (id && !data.some((e) => e.id === id)) {
          localStorage.removeItem(ACTIVE_KEY);
          setActiveIdState(null);
        }
      }
    } catch {
      // network — ignore, leave list as-is
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    setActiveIdState(id);
    // Let engagement-scoped persistent panels re-key to the new workspace.
    notifyEngagementChange();
  }, []);

  const create = useCallback(async (body: EngagementWrite): Promise<Engagement> => {
    const r = await apiFetch("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compliance_frameworks: [],
        subscription_ids: [],
        reservation_commitments: {},
        notes: "",
        customer_name: "",
        status: "active",
        ...body,
      }),
    });
    if (!r.ok) throw new Error(`Create failed (${r.status})`);
    const created: Engagement = await r.json();
    await refresh();
    return created;
  }, [refresh]);

  const update = useCallback(async (id: string, body: EngagementWrite): Promise<Engagement> => {
    const r = await apiFetch(`/api/engagements/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compliance_frameworks: [],
        subscription_ids: [],
        reservation_commitments: {},
        notes: "",
        customer_name: "",
        status: "active",
        ...body,
      }),
    });
    if (!r.ok) throw new Error(`Update failed (${r.status})`);
    const updated: Engagement = await r.json();
    await refresh();
    return updated;
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<void> => {
    const r = await apiFetch(`/api/engagements/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) throw new Error(`Delete failed (${r.status})`);
    if (id === activeId) setActiveId(null);
    await refresh();
  }, [activeId, refresh, setActiveId]);

  const active = engagements.find((e) => e.id === activeId) ?? null;

  return { engagements, active, activeId, setActiveId, loading, refresh, create, update, remove };
}
