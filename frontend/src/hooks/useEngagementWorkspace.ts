import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../config/api";

/**
 * Server-side engagement workspace: tool outputs saved against the active
 * engagement for cross-tool recall. Tools save notable results here (a naming
 * standard, a cost worksheet, a landing-zone plan); the backend folds a compact
 * list into the chat/agent preamble so later tools recall them, and the
 * Engagement drawer lists them. `clear()` is the "Start over" action.
 */

export interface EngagementArtifact {
  id: string;
  engagement_id: string;
  tool: string;
  kind: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface ArtifactWrite {
  tool: string;
  title: string;
  kind?: string;
  summary?: string;
  data?: Record<string, unknown>;
}

export function useEngagementWorkspace(engagementId: string | null) {
  const [items, setItems] = useState<EngagementArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!engagementId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/engagements/${engagementId}/workspace`);
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      setItems(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (body: ArtifactWrite): Promise<EngagementArtifact | null> => {
      if (!engagementId) return null;
      const r = await apiFetch(`/api/engagements/${engagementId}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      const created: EngagementArtifact = await r.json();
      await refresh();
      return created;
    },
    [engagementId, refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!engagementId) return;
      const r = await apiFetch(`/api/engagements/${engagementId}/workspace/${id}`, {
        method: "DELETE",
      });
      if (!r.ok && r.status !== 204) throw new Error(`Delete failed (${r.status})`);
      await refresh();
    },
    [engagementId, refresh],
  );

  const clear = useCallback(async (): Promise<number> => {
    if (!engagementId) return 0;
    const r = await apiFetch(`/api/engagements/${engagementId}/workspace`, {
      method: "DELETE",
    });
    if (!r.ok) throw new Error(`Clear failed (${r.status})`);
    const body = await r.json().catch(() => ({ deleted: 0 }));
    await refresh();
    return body.deleted ?? 0;
  }, [engagementId, refresh]);

  return { items, loading, error, refresh, save, remove, clear };
}

/**
 * Fire-and-forget save of a tool output to the active engagement workspace.
 * Safe to call from any panel: no-ops (resolving false) when no engagement is
 * active, and never throws so it can't interrupt a panel's own flow.
 */
export async function saveArtifactToActiveEngagement(
  engagementId: string | null,
  body: ArtifactWrite,
): Promise<boolean> {
  if (!engagementId) return false;
  try {
    const r = await apiFetch(`/api/engagements/${engagementId}/workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}
