import { useEffect, useState } from "react";
import type { GithubTokenStatus, UserSettings } from "../types";
import { apiFetch } from "../config/api";

const DEFAULT_SETTINGS: UserSettings = { mode_models: {} };

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false);

  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
    refreshGithubTokenStatus();
  }, []);

  async function saveSettings(s: UserSettings) {
    await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setSettings(s);
  }

  async function refreshGithubTokenStatus() {
    try {
      const res = await apiFetch("/api/auth/github-token");
      if (!res.ok) return;
      const data: GithubTokenStatus = await res.json();
      setGithubTokenConfigured(data.configured);
    } catch {
      // ignore
    }
  }

  async function setGithubToken(token: string) {
    const res = await apiFetch("/api/auth/github-token", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error(`Failed to save GitHub token (${res.status})`);
    setGithubTokenConfigured(true);
  }

  async function clearGithubToken() {
    const res = await apiFetch("/api/auth/github-token", { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(`Failed to clear token (${res.status})`);
    setGithubTokenConfigured(false);
  }

  return {
    settings,
    saveSettings,
    githubTokenConfigured,
    setGithubToken,
    clearGithubToken,
    refreshGithubTokenStatus,
  };
}
