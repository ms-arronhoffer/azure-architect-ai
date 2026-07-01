import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Engagement-scoped, navigation-durable panel state.
 *
 * Tool panels lose their local React state the moment the user navigates to a
 * different mode (App.tsx swaps the mounted panel). This hook mirrors a slice
 * of that state into `localStorage` so a screen's inputs and results survive
 * navigating away and back — and so two tools working the same engagement see a
 * consistent picture.
 *
 * Storage is namespaced by the active engagement id (falling back to a shared
 * `_global` bucket when no engagement is selected) so switching engagements
 * cleanly swaps the persisted workspace. A "Start over" / clear action removes
 * the entry to signal the end of that workflow.
 */

const PREFIX = "azure_ws";
const ACTIVE_KEY = "azure_active_engagement_id";

/** Broadcast so persistent hooks re-key when the active engagement switches. */
export const ENGAGEMENT_CHANGE_EVENT = "azure-engagement-change";

export function notifyEngagementChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(ENGAGEMENT_CHANGE_EVENT));
  } catch {
    /* non-browser env — ignore */
  }
}

function activeEngagementId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || "_global";
  } catch {
    return "_global";
  }
}

function storageKey(namespace: string, engagementId: string): string {
  return `${PREFIX}:${engagementId}:${namespace}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Remove every persisted panel state for an engagement (or the global bucket).
 * Used by the engagement-level "Start over" to wipe local workflow drafts
 * alongside the server-side workspace artifacts.
 */
export function clearEngagementWorkspaceLocal(engagementId: string | null): void {
  const eid = engagementId || "_global";
  const prefix = `${PREFIX}:${eid}:`;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  notifyEngagementChange();
}

export interface PersistentPanelState<T> {
  state: T;
  setState: (updater: T | ((prev: T) => T)) => void;
  /** Reset this panel's persisted state back to the initial value. */
  clear: () => void;
}

export function usePersistentPanelState<T>(
  namespace: string,
  initial: T,
): PersistentPanelState<T> {
  const [engagementId, setEngagementId] = useState<string>(activeEngagementId);
  const key = storageKey(namespace, engagementId);
  const [state, setStateRaw] = useState<T>(() => read(key, initial));

  // Track the current key so the persistence effect can skip the first write
  // right after we re-key (which would otherwise clobber the other bucket).
  const keyRef = useRef(key);

  // Re-key when the active engagement switches (in this tab or another).
  useEffect(() => {
    function resync() {
      const next = activeEngagementId();
      setEngagementId((prev) => (prev === next ? prev : next));
    }
    window.addEventListener(ENGAGEMENT_CHANGE_EVENT, resync);
    window.addEventListener("storage", resync);
    return () => {
      window.removeEventListener(ENGAGEMENT_CHANGE_EVENT, resync);
      window.removeEventListener("storage", resync);
    };
  }, []);

  // When the key changes (engagement switch), load that bucket's value.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setStateRaw(read(key, initial));
    // `initial` is intentionally excluded: callers pass fresh object literals
    // each render, which would loop. The bucket value wins on re-key anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota / serialization — ignore */
    }
  }, [key, state]);

  const setState = useCallback((updater: T | ((prev: T) => T)) => {
    setStateRaw((prev) =>
      typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater,
    );
  }, []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(keyRef.current);
    } catch {
      /* ignore */
    }
    setStateRaw(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, setState, clear };
}
