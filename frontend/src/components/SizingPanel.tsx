import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Field,
  Input,
  Select,
  Text,
  Spinner,
  Tab,
  TabList,
  Badge,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from "@fluentui/react-components";
import {
  ChatRegular,
  DocumentRegular,
  ArrowSyncRegular,
  ResizeRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { exportSizingToDocx } from "../utils/sizingDocxExport";
import type { SseEvent, SkuRecommendation, CostEstimate, ChatMessage } from "../types";

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  panel: { display: "flex", height: "100%", overflow: "hidden" },
  sidebar: {
    width: "340px",
    minWidth: "280px",
    padding: "20px 16px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    background: tokens.colorNeutralBackground1,
  },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    marginBottom: "7px",
    display: "block",
  },
  reqBox: {
    borderRadius: "10px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    boxShadow: "0 2px 10px rgba(0,0,0,0.13)",
    overflow: "hidden",
    transition: "border-color 0.15s",
    "&:focus-within": {
      border: `1px solid ${tokens.colorBrandStroke1}`,
      boxShadow: "0 2px 14px rgba(0,120,212,0.12)",
    },
  },
  reqTextarea: {
    display: "block",
    width: "100%",
    minHeight: "120px",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.65",
    color: tokens.colorNeutralForeground1,
  },
  row: { display: "flex", gap: "8px" },
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  tabBar: {
    padding: "8px 16px 0",
    background: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  tabContent: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: tokens.colorBrandBackground,
    marginLeft: "5px",
    verticalAlign: "middle",
  },
  emptyTabHint: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "48px 32px",
    textAlign: "center",
  },
  status: {
    color: tokens.colorBrandForeground1,
    fontSize: "13px",
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  prose: {
    "& p": { margin: "6px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, padding: "10px", borderRadius: "4px", overflowX: "auto" },
    "& ul, & ol": { paddingLeft: "20px" },
  },
  skuCard: {
    padding: "10px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  skuHeader: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginBottom: "4px",
    flexWrap: "wrap",
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type SizingTab = "recommendations" | "sku-matrix" | "cost-estimate" | "ri-savings";

interface SizingPanelProps {
  onRefine?: (context: ChatMessage[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SizingPanel({ onRefine }: SizingPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { spec } = useWorkloadSpec();
  const [description, setDescription] = useState(() => toSpecPromptPrefix(spec));
  const [peakUsers, setPeakUsers] = useState(() => spec.peakUsers > 0 ? String(spec.peakUsers) : "");
  const [avgRps, setAvgRps] = useState(() => spec.avgRps > 0 ? String(spec.avgRps) : "");
  const [dataVolume, setDataVolume] = useState(() => spec.dataVolumeGb > 0 ? String(spec.dataVolumeGb) : "");
  const [dataUnit, setDataUnit] = useState("GB");
  const [latencyP99, setLatencyP99] = useState(() => spec.latencyP99Ms > 0 ? String(spec.latencyP99Ms) : "");
  const [availability, setAvailability] = useState(() => spec.availabilitySla ? `${spec.availabilitySla}%` : "99.9%");
  const [budget, setBudget] = useState(() => spec.monthlyBudgetUsd > 0 ? String(spec.monthlyBudgetUsd) : "");
  const [activeTab, setActiveTab] = useState<SizingTab>("recommendations");
  const [narrative, setNarrative] = useState("");
  const [skuRec, setSkuRec] = useState<SkuRecommendation | null>(null);
  const [costEst, setCostEst] = useState<CostEstimate | null>(null);
  const [riSavings, setRiSavings] = useState("");
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  void cancelDeliverable;

  const hasResults = narrative.length > 0 || skuRec !== null || costEst !== null;

  async function handleAssess() {
    if (!description.trim() || isStreaming) return;
    setNarrative("");
    setSkuRec(null);
    setCostEst(null);
    setStatusMsg("");
    setActiveTab("recommendations");

    const parts = [description];
    if (peakUsers) parts.push(`Peak concurrent users: ${peakUsers}`);
    if (avgRps) parts.push(`Avg requests/second: ${avgRps}`);
    if (dataVolume) parts.push(`Data volume: ${dataVolume} ${dataUnit}`);
    if (latencyP99) parts.push(`Latency SLA p99: ${latencyP99}ms`);
    parts.push(`Target availability: ${availability}`);
    if (budget) parts.push(`Monthly budget constraint: $${budget}`);

    await stream(
      "/api/chat",
      { mode: "sizing", messages: [{ role: "user", content: parts.join("\n") }] },
      (event: SseEvent) => {
        if (event.type === "token") setNarrative((n) => n + event.content);
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "sku_recommendation") setSkuRec(event.recommendation);
        if (event.type === "cost_estimate") setCostEst(event.estimate);
      }
    );
    setStatusMsg("");
  }

  async function generateRiSavings() {
    if (deliverableStreaming || !skuRec) return;
    setGeneratingTab("ri-savings");
    setRiSavings("");

    const skuList = skuRec.recommendations.map((r) => `- ${r.component}: ${r.recommended_sku}`).join("\n");
    const prompt = `You are an Azure FinOps specialist. Analyze this Azure SKU configuration and provide a comprehensive Reserved Instance and Savings Plan analysis:

**Architecture:**
${description}

**SKU Configuration:**
${skuList}
${costEst ? `\n**Current PAYG Monthly Cost:** $${costEst.total_monthly_estimate.toLocaleString()}` : ""}

Provide a structured analysis covering:
1. **1-Year Reserved Instances** — eligible resources, estimated savings %, annual savings amount
2. **3-Year Reserved Instances** — eligible resources, estimated savings %, annual savings amount
3. **Azure Savings Plans** — compute savings plan vs. RI comparison, flexibility tradeoffs
4. **Hybrid Benefit Opportunities** — Windows Server / SQL Server license portability savings
5. **Dev/Test Pricing** — non-production workload discounts if applicable
6. **Recommended Commitment Strategy** — phased approach (start with high-confidence, long-running workloads)

Include specific percentage savings estimates for each category.`;

    await deliverableStream(
      "/api/chat",
      { messages: [{ role: "user", content: prompt }], mode: "qa" },
      (event: SseEvent) => {
        if (event.type === "token") setRiSavings((prev) => prev + event.content);
      }
    );
    setGeneratingTab(null);
    setActiveTab("ri-savings");
  }

  function handleRefine() {
    if (!onRefine) return;
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: `**Capacity Sizing Assessment**\n\n${narrative}` }]);
  }

  async function handleExport() {
    await exportSizingToDocx(narrative, skuRec, costEst, { riSavings: riSavings || undefined });
  }

  // ── Tab renderers ──────────────────────────────────────────────────────────

  function renderRecommendationsTab() {
    if (!hasResults && !isStreaming) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Describe your workload and performance targets to get right-sized Azure SKU recommendations.
          </Text>
          <Button appearance="primary" icon={<ResizeRegular />} onClick={handleAssess} disabled={!description.trim()}>
            Run Assessment
          </Button>
        </div>
      );
    }
    return (
      <div>
        {statusMsg && <div className={styles.status}><Spinner size="extra-tiny" />{statusMsg}</div>}
        {isStreaming && !statusMsg && <div className={styles.status}><Spinner size="extra-tiny" />Analyzing workload profile…</div>}
        {narrative.length > 0 && (
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
          </div>
        )}
        {hasResults && !isStreaming && (
          <Button appearance="subtle" icon={<ArrowSyncRegular />} onClick={handleAssess} style={{ alignSelf: "flex-start" }}>
            Regenerate
          </Button>
        )}
      </div>
    );
  }

  function renderSkuMatrixTab() {
    if (!skuRec) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the assessment to generate detailed SKU recommendations.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" icon={<ResizeRegular />} onClick={handleAssess} disabled={!description.trim()}>
              Run Assessment
            </Button>
          )}
        </div>
      );
    }
    return (
      <div>
        {skuRec.warnings?.length > 0 && (
          <div style={{ marginBottom: "12px", padding: "10px 12px", background: "rgba(220,130,0,0.08)", borderRadius: "6px", border: "1px solid rgba(220,130,0,0.3)" }}>
            {skuRec.warnings.map((w, i) => <Text key={i} size={200} style={{ display: "block" }}>⚠ {w}</Text>)}
          </div>
        )}
        {skuRec.recommendations.map((rec, i) => (
          <div key={i} className={styles.skuCard}>
            <div className={styles.skuHeader}>
              <Text size={300} weight="semibold">{rec.component}</Text>
              <Badge appearance="filled" color="brand">{rec.recommended_sku}</Badge>
              {rec.vcpu && <Badge appearance="tint" color="informative" size="small">{rec.vcpu} vCPU</Badge>}
              {rec.memory_gb && <Badge appearance="tint" color="informative" size="small">{rec.memory_gb} GB RAM</Badge>}
              {rec.utilization_target && <Badge appearance="tint" color="success" size="small">{rec.utilization_target}</Badge>}
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>{rec.reasoning}</Text>
            {rec.autoscale && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
                Autoscale: {rec.autoscale.min}–{rec.autoscale.max} instances · trigger: {rec.autoscale.scale_trigger}
              </Text>
            )}
            {rec.alternatives?.length > 0 && (
              <Accordion collapsible style={{ marginTop: "4px" }}>
                <AccordionItem value={`alt-${i}`}>
                  <AccordionHeader size="small">Alternatives ({rec.alternatives.length})</AccordionHeader>
                  <AccordionPanel>
                    {rec.alternatives.map((alt, j) => (
                      <div key={j} style={{ padding: "4px 0" }}>
                        <Badge appearance="outline" size="small">{alt.sku}</Badge>
                        <Text size={200}> · {alt.trade_off} · {alt.monthly_delta >= 0 ? "+" : ""}${alt.monthly_delta}/mo</Text>
                      </div>
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        ))}
        {skuRec.sizing_assumptions?.length > 0 && (
          <div style={{ marginTop: "12px", padding: "10px 12px", background: tokens.colorNeutralBackground2, borderRadius: "6px" }}>
            <Text size={200} weight="semibold" style={{ display: "block", marginBottom: "4px" }}>Sizing Assumptions</Text>
            {skuRec.sizing_assumptions.map((a, i) => <Text key={i} size={200} style={{ display: "block" }}>• {a}</Text>)}
          </div>
        )}
      </div>
    );
  }

  function renderCostEstimateTab() {
    if (!costEst) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the assessment to generate detailed cost estimates.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" icon={<ResizeRegular />} onClick={handleAssess} disabled={!description.trim()}>
              Run Assessment
            </Button>
          )}
        </div>
      );
    }
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px" }}>
          <Text size={600} weight="semibold">${costEst.total_monthly_estimate.toLocaleString()}</Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>/month estimated ({costEst.currency})</Text>
        </div>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Service</TableHeaderCell>
              <TableHeaderCell>SKU</TableHeaderCell>
              <TableHeaderCell>Quantity</TableHeaderCell>
              <TableHeaderCell>Monthly Est.</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costEst.line_items.map((item, i) => (
              <TableRow key={i}>
                <TableCell>{item.service}</TableCell>
                <TableCell>{item.sku}</TableCell>
                <TableCell>{item.quantity} {item.unit_of_measure}</TableCell>
                <TableCell>{item.monthly_estimate != null ? `$${item.monthly_estimate.toLocaleString()}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(costEst.optimization_tips?.length ?? 0) > 0 && (
          <div style={{ marginTop: "16px", padding: "10px 12px", background: tokens.colorNeutralBackground2, borderRadius: "6px" }}>
            <Text size={200} weight="semibold" style={{ display: "block", marginBottom: "6px" }}>Optimization Tips</Text>
            {costEst.optimization_tips?.map((tip, i) => <Text key={i} size={200} style={{ display: "block" }}>• {tip}</Text>)}
          </div>
        )}
        {costEst.disclaimer && (
          <Text size={100} style={{ color: tokens.colorNeutralForeground4, marginTop: "10px", display: "block", fontStyle: "italic" }}>
            {costEst.disclaimer}
          </Text>
        )}
      </div>
    );
  }

  function renderRiSavingsTab() {
    if (!riSavings && !deliverableStreaming) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Generate a Reserved Instance and Azure Savings Plan analysis to identify commitment-based cost reductions.
          </Text>
          <Button
            appearance="primary"
            onClick={generateRiSavings}
            disabled={!skuRec || deliverableStreaming}
          >
            {generatingTab === "ri-savings" ? <><Spinner size="extra-tiny" /> Analyzing…</> : "Generate RI Savings Analysis"}
          </Button>
          {!skuRec && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>
              Run the assessment first to generate SKU recommendations.
            </Text>
          )}
        </div>
      );
    }
    return (
      <div>
        {deliverableStreaming && generatingTab === "ri-savings" && (
          <div className={styles.status}><Spinner size="extra-tiny" />Analyzing savings opportunities…</div>
        )}
        {riSavings.length > 0 && (
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{riSavings}</ReactMarkdown>
          </div>
        )}
        {riSavings && !deliverableStreaming && (
          <Button appearance="subtle" icon={<ArrowSyncRegular />} onClick={generateRiSavings} style={{ alignSelf: "flex-start" }}>
            Regenerate
          </Button>
        )}
      </div>
    );
  }

  function renderTabContent() {
    switch (activeTab) {
      case "recommendations": return renderRecommendationsTab();
      case "sku-matrix": return renderSkuMatrixTab();
      case "cost-estimate": return renderCostEstimateTab();
      case "ri-savings": return renderRiSavingsTab();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.panel}>
      {/* ── Left Sidebar ───────────────────────────────────────────────── */}
      <div className={styles.sidebar}>
        <div>
          <Text weight="semibold" size={400}>Capacity Sizing</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: "4px" }}>
            Get right-sized Azure SKU recommendations for your performance and cost targets.
          </Text>
        </div>

        <div>
          <span className={styles.sectionLabel}>Architecture Description</span>
          <div className={styles.reqBox}>
            <textarea
              className={styles.reqTextarea}
              placeholder="e.g. Multi-tier web app: App Gateway → 3x App Service → Azure SQL Premium, Redis Cache…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div>
          <span className={styles.sectionLabel}>Performance Targets</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Field label="Peak concurrent users">
              <Input type="number" placeholder="e.g. 1000" value={peakUsers} onChange={(_, d) => setPeakUsers(d.value)} />
            </Field>
            <Field label="Avg requests/second">
              <Input type="number" placeholder="e.g. 250" value={avgRps} onChange={(_, d) => setAvgRps(d.value)} />
            </Field>
            <Field label="Data volume">
              <div className={styles.row}>
                <Input type="number" placeholder="e.g. 500" value={dataVolume} onChange={(_, d) => setDataVolume(d.value)} style={{ flex: 1 }} />
                <Select value={dataUnit} onChange={(_, d) => setDataUnit(d.value)} style={{ width: "72px" }}>
                  <option>GB</option>
                  <option>TB</option>
                </Select>
              </div>
            </Field>
            <Field label="Latency SLA p99 (ms)">
              <Input type="number" placeholder="e.g. 200" value={latencyP99} onChange={(_, d) => setLatencyP99(d.value)} />
            </Field>
            <Field label="Target availability">
              <Select value={availability} onChange={(_, d) => setAvailability(d.value)}>
                <option>99.5%</option>
                <option>99.9%</option>
                <option>99.95%</option>
                <option>99.99%</option>
              </Select>
            </Field>
            <Field label="Monthly budget (USD)">
              <Input type="number" placeholder="e.g. 5000" value={budget} onChange={(_, d) => setBudget(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
          </div>
        </div>

        <Button
          appearance="primary"
          icon={isStreaming ? undefined : <ResizeRegular />}
          onClick={isStreaming ? cancel : handleAssess}
          disabled={!description.trim() && !isStreaming}
        >
          {isStreaming ? <><Spinner size="extra-tiny" /> Stop</> : "Run Assessment"}
        </Button>

        {statusMsg && <div className={styles.status}><Spinner size="extra-tiny" />{statusMsg}</div>}

        {onRefine && hasResults && (
          <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
            Refine in Chat
          </Button>
        )}

        {hasResults && (
          <Button appearance="subtle" icon={<DocumentRegular />} onClick={handleExport}>
            Export DOCX
          </Button>
        )}
      </div>

      {/* ── Right Panel ─────────────────────────────────────────────────── */}
      <div className={styles.rightPanel}>
        <div className={styles.tabBar}>
          <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as SizingTab)}>
            <Tab value="recommendations">
              Recommendations{narrative && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="sku-matrix">
              SKU Matrix{skuRec && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="cost-estimate">
              Cost Estimate{costEst && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="ri-savings">
              RI Savings{riSavings && <span className={styles.tabDot} />}
            </Tab>
          </TabList>
        </div>
        <div className={styles.tabContent}>
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
