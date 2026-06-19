import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../config/api";

export interface EngagementReference {
  id: string;
  engagement_id: string;
  title: string;
  url: string | null;
  notes: string;
  file_name: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  has_file: boolean;
  created_at: number;
  updated_at: number;
}

export interface ReferenceCreate {
  title: string;
  url?: string;
  notes?: string;
  file?: File | null;
}

export interface ReferencePatch {
  title?: string;
  url?: string | null;
  notes?: string;
}

export function useEngagementReferences(engagementId: string | null) {
  const [items, setItems] = useState<EngagementReference[]>([]);
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
      const r = await apiFetch(`/api/engagements/${engagementId}/references`);
      if (!r.ok) throw new Error(`Load failed (${r.status})`);
      setItems(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load references");
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (body: ReferenceCreate): Promise<EngagementReference> => {
    if (!engagementId) throw new Error("No engagement selected");
    const fd = new FormData();
    fd.append("title", body.title);
    if (body.url) fd.append("url", body.url);
    if (body.notes) fd.append("notes", body.notes);
    if (body.file) fd.append("file", body.file);
    const r = await apiFetch(`/api/engagements/${engagementId}/references`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(detail || `Create failed (${r.status})`);
    }
    const created: EngagementReference = await r.json();
    await refresh();
    return created;
  }, [engagementId, refresh]);

  const update = useCallback(async (
    id: string,
    body: ReferencePatch,
  ): Promise<EngagementReference> => {
    if (!engagementId) throw new Error("No engagement selected");
    const r = await apiFetch(`/api/engagements/${engagementId}/references/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Update failed (${r.status})`);
    const updated: EngagementReference = await r.json();
    await refresh();
    return updated;
  }, [engagementId, refresh]);

  const remove = useCallback(async (id: string): Promise<void> => {
    if (!engagementId) throw new Error("No engagement selected");
    const r = await apiFetch(`/api/engagements/${engagementId}/references/${id}`, {
      method: "DELETE",
    });
    if (!r.ok && r.status !== 204) throw new Error(`Delete failed (${r.status})`);
    await refresh();
  }, [engagementId, refresh]);

  const downloadUrl = useCallback((id: string): string => {
    return `/api/engagements/${engagementId}/references/${id}/download`;
  }, [engagementId]);

  return { items, loading, error, refresh, create, update, remove, downloadUrl };
}
