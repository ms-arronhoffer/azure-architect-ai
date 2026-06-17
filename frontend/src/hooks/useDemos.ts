import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../config/api";
import type { Demo } from "../types";

export interface DemoListResponse {
  title: string;
  subtitle: string;
  demos: Demo[];
}

export interface DemoInput {
  title: string;
  description: string;
  tags: string[];
  video_url: string | null;
  repo_url: string | null;
  thumbnail_url: string | null;
  featured: boolean;
}

export function useDemos() {
  const [demos, setDemos] = useState<Demo[]>([]);
  const [title, setTitle] = useState("Demo Showcase");
  const [subtitle, setSubtitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string>("All");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/demos");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DemoListResponse = await res.json();
      setDemos(data.demos ?? []);
      setTitle(data.title);
      setSubtitle(data.subtitle);
    } catch {
      setError("Failed to load demos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    demos.forEach((d) => d.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [demos]);

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = demos.filter((d) => {
      if (activeTag !== "All" && !d.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    return filtered.slice().sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [demos, debouncedSearch, activeTag]);

  const create = useCallback(async (body: DemoInput): Promise<Demo | null> => {
    const res = await apiFetch("/api/demos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const created: Demo = await res.json();
    setDemos((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, body: Partial<DemoInput>): Promise<Demo | null> => {
    const res = await apiFetch(`/api/demos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const updated: Demo = await res.json();
    setDemos((prev) => prev.map((d) => (d.id === id ? updated : d)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const res = await apiFetch(`/api/demos/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return false;
    setDemos((prev) => prev.filter((d) => d.id !== id));
    return true;
  }, []);

  return {
    demos,
    visible,
    allTags,
    title,
    subtitle,
    loading,
    error,
    search,
    setSearch,
    activeTag,
    setActiveTag,
    refresh,
    create,
    update,
    remove,
  };
}
