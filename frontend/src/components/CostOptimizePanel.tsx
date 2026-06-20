import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  Input,
  Field,
  Card,
} from "@fluentui/react-components";
import {
  PlayRegular,
  StopRegular,
  AddRegular,
  DismissRegular,
  MoneyRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import { apiFetch } from "../config/api";
import type { CostOptimization } from "../types";
import { exportMessageToDocx } from "../utils/docxExport";
import {
  hashCostRequest,
  loadCostState,
  saveCostState,
  clearCostState,
  newCostState,
  type CostPhase,
  type CostPhaseEvent,
  type CostPipelineState,
} from "../utils/costPipelineState";

const PHASE_ORDER: CostPhase[] = [
  "estimate",
  "live_price",
  "carbon",
  "reservations",
  "rightsizing",
  "break_even",
  "narration",
];

const PHASE_LABELS: Record<CostPhase, string> = {
  estimate: "Estimate",
  live_price: "Live Pricing",
  carbon: "Carbon",
  reservations: "Reservations",
  rightsizing: "Rightsizing",
  break_even: "Break-even",
  narration: "Narration",
};

interface CostItem {
  service: string;
  sku: string;
  region: string;
  quantity: number;
  hours_per_month: number;
}

function newItem(): CostItem {
  return { service: "", sku: "", region: "eastus", quantity: 1, hours_per_month: 730 };
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  header: {
    flexShrink: 0,
    padding: "20px 28px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "20px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  itemsCard: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.2fr 0.8fr 0.6fr 0.8fr auto",
    gap: "8px",
    alignItems: "end",
  },
  controls: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  phaseRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 12px",
    borderRadius: "4px",
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  reportCard: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxHeight: "70vh",
    minHeight: 0,
  },
  reportHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexShrink: 0,
  },
  reportScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingRight: "8px",
  },
  report: {
    lineHeight: 1.6,
    "& h1, & h2, & h3": { marginTop: "16px" },
    "& code": {
      background: tokens.colorNeutralBackground3,
      padding: "1px 4px",
      borderRadius: "3px",
      fontSize: "13px",
    },
  },
});

type PhaseStatus = "pending" | "started" | "complete" | "skipped" | "failed";

function statusBadge(status: PhaseStatus, reason?: string, error?: string) {
  switch (status) {
    case "complete":
      return <Badge appearance="filled" color="success">complete</Badge>;
    case "skipped":
      return <Badge appearance="tint" color="warning">skipped{reason ? ` · ${reason}` : ""}</Badge>;
    case "failed":
      return <Badge appearance="tint" color="danger">failed{error ? ` · ${error}` : ""}</Badge>;
    case "started":
      return <Badge appearance="tint" color="brand">running</Badge>;
    default:
      return <Badge appearance="outline">pending</Badge>;
  }
}

export default function CostOptimizePanel() {
  const styles = useStyles();
  const [items, setItems] = useState<CostItem[]>([
    { service: "Virtual Machines", sku: "Standard_D4s_v5", region: "eastus", quantity: 1, hours_per_month: 730 },
  ]);
  const [region, setRegion] = useState("eastus");
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<CostPhaseEvent[]>([]);
  const [result, setResult] = useState<CostOptimization | null>(null);
  const [resumable, setResumable] = useState<CostPipelineState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const state = loadCostState();
    if (!state) {
      setResumable(null);
      return;
    }
    const currentHash = hashCostRequest({ items, region });
    if (state.request_hash === currentHash) {
      setResumable(state);
      setEvents(state.events);
      setResult(state.result);
    } else {
      setResumable(null);
    }
  }, [items, region]);

  function phaseStatus(phase: CostPhase): { status: PhaseStatus; reason?: string; error?: string } {
    let current: PhaseStatus = "pending";
    let reason: string | undefined;
    let error: string | undefined;
    for (const ev of events) {
      if (ev.phase !== phase) continue;
      current = ev.type;
      reason = ev.reason;
      error = ev.error;
    }
    return { status: current, reason, error };
  }

  function setItem(idx: number, patch: Partial<CostItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, newItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }

  async function handleRun() {
    if (items.length === 0) return;
    setIsRunning(true);
    setEvents([]);
    setResult(null);
    clearCostState();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const reqBody = { items, region };
    const hash = hashCostRequest({ items, region });
    let state = newCostState(hash);
    saveCostState(state);

    try {
      const res = await apiFetch("/api/cost/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (typeof obj.type === "string" && obj.type.startsWith("phase_")) {
              const phase = obj.phase as CostPhase | undefined;
              if (!phase) continue;
              const eventType = obj.type.replace("phase_", "") as CostPhaseEvent["type"];
              const ev: CostPhaseEvent = {
                phase,
                type: eventType,
                reason: obj.reason,
                error: obj.error,
              };
              setEvents((prev) => {
                const next = [...prev, ev];
                state = { ...state, events: next };
                saveCostState(state);
                return next;
              });
            } else if (obj.type === "cost_optimization") {
              const payload = obj as CostOptimization;
              setResult(payload);
              state = { ...state, result: payload };
              saveCostState(state);
            } else if (obj.type === "done") {
              setIsRunning(false);
            }
          } catch {
            // ignore parse errors on partial lines
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("cost pipeline error", err);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }

  function handleResume() {
    if (!resumable) return;
    setEvents(resumable.events);
    setResult(resumable.result);
    setResumable(null);
  }

  function handleDiscardResume() {
    clearCostState();
    setResumable(null);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">Cost Optimize</Text>
        <Text size={200}>
          7-phase deterministic pipeline: estimate → live pricing → carbon → reservations → rightsizing → break-even → narration.
        </Text>
        <div className={styles.controls}>
          <Field label="Region" style={{ width: "180px" }}>
            <Input value={region} onChange={(_, d) => setRegion(d.value)} />
          </Field>
          {isRunning ? (
            <Button appearance="secondary" icon={<StopRegular />} onClick={handleStop}>Stop</Button>
          ) : (
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={handleRun}
              disabled={items.length === 0}
            >
              Run
            </Button>
          )}
          {isRunning && <Spinner size="tiny" />}
        </div>
        {resumable && !isRunning && (
          <div className={styles.controls}>
            <Text size={200}>Previous run available.</Text>
            <Button size="small" onClick={handleResume}>Resume</Button>
            <Button size="small" appearance="subtle" onClick={handleDiscardResume}>Discard</Button>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <Card className={styles.itemsCard}>
          <Text weight="semibold">Line items</Text>
          {items.map((it, idx) => (
            <div key={idx} className={styles.itemRow}>
              <Field label={idx === 0 ? "Service" : undefined}>
                <Input value={it.service} onChange={(_, d) => setItem(idx, { service: d.value })} />
              </Field>
              <Field label={idx === 0 ? "SKU" : undefined}>
                <Input value={it.sku} onChange={(_, d) => setItem(idx, { sku: d.value })} />
              </Field>
              <Field label={idx === 0 ? "Region" : undefined}>
                <Input value={it.region} onChange={(_, d) => setItem(idx, { region: d.value })} />
              </Field>
              <Field label={idx === 0 ? "Qty" : undefined}>
                <Input
                  type="number"
                  value={String(it.quantity)}
                  onChange={(_, d) => setItem(idx, { quantity: Number(d.value) || 0 })}
                />
              </Field>
              <Field label={idx === 0 ? "Hours/mo" : undefined}>
                <Input
                  type="number"
                  value={String(it.hours_per_month)}
                  onChange={(_, d) => setItem(idx, { hours_per_month: Number(d.value) || 0 })}
                />
              </Field>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                aria-label="Remove line item"
              />
            </div>
          ))}
          <Button appearance="subtle" icon={<AddRegular />} onClick={addItem}>Add line item</Button>
        </Card>

        <Card className={styles.itemsCard}>
          <Text weight="semibold">Phases</Text>
          <div className={styles.timeline}>
            {PHASE_ORDER.map((phase) => {
              const { status, reason, error } = phaseStatus(phase);
              return (
                <div key={phase} className={styles.phaseRow}>
                  <MoneyRegular />
                  <Text weight="semibold" style={{ minWidth: "120px" }}>{PHASE_LABELS[phase]}</Text>
                  {statusBadge(status, reason, error)}
                </div>
              );
            })}
          </div>
        </Card>

        {result?.report && (
          <Card className={styles.reportCard}>
            <div className={styles.reportHeader}>
              <Text size={500} weight="semibold">Narrated report</Text>
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={() =>
                  exportMessageToDocx(result.report ?? "", `cost-optimize-report-${Date.now()}.docx`)
                }
              >
                Export DOCX
              </Button>
            </div>
            <div className={styles.reportScroll}>
              <div className={styles.report}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.report}</ReactMarkdown>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
