import { useCallback, useEffect, useState } from "react";
import type { ConversationRecord, ChatMessage, Mode } from "../types";
import { apiPath } from "../config/api";

const MAX_CONVERSATIONS = 50;

async function fetchAll(): Promise<ConversationRecord[]> {
  try {
    const res = await fetch(apiPath("/api/conversations"));
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: ConversationRecord & { structuredResult?: string | null }) => ({
      ...r,
      structuredResult: r.structuredResult ? JSON.parse(r.structuredResult as string) : undefined,
    }));
  } catch {
    return [];
  }
}

export function useConversationHistory() {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);

  useEffect(() => {
    fetchAll().then(setConversations);
  }, []);

  const upsert = useCallback(async (id: string, mode: Mode, messages: ChatMessage[], structuredResult?: unknown) => {
    if (messages.length === 0) return;
    const title = messages.find((m) => m.role === "user")?.content.slice(0, 60) ?? "Untitled";
    const now = Date.now();
    const existing = conversations.find((c) => c.id === id);
    const record: ConversationRecord = existing
      ? { ...existing, messages, updatedAt: now, ...(structuredResult !== undefined && { structuredResult }) }
      : { id, mode, title, createdAt: now, updatedAt: now, messages, ...(structuredResult !== undefined && { structuredResult }) };

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return [record, ...filtered].slice(0, MAX_CONVERSATIONS);
    });

    try {
      await fetch(apiPath("/api/conversations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...record,
          structuredResult: record.structuredResult !== undefined
            ? JSON.stringify(record.structuredResult)
            : null,
        }),
      });
    } catch {
      // best-effort
    }
  }, [conversations]);

  const remove = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(apiPath(`/api/conversations/${id}`), { method: "DELETE" });
    } catch {
      // best-effort
    }
  }, []);

  const clear = useCallback(async () => {
    setConversations([]);
    try {
      await fetch(apiPath("/api/conversations"), { method: "DELETE" });
    } catch {
      // best-effort
    }
  }, []);

  const fork = useCallback(async (id: string, mode: Mode, messages: ChatMessage[]) => {
    const baseTitle = messages.find((m) => m.role === "user")?.content.slice(0, 55) ?? "Untitled";
    const now = Date.now();
    const record: ConversationRecord = {
      id,
      mode,
      title: `Fork: ${baseTitle}`,
      createdAt: now,
      updatedAt: now,
      messages,
    };

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return [record, ...filtered].slice(0, MAX_CONVERSATIONS);
    });

    try {
      await fetch(apiPath("/api/conversations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
    } catch {
      // best-effort
    }

    return record;
  }, []);

  return { conversations, upsert, remove, clear, fork };
}
