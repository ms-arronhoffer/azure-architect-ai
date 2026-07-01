import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../config/api";
import type { ShowcaseSkill, UserSkill } from "../types";

const CACHE_KEY = "azure_skills";

function readCache(): UserSkill[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserSkill[]) : [];
  } catch {
    return [];
  }
}

function writeCache(skills: UserSkill[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(skills));
  } catch {
    /* ignore storage failures (private mode, quota, etc.) */
  }
}

/**
 * CRUD against the per-user `/api/skills` surface. Loaded once the
 * authenticated shell mounts so a user's installed skills are available right
 * after login; cached in localStorage under `azure_skills` for fast first
 * paint before the network round-trip completes.
 */
export function useSkills() {
  const [skills, setSkills] = useState<UserSkill[]>(readCache);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback((next: UserSkill[]) => {
    setSkills(next);
    writeCache(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { skills: UserSkill[] } = await res.json();
      sync(data.skills ?? []);
    } catch {
      setError("Failed to load skills.");
    } finally {
      setLoading(false);
    }
  }, [sync]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enabled = useMemo(() => skills.filter((s) => s.enabled), [skills]);

  const upload = useCallback(
    async (file: File): Promise<UserSkill | null> => {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch("/api/skills/upload", { method: "POST", body: form });
      if (!res.ok) return null;
      const created: UserSkill = await res.json();
      sync([...skills, created]);
      return created;
    },
    [skills, sync],
  );

  const update = useCallback(
    async (id: string, body: Partial<Pick<UserSkill, "name" | "enabled">>): Promise<UserSkill | null> => {
      const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const updated: UserSkill = await res.json();
      sync(skills.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [skills, sync],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return false;
      sync(skills.filter((s) => s.id !== id));
      return true;
    },
    [skills, sync],
  );

  const publish = useCallback(async (id: string): Promise<boolean> => {
    const res = await apiFetch(`/api/skills/${encodeURIComponent(id)}/publish`, { method: "POST" });
    return res.ok;
  }, []);

  const exportUrl = useCallback((id: string): string => `/api/skills/${encodeURIComponent(id)}/export`, []);

  return {
    skills,
    enabled,
    loading,
    error,
    refresh,
    upload,
    update,
    remove,
    publish,
    exportUrl,
  };
}

export interface SkillShowcaseListResponse {
  title: string;
  subtitle: string;
  skills: ShowcaseSkill[];
}

/**
 * Browse + install the global Skill Showcase catalog. Mirrors `useDemos`:
 * search box, tag filter, featured-first sort.
 */
export function useSkillShowcase() {
  const [items, setItems] = useState<ShowcaseSkill[]>([]);
  const [title, setTitle] = useState("Skill Showcase");
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
      const res = await apiFetch("/api/skills/showcase");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SkillShowcaseListResponse = await res.json();
      setItems(data.skills ?? []);
      setTitle(data.title);
      setSubtitle(data.subtitle);
    } catch {
      setError("Failed to load skill showcase.");
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
    items.forEach((s) => s.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [items]);

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = items.filter((s) => {
      if (activeTag !== "All" && !s.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    return filtered.slice().sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.downloads !== b.downloads) return b.downloads - a.downloads;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [items, debouncedSearch, activeTag]);

  const install = useCallback(async (id: string): Promise<UserSkill | null> => {
    const res = await apiFetch(`/api/skills/showcase/${encodeURIComponent(id)}/install`, {
      method: "POST",
    });
    if (!res.ok) return null;
    // Bump the local downloads counter so popularity sort reflects the install.
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, downloads: s.downloads + 1 } : s)));
    return (await res.json()) as UserSkill;
  }, []);

  return {
    items,
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
    install,
  };
}
