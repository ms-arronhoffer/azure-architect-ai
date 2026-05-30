import { useCallback, useState } from "react";

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function loadResolved(conversationId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`findings-${conversationId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveResolved(conversationId: string, resolved: Set<string>) {
  localStorage.setItem(`findings-${conversationId}`, JSON.stringify([...resolved]));
}

export function useFindingChecklist(conversationId: string) {
  const [resolved, setResolved] = useState<Set<string>>(() => loadResolved(conversationId));

  const toggle = useCallback((finding: string) => {
    const key = hashStr(finding);
    setResolved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveResolved(conversationId, next);
      return next;
    });
  }, [conversationId]);

  const isResolved = useCallback((finding: string): boolean => {
    return resolved.has(hashStr(finding));
  }, [resolved]);

  return {
    toggle,
    isResolved,
    resolvedCount: resolved.size,
  };
}
