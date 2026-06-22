import { useState, useRef, useEffect, useCallback } from "react";
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
  Table,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableBody,
  TableCell,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
} from "@fluentui/react-components";
import {
  PlayRegular,
  StopRegular,
  AddRegular,
  DismissRegular,
  MoneyRegular,
  ArrowDownloadRegular,
  ArrowUploadRegular,
} from "@fluentui/react-icons";
import { apiFetch } from "../config/api";
import { TOASTER_ID } from "../constants/toaster";
import type {
  CostOptimization,
  CostCatalog,
  CostCatalogService,
  CostBreakdownLine,
  CostRecommendation,
} from "../types";
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
  "recommendations",
  "narration",
];

const PHASE_LABELS: Record<CostPhase, string> = {
  estimate: "Estimate",
  live_price: "Live Pricing",
  carbon: "Carbon",
  reservations: "Reservations",
  rightsizing: "Rightsizing",
  break_even: "Break-even",
  recommendations: "Recommendations",
  narration: "Narration",
};

interface CostItem {
  service: string;
  display_name: string;
  sku: string;
  region: string;
  quantity: number;
  hours_per_month: number;
  commitment: string;
  dimensions: Record<string, number>;
  tags: string[];
}

function newItem(): CostItem {
  return {
    service: "",
    display_name: "",
    sku: "",
    region: "eastus",
    quantity: 1,
    hours_per_month: 730,
    commitment: "none",
    dimensions: {},
    tags: [],
  };
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  itemBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingBottom: "12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.1fr 1fr 0.8fr 0.6fr 0.8fr auto",
    gap: "8px",
    alignItems: "end",
  },
  dimRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    paddingLeft: "4px",
  },
  dimField: {
    width: "170px",
  },
  controls: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
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
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: "8px",
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
  meterSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
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

function confidenceColor(c: string): "success" | "warning" | "danger" | "informative" {
  if (c === "high") return "success";
  if (c === "medium") return "informative";
  return "warning";
}

export default function CostOptimizePanel() {
  const styles = useStyles();
  const { dispatchToast } = useToastController(TOASTER_ID);
  const [items, setItems] = useState<CostItem[]>([
    {
      ...newItem(),
      service: "Virtual Machines",
      sku: "Standard_D4s_v5",
      display_name: "App tier",
    },
  ]);
  const [region, setRegion] = useState("eastus");
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<CostPhaseEvent[]>([]);
  const [result, setResult] = useState<CostOptimization | null>(null);
  const [resumable, setResumable] = useState<CostPipelineState | null>(null);
  const [catalog, setCatalog] = useState<CostCatalog | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback(
    (
      title: string,
      body?: string,
      intent: "success" | "warning" | "error" | "info" = "info",
    ) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {body ? <ToastBody>{body}</ToastBody> : null}
        </Toast>,
        { intent },
      );
    },
    [dispatchToast],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/cost/catalog");
        if (!res.ok) return;
        const data = (await res.json()) as CostCatalog;
        if (!cancelled) setCatalog(data);
      } catch {
        // catalog is optional; dimension fields just won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matchService = useCallback(
    (name: string): CostCatalogService | undefined => {
      if (!catalog || !name) return undefined;
      const n = name.trim().toLowerCase();
      return catalog.services.find(
        (s) =>
          s.service.toLowerCase() === n ||
          s.label.toLowerCase() === n ||
          (s.aliases || []).some((a) => a.toLowerCase() === n),
      );
    },
    [catalog],
  );

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

  function setDimension(idx: number, field: string, value: number) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, dimensions: { ...it.dimensions, [field]: value } } : it,
      ),
    );
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

  async function handleDownloadSample(format: "yaml" | "csv" | "json") {
    try {
      const res = await apiFetch(`/api/cost/template/sample?format=${format}`);
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const text = await res.text();
      const ext = format === "yaml" ? "yaml" : format;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sample_cost_model.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify("Download failed", err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function handleUploadFile(file: File) {
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    try {
      const body = await file.text();
      const res = await apiFetch("/api/cost/template/parse", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "X-Template-Format": ext,
          "X-Filename": file.name,
        },
        body,
      });
      const data = await res.json();
      if (data.error) {
        notify("Template error", data.error, "error");
        return;
      }
      const hydrated: CostItem[] = (data.items || []).map((it: Record<string, unknown>) => ({
        ...newItem(),
        service: String(it.service ?? ""),
        display_name: String(it.display_name ?? ""),
        sku: String(it.sku ?? ""),
        region: String(it.region ?? region) || region,
        quantity: Number(it.quantity ?? 1) || 1,
        hours_per_month: Number(it.hours_per_month ?? 730) || 730,
        commitment: String(it.commitment ?? "none"),
        dimensions: (it.dimensions as Record<string, number>) ?? {},
        tags: (it.tags as string[]) ?? [],
      }));
      if (hydrated.length === 0) {
        notify("No services found", "The template contained no usable service entries.", "warning");
        return;
      }
      setItems(hydrated);
      if (data.region) setRegion(String(data.region));
      const warnings: string[] = data.warnings || [];
      if (warnings.length > 0) {
        notify(
          `Loaded ${hydrated.length} services with ${warnings.length} warning(s)`,
          warnings.slice(0, 3).join(" "),
          "warning",
        );
      } else {
        notify(`Loaded ${hydrated.length} services`, undefined, "success");
      }
    } catch (err) {
      notify("Upload failed", err instanceof Error ? err.message : String(err), "error");
    }
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

  function exportBreakdownCsv() {
    const bd = result?.cost_breakdown;
    if (!bd) return;
    const rows: string[] = ["service,display_name,meter,unit,billable_qty,unit_price,monthly_cost"];
    for (const line of bd.line_items) {
      for (const m of line.meters) {
        rows.push(
          [
            line.service,
            line.display_name,
            m.label ?? m.dimension,
            m.unit ?? "",
            m.billable_quantity ?? "",
            m.unit_price ?? "",
            m.monthly_cost ?? "",
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      }
    }
    rows.push(`"TOTAL","","","","","",${bd.total_monthly_estimate}`);
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-breakdown-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const breakdown = result?.cost_breakdown;
  const recs = result?.recommendations;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">Cost Optimize</Text>
        <Text size={200}>
          Meter-aware live pricing: every service is priced across all of its billing meters, then a
          deterministic engine recommends savings (RI/SP, right-sizing, storage tier, greener region).
        </Text>
        <div className={styles.controls}>
          <Field label="Region" style={{ width: "160px" }}>
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
          <Button
            appearance="subtle"
            icon={<ArrowUploadRegular />}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload template
          </Button>
          <Button
            appearance="subtle"
            icon={<ArrowDownloadRegular />}
            onClick={() => handleDownloadSample("yaml")}
          >
            Sample YAML
          </Button>
          <Button appearance="subtle" size="small" onClick={() => handleDownloadSample("csv")}>
            CSV
          </Button>
          <Button appearance="subtle" size="small" onClick={() => handleDownloadSample("json")}>
            JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json,.csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadFile(file);
              e.target.value = "";
            }}
          />
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
          <Text weight="semibold">Services</Text>
          {items.map((it, idx) => {
            const svc = matchService(it.service);
            const dims = (svc?.dimensions ?? []).filter(
              (d) => d.quantity_field && !d.quantity_field.startsWith("__"),
            );
            return (
              <div key={idx} className={styles.itemBlock}>
                <div className={styles.itemRow}>
                  <Field label={idx === 0 ? "Service" : undefined}>
                    <Input
                      value={it.service}
                      onChange={(_, d) => setItem(idx, { service: d.value })}
                      placeholder="e.g. SQL Database"
                    />
                  </Field>
                  <Field label={idx === 0 ? "Name" : undefined}>
                    <Input
                      value={it.display_name}
                      onChange={(_, d) => setItem(idx, { display_name: d.value })}
                      placeholder="optional label"
                    />
                  </Field>
                  <Field label={idx === 0 ? "SKU / tier" : undefined}>
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
                    aria-label="Remove service"
                  />
                </div>
                {dims.length > 0 && (
                  <div className={styles.dimRow}>
                    {dims.map((d) => (
                      <Field
                        key={d.key}
                        label={`${d.label} (${d.unit})`}
                        className={styles.dimField}
                      >
                        <Input
                          type="number"
                          value={String(it.dimensions[d.quantity_field] ?? "")}
                          placeholder={String(d.default_quantity ?? 0)}
                          onChange={(_, dd) =>
                            setDimension(idx, d.quantity_field, Number(dd.value) || 0)
                          }
                        />
                      </Field>
                    ))}
                  </div>
                )}
                {svc === undefined && it.service.trim() !== "" && catalog && (
                  <Text size={100} className={styles.meterSub}>
                    Not in catalog — priced with the single-meter estimator.
                  </Text>
                )}
              </div>
            );
          })}
          <Button appearance="subtle" icon={<AddRegular />} onClick={addItem}>Add service</Button>
        </Card>

        <Card className={styles.itemsCard}>
          <Text weight="semibold">Phases</Text>
          <div className={styles.timeline}>
            {PHASE_ORDER.map((phase) => {
              const { status, reason, error } = phaseStatus(phase);
              return (
                <div key={phase} className={styles.phaseRow}>
                  <MoneyRegular />
                  <Text weight="semibold" style={{ minWidth: "130px" }}>{PHASE_LABELS[phase]}</Text>
                  {statusBadge(status, reason, error)}
                </div>
              );
            })}
          </div>
        </Card>

        {breakdown && breakdown.line_items.length > 0 && (
          <Card className={styles.itemsCard}>
            <div className={styles.reportHeader}>
              <Text size={500} weight="semibold">Cost breakdown</Text>
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={exportBreakdownCsv}
              >
                Export CSV
              </Button>
            </div>
            <Table size="small" aria-label="Cost breakdown by meter">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>Meter</TableHeaderCell>
                  <TableHeaderCell>Billable</TableHeaderCell>
                  <TableHeaderCell>Unit price</TableHeaderCell>
                  <TableHeaderCell>Monthly</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.line_items.flatMap((line: CostBreakdownLine) =>
                  line.meters.map((m, mi) => (
                    <TableRow key={`${line.service}-${m.dimension}-${mi}`}>
                      <TableCell>
                        {mi === 0 ? (
                          <Text weight="semibold">{line.display_name || line.service}</Text>
                        ) : (
                          ""
                        )}
                      </TableCell>
                      <TableCell>
                        {m.label || m.dimension}
                        {!m.priced && (
                          <Text className={styles.meterSub}> · {m.note || "unpriced"}</Text>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.billable_quantity !== undefined
                          ? `${m.billable_quantity} ${m.unit ?? ""}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {m.unit_price !== null && m.unit_price !== undefined
                          ? `$${m.unit_price}`
                          : "—"}
                      </TableCell>
                      <TableCell>{fmtUsd(m.monthly_cost)}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
            <div className={styles.totalRow}>
              <Text className={styles.meterSub}>
                {breakdown.summary
                  ? `${breakdown.summary.catalog_matched}/${breakdown.summary.total_lines} catalog-matched · ${breakdown.summary.unpriced_meters} unpriced meter(s)`
                  : ""}
              </Text>
              <Text size={500} weight="semibold">
                Total {fmtUsd(breakdown.total_monthly_estimate)}/mo
              </Text>
            </div>
          </Card>
        )}

        {recs && recs.recommendations.length > 0 && (
          <Card className={styles.itemsCard}>
            <div className={styles.reportHeader}>
              <Text size={500} weight="semibold">Recommendations</Text>
              <Badge appearance="filled" color="success">
                {fmtUsd(recs.total_monthly_savings)}/mo · {fmtUsd(recs.total_annual_savings)}/yr
              </Badge>
            </div>
            <Table size="small" aria-label="Cost recommendations">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Recommendation</TableHeaderCell>
                  <TableHeaderCell>Savings/mo</TableHeaderCell>
                  <TableHeaderCell>Confidence</TableHeaderCell>
                  <TableHeaderCell>Effort</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recs.recommendations.map((r: CostRecommendation) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div>
                        <Text weight="semibold">{r.title}</Text>
                        <Text className={styles.meterSub} as="p">{r.rationale}</Text>
                      </div>
                    </TableCell>
                    <TableCell>{fmtUsd(r.monthly_savings)}</TableCell>
                    <TableCell>
                      <Badge appearance="tint" color={confidenceColor(r.confidence)}>
                        {r.confidence}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.effort}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

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
