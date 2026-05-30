import { useEffect, useState } from "react";
import type { UserSettings } from "../types";

const DEFAULT_SETTINGS: UserSettings = { github_token: "", mode_models: {} };

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  async function saveSettings(s: UserSettings) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setSettings(s);
  }

  return { settings, saveSettings };
}
