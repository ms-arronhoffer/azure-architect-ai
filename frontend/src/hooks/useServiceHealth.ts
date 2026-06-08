import { useState, useEffect, useCallback } from "react";
import type { Announcement } from "../types";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useServiceHealth() {
  const [incidents, setIncidents] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchHealth = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-health${forceRefresh ? "?refresh=true" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents ?? []);
      setLastChecked(new Date());
    } catch {
      setError("Failed to load service health.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(() => fetchHealth(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  return {
    incidents,
    hasAlert: incidents.length > 0,
    incidentCount: incidents.length,
    loading,
    error,
    lastChecked,
    refresh: fetchHealth,
  };
}
