import { useCallback, useRef, useState } from "react";
import type { SseEvent } from "../types";
import { apiFetch } from "../config/api";

export type OnEvent = (event: SseEvent) => void;

export function useSSE() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(
    async (url: string, body: object, onEvent: OnEvent) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      try {
        const resp = await apiFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              setIsStreaming(false);
              return;
            }
            try {
              const event = JSON.parse(data) as SseEvent;
              onEvent(event);
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          onEvent({ type: "error", message: err.message });
        }
      } finally {
        setIsStreaming(false);
      }
    },
    []
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { stream, isStreaming, cancel };
}
