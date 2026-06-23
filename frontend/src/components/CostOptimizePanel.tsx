import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  Dropdown,
  Option,
  SpinButton,
  Switch,
  Card,
  Divider,
  Tooltip,
} from "@fluentui/react-components";
import {
  PlayRegular,
  StopRegular,
  AddRegular,
  DeleteRegular,
  MoneyRegular,
  ArrowDownloadRegular,
  CalculatorRegular,
  SparkleRegular,
} from "@fluentui/react-icons";
import { apiFetch } from "../config/api";
import type {
  CostOptimization,
  CostCatalog,
  CatalogService,
  SkuListResponse,
  CalculatorEstimate,
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

interface CalcItem {
  service_key: string;
  sku: string;
  region: string;
  quantity: number;
  hours_per_month: number;
  buying_option: string;
  hybrid_benefit: boolean;
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
    gap: "10px",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  globalControls: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  controlField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: "140px",
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
    gap: "14px",
  },
  itemCard: {
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground1,
  },
  itemGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    alignItems: "flex-end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  itemFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  lineCost: {
    display: "flex",
    alignItems: "baseline",
    gap: "10px",
  },
  fullWidthDropdown: {
    minWidth: "unset",
    width: "100%",
  },
  totalsCard: {
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  totalsRow: {
    display: "flex",
    gap: "28px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  totalBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  grid: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeBase200,
  },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
  },
  thRight: {
    textAlign: "right",
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: "top",
  },
  tdRight: {
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  gridScroll: {
    overflowX: "auto",
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
  warnText: {
    color: tokens.colorPaletteDarkOrangeForeground1,
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

function fmtMoney(value: number | null | undefined, symbol: string): string {
  if (value === null || value === undefined) return "—";
  return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CostOptimizePanel() {
  const styles = useStyles();

  // ── Catalog + global settings ──────────────────────────────────────────────
  const [catalog, setCatalog] = useState<CostCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [defaultRegion, setDefaultRegion] = useState("eastus");

  // Per service+region SKU metadata cache.
  const [skuCache, setSkuCache] = useState<Record<string, SkuListResponse>>({});

  const [items, setItems] = useState<CalcItem[]>([]);
  const [estimate, setEstimate] = useState<CalculatorEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  // ── Deep optimization pipeline (streaming) ──────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<CostPhaseEvent[]>([]);
  const [result, setResult] = useState<CostOptimization | null>(null);
  const [resumable, setResumable] = useState<CostPipelineState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serviceMap = useMemo(() => {
    const m = new Map<string, CatalogService>();
    catalog?.services.forEach((s) => m.set(s.key, s));
    return m;
  }, [catalog]);

  const currencySymbol = estimate?.currency_symbol
    ?? catalog?.currencies.find((c) => c.code === currency)?.symbol
    ?? "$";

  function makeItem(svc: CatalogService, region: string): CalcItem {
    return {
      service_key: svc.key,
      sku: "",
      region,
      quantity: svc.default_quantity,
      hours_per_month: svc.default_hours,
      buying_option: "payg",
      hybrid_benefit: false,
    };
  }

  // ── Load catalog on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/cost/catalog");
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as CostCatalog;
        if (cancelled) return;
        setCatalog(data);
        const firstSvc = data.services[0];
        if (firstSvc) {
          setItems([
            {
              service_key: firstSvc.key,
              sku: "",
              region: "eastus",
              quantity: firstSvc.default_quantity,
              hours_per_month: firstSvc.default_hours,
              buying_option: "payg",
              hybrid_benefit: false,
            },
          ]);
        }
      } catch (err) {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : "Failed to load pricing catalog");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Lazy SKU fetch for a service+region ────────────────────────────────────
  const ensureSkus = useCallback(
    async (serviceKey: string, region: string): Promise<SkuListResponse | null> => {
      const key = `${serviceKey}|${region}`;
      if (skuCache[key]) return skuCache[key];
      try {
        const res = await apiFetch(
          `/api/cost/skus?service=${encodeURIComponent(serviceKey)}&region=${encodeURIComponent(region)}`,
        );
        if (!res.ok) return null;
        const data = (await res.json()) as SkuListResponse;
        setSkuCache((prev) => ({ ...prev, [key]: data }));
        return data;
      } catch {
        return null;
      }
    },
    [skuCache],
  );

  // Fetch SKUs for every item's service+region and default-select the first SKU.
  useEffect(() => {
    items.forEach((it, idx) => {
      const key = `${it.service_key}|${it.region}`;
      if (!skuCache[key]) {
        ensureSkus(it.service_key, it.region).then((data) => {
          if (data && !it.sku && data.skus[0]) {
            setItems((prev) =>
              prev.map((p, i) => (i === idx && !p.sku ? { ...p, sku: data.skus[0].name } : p)),
            );
          }
        });
      } else if (!it.sku && skuCache[key].skus[0]) {
        const firstName = skuCache[key].skus[0].name;
        setItems((prev) =>
          prev.map((p, i) => (i === idx && !p.sku ? { ...p, sku: firstName } : p)),
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, skuCache, ensureSkus]);

  // ── Live estimate (debounced) ──────────────────────────────────────────────
  const runEstimate = useCallback(async () => {
    const ready = items.filter((it) => it.service_key && it.sku);
    if (ready.length === 0) {
      setEstimate(null);
      return;
    }
    setIsEstimating(true);
    try {
      const res = await apiFetch("/api/cost/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, items: ready }),
      });
      if (res.ok) setEstimate((await res.json()) as CalculatorEstimate);
    } catch {
      /* ignore transient estimate errors */
    } finally {
      setIsEstimating(false);
    }
  }, [items, currency]);

  useEffect(() => {
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    estimateTimer.current = setTimeout(runEstimate, 350);
    return () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    };
  }, [runEstimate]);

  // ── Resumable deep-analysis state ──────────────────────────────────────────
  useEffect(() => {
    const state = loadCostState();
    setResumable(state ?? null);
  }, []);

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

  // ── Item mutation ──────────────────────────────────────────────────────────
  function patchItem(idx: number, patch: Partial<CalcItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function changeService(idx: number, serviceKey: string) {
    const svc = serviceMap.get(serviceKey);
    if (!svc) return;
    const region = items[idx]?.region ?? defaultRegion;
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              service_key: serviceKey,
              sku: "",
              quantity: svc.default_quantity,
              hours_per_month: svc.default_hours,
              buying_option: svc.eligible_options.includes(it.buying_option) ? it.buying_option : "payg",
              hybrid_benefit: svc.hybrid_benefit ? it.hybrid_benefit : false,
            }
          : it,
      ),
    );
    void ensureSkus(serviceKey, region);
  }

  function addItem() {
    const svc = catalog?.services[0];
    if (svc) setItems((prev) => [...prev, makeItem(svc, defaultRegion)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function applyGlobalRegion(region: string) {
    setDefaultRegion(region);
    setItems((prev) => prev.map((it) => ({ ...it, region, sku: "" })));
  }

  // ── Deep optimization run (streaming pipeline) ─────────────────────────────
  function optimizeRequestItems() {
    return items
      .filter((it) => it.service_key && it.sku)
      .map((it) => {
        const svc = serviceMap.get(it.service_key);
        return {
          service: svc?.retail_service_name ?? svc?.display ?? it.service_key,
          sku: it.sku,
          region: it.region,
          quantity: it.quantity,
          hours_per_month: it.hours_per_month,
        };
      });
  }

  function handleStopOptimize() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }

  async function handleOptimize() {
    const reqItems = optimizeRequestItems();
    if (reqItems.length === 0) return;
    setIsRunning(true);
    setEvents([]);
    setResult(null);
    clearCostState();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const reqBody = { items: reqItems, region: defaultRegion };
    const hash = hashCostRequest({ items: reqItems, region: defaultRegion });
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

  function exportCsv() {
    if (!estimate) return;
    const header = ["Service", "SKU", "Region", "Buying option", "Qty", "Unit price", "Monthly", "Annual", "Savings/mo"];
    const rows = estimate.line_items.map((ln) => [
      ln.service ?? ln.service_key,
      ln.sku_display ?? ln.sku,
      ln.region,
      ln.buying_option ?? "payg",
      String(ln.quantity ?? ""),
      String(ln.unit_price ?? ""),
      String(ln.monthly_cost ?? ""),
      String(ln.annual_cost ?? ""),
      String(ln.monthly_savings_vs_payg ?? ""),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `azure-cost-estimate-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (catalogError) {
    return (
      <div className={styles.root}>
        <div className={styles.body}>
          <Card className={styles.itemsCard}>
            <Text className={styles.warnText}>Could not load the pricing catalog: {catalogError}</Text>
          </Card>
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className={styles.root}>
        <div className={styles.body}>
          <Spinner label="Loading Azure pricing catalog…" />
        </div>
      </div>
    );
  }

  const optionsForFamily = (serviceKey: string) =>
    serviceMap.get(serviceKey)?.eligible_options ?? ["payg"];

  // Pre-compute which estimate line corresponds to each configured item index.
  let priceCursor = 0;
  const lineForItem: (CalculatorEstimate["line_items"][number] | undefined)[] = items.map((it) => {
    if (it.service_key && it.sku) {
      return estimate?.line_items[priceCursor++];
    }
    return undefined;
  });

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <CalculatorRegular fontSize={22} />
          <Text size={600} weight="semibold">Azure Pricing Calculator</Text>
        </div>
        <Text size={200}>
          Estimate Azure spend with regional pricing and every buying option (reserved, savings plan, spot,
          dev/test, hybrid benefit). Run a full optimization for carbon, rightsizing and break-even analysis.
        </Text>
        <div className={styles.globalControls}>
          <div className={styles.controlField}>
            <Text size={200} className={styles.fieldLabel}>Default region</Text>
            <Dropdown
              value={catalog.regions.find((r) => r.slug === defaultRegion)?.display ?? defaultRegion}
              selectedOptions={[defaultRegion]}
              onOptionSelect={(_, d) => d.optionValue && applyGlobalRegion(d.optionValue)}
            >
              {catalog.regions.map((r) => (
                <Option key={r.slug} value={r.slug} text={r.display}>
                  {r.display}
                </Option>
              ))}
            </Dropdown>
          </div>
          <div className={styles.controlField}>
            <Text size={200} className={styles.fieldLabel}>Currency</Text>
            <Dropdown
              value={currency}
              selectedOptions={[currency]}
              onOptionSelect={(_, d) => d.optionValue && setCurrency(d.optionValue)}
            >
              {catalog.currencies.map((c) => (
                <Option key={c.code} value={c.code} text={c.code}>
                  {c.code} ({c.symbol})
                </Option>
              ))}
            </Dropdown>
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {/* ── Line item configuration ── */}
        <Card className={styles.itemsCard}>
          <Text weight="semibold">Resources</Text>
          {items.map((it, idx) => {
            const svc = serviceMap.get(it.service_key);
            const skuKey = `${it.service_key}|${it.region}`;
            const skuData = skuCache[skuKey];
            const line = lineForItem[idx];
            return (
              <div key={idx} className={styles.itemCard}>
                <div className={styles.itemGrid}>
                  <div className={styles.field}>
                    <Text size={200} className={styles.fieldLabel}>Service</Text>
                    <Dropdown
                      className={styles.fullWidthDropdown}
                      value={svc?.display ?? ""}
                      selectedOptions={[it.service_key]}
                      onOptionSelect={(_, d) => d.optionValue && changeService(idx, d.optionValue)}
                    >
                      {catalog.services.map((s) => (
                        <Option key={s.key} value={s.key} text={s.display}>
                          {s.display}
                        </Option>
                      ))}
                    </Dropdown>
                  </div>

                  <div className={styles.field}>
                    <Text size={200} className={styles.fieldLabel}>Region</Text>
                    <Dropdown
                      className={styles.fullWidthDropdown}
                      value={catalog.regions.find((r) => r.slug === it.region)?.display ?? it.region}
                      selectedOptions={[it.region]}
                      onOptionSelect={(_, d) =>
                        d.optionValue && patchItem(idx, { region: d.optionValue, sku: "" })
                      }
                    >
                      {catalog.regions.map((r) => (
                        <Option key={r.slug} value={r.slug} text={r.display}>
                          {r.display}
                        </Option>
                      ))}
                    </Dropdown>
                  </div>

                  <div className={styles.field}>
                    <Text size={200} className={styles.fieldLabel}>SKU / tier</Text>
                    <Dropdown
                      className={styles.fullWidthDropdown}
                      disabled={!skuData}
                      value={skuData?.skus.find((s) => s.name === it.sku)?.display ?? it.sku}
                      selectedOptions={[it.sku]}
                      onOptionSelect={(_, d) => d.optionValue && patchItem(idx, { sku: d.optionValue })}
                    >
                      {(skuData?.skus ?? []).map((s) => (
                        <Option key={s.name} value={s.name} text={s.display}>
                          {s.display}
                        </Option>
                      ))}
                    </Dropdown>
                  </div>

                  <div className={styles.field}>
                    <Text size={200} className={styles.fieldLabel}>{svc?.quantity_label ?? "Quantity"}</Text>
                    <SpinButton
                      min={0}
                      value={it.quantity}
                      onChange={(_, d) => {
                        const v = d.value ?? Number(d.displayValue);
                        if (v !== undefined && !Number.isNaN(v)) patchItem(idx, { quantity: v });
                      }}
                    />
                  </div>

                  {svc?.unit === "hour" && (
                    <div className={styles.field}>
                      <Text size={200} className={styles.fieldLabel}>{svc?.usage_label ?? "Hours / month"}</Text>
                      <SpinButton
                        min={0}
                        max={744}
                        value={it.hours_per_month}
                        onChange={(_, d) => {
                          const v = d.value ?? Number(d.displayValue);
                          if (v !== undefined && !Number.isNaN(v)) patchItem(idx, { hours_per_month: v });
                        }}
                      />
                    </div>
                  )}

                  <div className={styles.field}>
                    <Text size={200} className={styles.fieldLabel}>Buying option</Text>
                    <Dropdown
                      className={styles.fullWidthDropdown}
                      value={catalog.buying_options.find((o) => o.key === it.buying_option)?.label ?? "Pay-as-you-go"}
                      selectedOptions={[it.buying_option]}
                      onOptionSelect={(_, d) => d.optionValue && patchItem(idx, { buying_option: d.optionValue })}
                    >
                      {catalog.buying_options
                        .filter((o) => optionsForFamily(it.service_key).includes(o.key))
                        .map((o) => (
                          <Option key={o.key} value={o.key} text={o.label}>
                            {o.label}
                          </Option>
                        ))}
                    </Dropdown>
                  </div>
                </div>

                <div className={styles.itemFooter}>
                  <div className={styles.controls}>
                    {svc?.hybrid_benefit && (
                      <Tooltip
                        content="Apply Azure Hybrid Benefit (reuse existing Windows Server / SQL licenses)"
                        relationship="label"
                      >
                        <Switch
                          checked={it.hybrid_benefit}
                          onChange={(_, d) => patchItem(idx, { hybrid_benefit: d.checked })}
                          label="Hybrid Benefit"
                        />
                      </Tooltip>
                    )}
                    {line?.option_downgraded && (
                      <Text size={200} className={styles.warnText}>
                        Buying option not available for this service — priced as pay-as-you-go.
                      </Text>
                    )}
                  </div>
                  <div className={styles.lineCost}>
                    {line ? (
                      <>
                        <Text size={400} weight="semibold">{fmtMoney(line.monthly_cost, currencySymbol)}</Text>
                        <Text size={200} className={styles.fieldLabel}>/mo</Text>
                        {(line.monthly_savings_vs_payg ?? 0) > 0 && (
                          <Badge appearance="tint" color="success">
                            save {fmtMoney(line.monthly_savings_vs_payg, currencySymbol)}/mo
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Text size={200} className={styles.fieldLabel}>Select a SKU…</Text>
                    )}
                    <Button
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      aria-label="Remove resource"
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div>
            <Button appearance="subtle" icon={<AddRegular />} onClick={addItem}>Add resource</Button>
          </div>
        </Card>

        {/* ── Totals + breakdown grid ── */}
        {estimate && estimate.line_items.length > 0 && (
          <Card className={styles.totalsCard}>
            <div className={styles.totalsRow}>
              <div className={styles.totalBlock}>
                <Text size={200} className={styles.fieldLabel}>Monthly total</Text>
                <Text size={700} weight="bold">{fmtMoney(estimate.total_monthly, currencySymbol)}</Text>
              </div>
              <div className={styles.totalBlock}>
                <Text size={200} className={styles.fieldLabel}>Annual total</Text>
                <Text size={600} weight="semibold">{fmtMoney(estimate.total_annual, currencySymbol)}</Text>
              </div>
              <div className={styles.totalBlock}>
                <Text size={200} className={styles.fieldLabel}>Pay-as-you-go</Text>
                <Text size={500}>{fmtMoney(estimate.total_payg_monthly, currencySymbol)}/mo</Text>
              </div>
              <div className={styles.totalBlock}>
                <Text size={200} className={styles.fieldLabel}>Savings vs PAYG</Text>
                <Text size={500} weight="semibold">
                  {fmtMoney(estimate.total_monthly_savings, currencySymbol)}/mo ({estimate.savings_pct}%)
                </Text>
              </div>
              {isEstimating && <Spinner size="tiny" />}
            </div>

            <div className={styles.gridScroll}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th className={styles.th}>Service</th>
                    <th className={styles.th}>SKU</th>
                    <th className={styles.th}>Region</th>
                    <th className={styles.th}>Option</th>
                    <th className={`${styles.th} ${styles.thRight}`}>Qty</th>
                    <th className={`${styles.th} ${styles.thRight}`}>Unit price</th>
                    <th className={`${styles.th} ${styles.thRight}`}>Monthly</th>
                    <th className={`${styles.th} ${styles.thRight}`}>Annual</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.line_items.map((ln, i) => (
                    <tr key={i}>
                      <td className={styles.td}>{ln.service ?? ln.service_key}</td>
                      <td className={styles.td}>
                        {ln.sku_display ?? ln.sku}
                        {ln.status === "unknown" && (
                          <Text size={100} className={styles.warnText}> · {ln.note ?? "unpriced"}</Text>
                        )}
                        {ln.hybrid_benefit_applied && (
                          <Badge appearance="tint" color="brand" size="small"> AHB</Badge>
                        )}
                      </td>
                      <td className={styles.td}>{ln.region}</td>
                      <td className={styles.td}>
                        {catalog.buying_options.find((o) => o.key === ln.buying_option)?.label ?? ln.buying_option}
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>{ln.quantity}</td>
                      <td className={`${styles.td} ${styles.tdRight}`}>{fmtMoney(ln.unit_price, currencySymbol)}</td>
                      <td className={`${styles.td} ${styles.tdRight}`}>{fmtMoney(ln.monthly_cost, currencySymbol)}</td>
                      <td className={`${styles.td} ${styles.tdRight}`}>{fmtMoney(ln.annual_cost, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.controls}>
              <Button appearance="secondary" size="small" icon={<ArrowDownloadRegular />} onClick={exportCsv}>
                Export CSV
              </Button>
              <Text size={100} className={styles.fieldLabel}>{estimate.source}</Text>
            </div>
          </Card>
        )}

        {/* ── Deep optimization ── */}
        <Card className={styles.itemsCard}>
          <div className={styles.controls}>
            <SparkleRegular />
            <Text weight="semibold">Full optimization analysis</Text>
          </div>
          <Text size={200} className={styles.fieldLabel}>
            7-phase pipeline: live pricing → carbon → reservations → rightsizing → break-even → narrated report.
            Reservation &amp; rightsizing phases use the active engagement&apos;s subscription when available.
          </Text>
          <div className={styles.controls}>
            {isRunning ? (
              <Button appearance="secondary" icon={<StopRegular />} onClick={handleStopOptimize}>Stop</Button>
            ) : (
              <Button
                appearance="primary"
                icon={<PlayRegular />}
                onClick={handleOptimize}
                disabled={items.filter((it) => it.service_key && it.sku).length === 0}
              >
                Run full optimization
              </Button>
            )}
            {isRunning && <Spinner size="tiny" />}
            {resumable && !isRunning && (
              <>
                <Text size={200}>Previous run available.</Text>
                <Button size="small" onClick={handleResume}>Resume</Button>
                <Button size="small" appearance="subtle" onClick={handleDiscardResume}>Discard</Button>
              </>
            )}
          </div>
          {events.length > 0 && (
            <>
              <Divider />
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
            </>
          )}
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
