import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../config/api";
import type { ReferenceArch } from "../types";

export interface RefArchListResponse {
  title: string;
  subtitle: string;
  architectures: ReferenceArch[];
  total: number;
}

export interface RefArchInput {
  title: string;
  summary: string;
  category: string;
  tags: string[];
  services: string[];
  patterns: string[];
  waf_score: Record<string, number>;
  estimated_monthly: Record<string, number | string>;
  complexity: "Low" | "Medium" | "High";
  learn_url: string;
  repo_url: string | null;
  bicep_avm_module: string | null;
  diagram_url: string | null;
  featured: boolean;
}

export function useRefArch() {
  const [archs, setArchs] = useState<ReferenceArch[]>([]);
  const [title, setTitle] = useState("Reference Architecture Library");
  const [subtitle, setSubtitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string>("All");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [activeSource, setActiveSource] = useState<string>("All");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/refarch");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RefArchListResponse = await res.json();
      setArchs(data.architectures ?? []);
      setTitle(data.title);
      setSubtitle(data.subtitle);
    } catch {
      setError("Failed to load reference architectures.");
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
    archs.forEach((a) => (a.tags ?? []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [archs]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    archs.forEach((a) => a.category && set.add(a.category));
    return Array.from(set).sort();
  }, [archs]);

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = archs.filter((a) => {
      if (activeTag !== "All" && !(a.tags ?? []).includes(activeTag)) return false;
      if (activeCategory !== "All" && a.category !== activeCategory) return false;
      if (activeSource !== "All" && a.source !== activeSource) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.summary ?? a.description ?? "").toLowerCase().includes(q) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        (a.services ?? []).some((s) => s.toLowerCase().includes(q))
      );
    });
    return filtered.slice().sort((a, b) => {
      const af = a.featured ?? false;
      const bf = b.featured ?? false;
      if (af !== bf) return af ? -1 : 1;
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
  }, [archs, debouncedSearch, activeTag, activeCategory, activeSource]);

  const create = useCallback(async (body: RefArchInput): Promise<ReferenceArch | null> => {
    const res = await apiFetch("/api/refarch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const created: ReferenceArch = await res.json();
    setArchs((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, body: Partial<RefArchInput>): Promise<ReferenceArch | null> => {
    const res = await apiFetch(`/api/refarch/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const updated: ReferenceArch = await res.json();
    setArchs((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const res = await apiFetch(`/api/refarch/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return false;
    setArchs((prev) => prev.filter((a) => a.id !== id));
    return true;
  }, []);

  return {
    archs,
    visible,
    allTags,
    allCategories,
    title,
    subtitle,
    loading,
    error,
    search,
    setSearch,
    activeTag,
    setActiveTag,
    activeCategory,
    setActiveCategory,
    activeSource,
    setActiveSource,
    refresh,
    create,
    update,
    remove,
  };
}
