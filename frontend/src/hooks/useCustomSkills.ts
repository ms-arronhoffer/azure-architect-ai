import { useCallback, useSyncExternalStore } from "react";
import {
  getCustomSkills,
  hasCustomSkillsOverride,
  setCustomSkillsOverride,
  subscribeRuntimeFlags,
} from "../config/runtimeFlags";

export interface UseCustomSkills {
  /** Effective flag value (override → server default → build-time env). */
  enabled: boolean;
  /** True when the user has pinned an explicit per-browser override. */
  hasOverride: boolean;
  /** Pin an explicit override, or pass null to revert to the server default. */
  setEnabled: (value: boolean | null) => void;
}

/**
 * Reactive accessor for the custom-skills runtime flag. Re-renders whenever the
 * value changes (server config load or a user toggle), so the "My Skills" /
 * Skill Showcase surface stays in sync without a rebuild.
 */
export function useCustomSkills(): UseCustomSkills {
  const enabled = useSyncExternalStore(subscribeRuntimeFlags, getCustomSkills, getCustomSkills);
  const hasOverride = useSyncExternalStore(
    subscribeRuntimeFlags,
    hasCustomSkillsOverride,
    hasCustomSkillsOverride,
  );
  const setEnabled = useCallback((value: boolean | null) => {
    setCustomSkillsOverride(value);
  }, []);
  return { enabled, hasOverride, setEnabled };
}
