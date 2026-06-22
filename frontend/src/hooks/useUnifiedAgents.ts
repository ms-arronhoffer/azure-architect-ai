import { useCallback, useSyncExternalStore } from "react";
import {
  getUnifiedAgents,
  hasUnifiedAgentsOverride,
  setUnifiedAgentsOverride,
  subscribeRuntimeFlags,
} from "../config/runtimeFlags";

export interface UseUnifiedAgents {
  /** Effective flag value (override → server default → build-time env). */
  enabled: boolean;
  /** True when the user has pinned an explicit per-browser override. */
  hasOverride: boolean;
  /** Pin an explicit override, or pass null to revert to the server default. */
  setEnabled: (value: boolean | null) => void;
}

/**
 * Reactive accessor for the unified-agents runtime flag. Re-renders whenever the
 * value changes (server config load or a user toggle), so the nav surface and
 * default mode stay in sync without a rebuild.
 */
export function useUnifiedAgents(): UseUnifiedAgents {
  const enabled = useSyncExternalStore(subscribeRuntimeFlags, getUnifiedAgents, getUnifiedAgents);
  const hasOverride = useSyncExternalStore(
    subscribeRuntimeFlags,
    hasUnifiedAgentsOverride,
    hasUnifiedAgentsOverride,
  );
  const setEnabled = useCallback((value: boolean | null) => {
    setUnifiedAgentsOverride(value);
  }, []);
  return { enabled, hasOverride, setEnabled };
}
