import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Toast,
  ToastTitle,
  ToastBody,
  ToastFooter,
  Button,
  useToastController,
} from "@fluentui/react-components";
import { apiFetch } from "../config/api";
import { TOASTER_ID } from "../constants/toaster";
import { ToastDismissButton } from "../components/ToastDismissButton";
import type { DemoBuilt } from "../types";
import {
  clearDemoState,
  hashDemoRequest,
  loadDemoState,
  newDemoState,
  saveDemoState,
  type DemoJobStatus,
  type DemoPhase,
  type DemoPhaseEvent,
  type DemoPipelineRequestShape,
  type DemoPipelineState,
} from "../utils/demoPipelineState";

export interface DemoBuildStartArgs {
  /** Full request body POSTed to /api/demo/build. */
  body: Record<string, unknown>;
  /** Stable shape used for hashing / resume detection. */
  requestShape: DemoPipelineRequestShape;
  publish: boolean;
}

export interface DemoBuildContextValue {
  status: DemoJobStatus;
  jobId: string | null;
  events: DemoPhaseEvent[];
  result: DemoBuilt | null;
  azureServices: string[];
  requestShape: DemoPipelineRequestShape | null;
  downloadError: string | null;
  isRunning: boolean;
  start: (args: DemoBuildStartArgs) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  downloadZip: () => Promise<void>;
}

const DemoBuildContext = createContext<DemoBuildContextValue | null>(null);

export function useDemoBuild(): DemoBuildContextValue {
  const ctx = useContext(DemoBuildContext);
  if (!ctx) throw new Error("useDemoBuild must be used within <DemoBuildProvider>");
  return ctx;
}

/** Parse a flat backend phase event object into a typed DemoPhaseEvent. */
function toPhaseEvent(obj: Record<string, unknown>): DemoPhaseEvent | null {
  const t = obj.type as string | undefined;
  if (typeof t !== "string" || !t.startsWith("phase_")) return null;
  const phase = obj.phase as DemoPhase | undefined;
  if (!phase) return null;
  return {
    phase,
    type: t.replace("phase_", "") as DemoPhaseEvent["type"],
    reason: obj.reason as string | undefined,
    error: obj.error as string | undefined,
    degraded: obj.degraded as boolean | undefined,
    azureServices: Array.isArray(obj.azure_services) ? (obj.azure_services as string[]) : undefined,
    filesAdded: typeof obj.files_added === "number" ? obj.files_added : undefined,
    elapsedS: typeof obj.elapsed_s === "number" ? obj.elapsed_s : undefined,
  };
}

const EMPTY_STATE: DemoPipelineState = {
  request_hash: "",
  started_at: "",
  job_id: null,
  status: "idle",
  publish: false,
  azure_services: [],
  request_shape: null,
  events: [],
  result: null,
};

export function DemoBuildProvider({ children }: { children: ReactNode }) {
  const { dispatchToast } = useToastController(TOASTER_ID);

  const [status, setStatus] = useState<DemoJobStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<DemoPhaseEvent[]>([]);
  const [result, setResult] = useState<DemoBuilt | null>(null);
  const [azureServices, setAzureServices] = useState<string[]>([]);
  const [requestShape, setRequestShape] = useState<DemoPipelineRequestShape | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Canonical persistable snapshot — single source of truth for localStorage so
  // the long-lived SSE loop never reads stale React closures.
  const liveRef = useRef<DemoPipelineState>({ ...EMPTY_STATE });
  // Tracks the SSE reader so we can tear it down on stop/unmount without
  // cancelling the server-side build.
  const abortRef = useRef<AbortController | null>(null);
  // Guards against double-toasting the same finished job.
  const toastedRef = useRef<Set<string>>(new Set());

  const save = useCallback((patch: Partial<DemoPipelineState>) => {
    liveRef.current = { ...liveRef.current, ...patch };
    saveDemoState(liveRef.current);
  }, []);

  const downloadZip = useCallback(async () => {
    const id = liveRef.current.result?.job_id || liveRef.current.job_id;
    if (!id) return;
    setDownloadError(null);
    try {
      const res = await apiFetch(`/api/demo/${id}/zip`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Download failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${liveRef.current.result?.spec?.slug || liveRef.current.request_shape?.demo_slug || "demo"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(msg);
      console.error("demo zip download failed", err);
    }
  }, []);

  // Auto-clear download errors (no persistent error banner).
  useEffect(() => {
    if (!downloadError) return;
    const t = setTimeout(() => setDownloadError(null), 6000);
    return () => clearTimeout(t);
  }, [downloadError]);

  const fireReadyToast = useCallback(
    (built: DemoBuilt) => {
      if (!built.job_id || toastedRef.current.has(built.job_id)) return;
      toastedRef.current.add(built.job_id);
      const title = built.spec?.title || liveRef.current.request_shape?.demo_title || "Your demo";
      const published = Boolean(built.repo_url);
      dispatchToast(
        <Toast>
          <ToastTitle action={<ToastDismissButton />}>Demo ready 🎉</ToastTitle>
          <ToastBody>
            {title} is ready to download
            {published ? " and has been pushed to GitHub." : "."}
          </ToastBody>
          <ToastFooter>
            <Button size="small" appearance="primary" onClick={() => void downloadZip()}>
              Download ZIP
            </Button>
            {published && built.repo_url && (
              <Button
                size="small"
                appearance="secondary"
                as="a"
                href={built.repo_url}
                target="_blank"
                rel="noreferrer"
              >
                Open repo
              </Button>
            )}
          </ToastFooter>
        </Toast>,
        { intent: "success", timeout: 15000 },
      );
    },
    [dispatchToast, downloadZip],
  );

  // Core SSE consumer. Reads buffered + live events for `id` and updates state.
  // Safe on first build or on reconnect (server replays from event 0).
  const consume = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await apiFetch(`/api/demo/${id}/events`, { signal: ctrl.signal });
        if (!res.ok || !res.body) {
          if (res.status === 404) {
            setStatus("idle");
            clearDemoState();
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const nextEvents: DemoPhaseEvent[] = [];
        let maxServices: string[] = liveRef.current.azure_services;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let obj: Record<string, unknown>;
            try {
              obj = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const t = obj.type as string | undefined;
            const phaseEv = toPhaseEvent(obj);
            if (phaseEv) {
              nextEvents.push(phaseEv);
              setEvents([...nextEvents]);
              if (phaseEv.azureServices && phaseEv.azureServices.length >= maxServices.length) {
                maxServices = phaseEv.azureServices;
                setAzureServices(maxServices);
              }
              save({ events: [...nextEvents], status: "running", azure_services: maxServices });
            } else if (t === "demo_built") {
              const built = obj as unknown as DemoBuilt;
              setResult(built);
              if (built.azure_services?.length) {
                maxServices = built.azure_services;
                setAzureServices(maxServices);
              }
              save({ result: built, azure_services: maxServices });
            } else if (t === "done") {
              setStatus("done");
              save({ status: "done" });
            } else if (t === "cancelled") {
              setStatus("cancelled");
              save({ status: "cancelled" });
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("demo events stream error", err);
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [save],
  );

  // When a build finishes with a result, raise the global toast.
  useEffect(() => {
    if ((status === "done" || status === "error") && result) {
      fireReadyToast(result);
    }
  }, [status, result, fireReadyToast]);

  const start = useCallback(
    async (args: DemoBuildStartArgs) => {
      const hash = hashDemoRequest(args.requestShape);
      setRequestShape(args.requestShape);
      setAzureServices(args.requestShape.azure_services || []);
      setEvents([]);
      setResult(null);
      setJobId(null);
      setStatus("running");
      liveRef.current = newDemoState(hash, { publish: args.publish, requestShape: args.requestShape });
      saveDemoState(liveRef.current);

      try {
        const res = await apiFetch("/api/demo/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.body),
        });
        if (!res.ok) {
          setStatus("error");
          save({ status: "error" });
          const text = await res.text().catch(() => "");
          console.error("demo build start failed", res.status, text);
          return;
        }
        const data = (await res.json()) as { job_id?: string };
        if (!data.job_id) {
          setStatus("error");
          save({ status: "error" });
          return;
        }
        setJobId(data.job_id);
        save({ job_id: data.job_id, status: "running" });
        void consume(data.job_id);
      } catch (err) {
        console.error("demo build start error", err);
        setStatus("error");
        save({ status: "error" });
      }
    },
    [consume, save],
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const id = liveRef.current.job_id;
    setStatus("idle");
    save({ status: "idle" });
    if (id) {
      try {
        await apiFetch(`/api/demo/${id}/cancel`, { method: "POST" });
      } catch {
        /* best effort */
      }
    }
  }, [save]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setJobId(null);
    setEvents([]);
    setResult(null);
    setAzureServices([]);
    setRequestShape(null);
    liveRef.current = { ...EMPTY_STATE };
    clearDemoState();
  }, []);

  // Reconnect to an in-flight (or recently finished) build on mount / reload.
  useEffect(() => {
    const persisted = loadDemoState();
    if (!persisted || !persisted.job_id) return;
    liveRef.current = persisted;
    setRequestShape(persisted.request_shape);
    setAzureServices(persisted.azure_services || []);
    setEvents(persisted.events || []);
    setResult(persisted.result);
    setJobId(persisted.job_id);

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/demo/${persisted.job_id}/status`);
        if (cancelled) return;
        if (res.status === 404) {
          // Server lost the job (restart / TTL). Keep a completed result for
          // viewing but drop the dead job so we don't stream it.
          setStatus(persisted.result ? "done" : "idle");
          return;
        }
        if (!res.ok) {
          setStatus(persisted.status === "running" ? "idle" : persisted.status);
          return;
        }
        const snap = (await res.json()) as { status: DemoJobStatus };
        if (cancelled) return;
        setStatus(snap.status);
        // Replay (running or finished) to capture live/final events; a finished
        // build also triggers the ready toast via the effect above.
        void consume(persisted.job_id!);
      } catch {
        if (!cancelled) setStatus(persisted.status === "running" ? "idle" : persisted.status);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<DemoBuildContextValue>(
    () => ({
      status,
      jobId,
      events,
      result,
      azureServices,
      requestShape,
      downloadError,
      isRunning: status === "running",
      start,
      stop,
      reset,
      downloadZip,
    }),
    [status, jobId, events, result, azureServices, requestShape, downloadError, start, stop, reset, downloadZip],
  );

  return <DemoBuildContext.Provider value={value}>{children}</DemoBuildContext.Provider>;
}
