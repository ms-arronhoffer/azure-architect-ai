import { useState, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
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
} from "@fluentui/react-components";
import {
  ChatRegular,
  DocumentRegular,
  ArrowSyncRegular,
  MoneyRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { exportTCOToDocx } from "../utils/tcoDocxExport";
import type { SseEvent, TcoReport, ChatMessage, ConversationRecord, Mode } from "../types";

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
    minHeight: "110px",
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
  projCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "10px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    background: tokens.colorNeutralBackground1,
  },
  projRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "6px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  savingsHighlight: {
    background: "rgba(16,124,16,0.06)",
    border: "1px solid rgba(16,124,16,0.2)",
    borderRadius: "8px",
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "8px",
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type TcoTab = "summary" | "on-premises" | "azure-costs" | "projection" | "migration";

interface TCOPanelProps {
  onRefine?: (context: ChatMessage[]) => void;
  sessionId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TCOPanel({ onRefine, sessionId, onSave, initialSession }: TCOPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { spec } = useWorkloadSpec();
  const [description, setDescription] = useState(() => toSpecPromptPrefix(spec));
  const [numServers, setNumServers] = useState("");
  const [annualHardware, setAnnualHardware] = useState("");
  const [annualStorage, setAnnualStorage] = useState("");
  const [annualLicenses, setAnnualLicenses] = useState("");
  const [annualStaffing, setAnnualStaffing] = useState("");
  const [annualDatacenter, setAnnualDatacenter] = useState("");
  const [targetRegion, setTargetRegion] = useState("East US");
  const [optimizationProfile, setOptimizationProfile] = useState("Cloud-optimized");
  const [activeTab, setActiveTab] = useState<TcoTab>("summary");
  const [narrative, setNarrative] = useState("");
  const [tcoReport, setTcoReport] = useState<TcoReport | null>(null);
  const [migrationPlan, setMigrationPlan] = useState("");
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  void cancelDeliverable;

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { narrative?: string; tcoReport?: TcoReport; migrationPlan?: string };
    if (sr.narrative) setNarrative(sr.narrative);
    if (sr.tcoReport) setTcoReport(sr.tcoReport);
    if (sr.migrationPlan) setMigrationPlan(sr.migrationPlan);
  }, []);

  const hasResults = narrative.length > 0 || tcoReport !== null;

  function buildPrompt(): string {
    const parts = [description || "Existing on-premises infrastructure migration to Azure"];
    if (numServers) parts.push(`On-premises servers: ${numServers}`);
    if (annualHardware) parts.push(`Annual hardware & maintenance cost: $${annualHardware}`);
    if (annualStorage) parts.push(`Annual storage cost: $${annualStorage}`);
    if (annualLicenses) parts.push(`Annual software licenses cost: $${annualLicenses}`);
    if (annualStaffing) parts.push(`Annual IT staffing cost: $${annualStaffing}`);
    if (annualDatacenter) parts.push(`Annual datacenter/facilities cost: $${annualDatacenter}`);
    parts.push(`Target Azure region: ${targetRegion}`);
    parts.push(`Optimization profile: ${optimizationProfile}`);
    return parts.join("\n");
  }

  async function handleAnalyze() {
    if (isStreaming) return;
    setNarrative("");
    setTcoReport(null);
    setStatusMsg("");
    setActiveTab("summary");

    const prompt = buildPrompt();
    let localNarrative = "";
    let localReport: TcoReport | null = null;

    await stream(
      "/api/chat",
      { mode: "tco", messages: [{ role: "user", content: prompt }] },
      (event: SseEvent) => {
        if (event.type === "token") { localNarrative += event.content; setNarrative((n) => n + event.content); }
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "tco_report") { localReport = event.report; setTcoReport(event.report); }
      }
    );
    setStatusMsg("");

    if (onSave && sessionId && (localNarrative || localReport)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: prompt },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(sessionId, "tco", msgs, { narrative: localNarrative, tcoReport: localReport, migrationPlan: "" });
    }
  }

  async function generateMigrationPlan() {
    if (deliverableStreaming) return;
    setGeneratingTab("migration");
    setMigrationPlan("");

    const tcoContext = tcoReport
      ? `Migration cost estimate: ${tcoReport.migration_cost_estimate != null ? `$${tcoReport.migration_cost_estimate.toLocaleString()}` : "TBD"}\nBreak-even: Month ${tcoReport.break_even_months ?? "TBD"}\nAzure services: ${tcoReport.azure_items.map((i) => i.service).join(", ")}`
      : "";

    const prompt = `You are an Azure migration architect. Provide a detailed migration cost analysis and phased migration plan for the following workload:

${buildPrompt()}

${tcoContext}

Include:
1. **Discovery & Assessment Phase** — Azure Migrate, assessment tools, estimated cost and duration
2. **Migration Execution Costs** — Azure Database Migration Service, Site Recovery fees, bandwidth costs, temporary parallel-run costs
3. **Re-platforming Costs** — refactoring effort, any required code changes, training
4. **Phase 1: Quick Wins (0–3 months)** — low-risk lift-and-shift workloads, estimated cost
5. **Phase 2: Optimization (3–9 months)** — right-sizing, reserved instances, managed services adoption
6. **Phase 3: Cloud-Native (9–18 months)** — modernization, PaaS adoption, cost reduction targets
7. **Risk & Contingency** — rollback plan, buffer estimate (typically 15–20% contingency)
8. **ROI Timeline** — month-by-month break-even projection

Provide specific dollar estimates where possible.`;

    await deliverableStream(
      "/api/chat",
      { messages: [{ role: "user", content: prompt }], mode: "qa" },
      (event: SseEvent) => {
        if (event.type === "token") setMigrationPlan((prev) => prev + event.content);
      }
    );
    setGeneratingTab(null);
    setActiveTab("migration");
  }

  function handleRefine() {
    if (!onRefine) return;
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: `**TCO Analysis**\n\n${narrative}` }]);
  }

  async function handleExport() {
    await exportTCOToDocx(narrative, tcoReport, { migrationPlan: migrationPlan || undefined });
  }

  // ── Tab renderers ──────────────────────────────────────────────────────────

  function renderSummaryTab() {
    if (!hasResults && !isStreaming) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Enter your current infrastructure costs and target Azure region to generate a comprehensive TCO analysis.
          </Text>
          <Button appearance="primary" icon={<MoneyRegular />} onClick={handleAnalyze}>
            Run TCO Analysis
          </Button>
        </div>
      );
    }
    return (
      <div>
        {statusMsg && <div className={styles.status}><Spinner size="extra-tiny" />{statusMsg}</div>}
        {isStreaming && !statusMsg && <div className={styles.status}><Spinner size="extra-tiny" />Calculating total cost of ownership…</div>}
        {narrative.length > 0 && (
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
          </div>
        )}
        {hasResults && !isStreaming && (
          <Button appearance="subtle" icon={<ArrowSyncRegular />} onClick={handleAnalyze} style={{ alignSelf: "flex-start" }}>
            Regenerate
          </Button>
        )}
      </div>
    );
  }

  function renderOnPremisesTab() {
    if (!tcoReport?.on_prem_items?.length) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the TCO analysis to see your current on-premises cost breakdown.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" icon={<MoneyRegular />} onClick={handleAnalyze}>
              Run TCO Analysis
            </Button>
          )}
        </div>
      );
    }
    const annualTotal = tcoReport.on_prem_items.reduce((s, i) => s + i.annual_cost, 0);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px" }}>
          <Text size={600} weight="semibold">${annualTotal.toLocaleString()}</Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>/year on-premises total</Text>
        </div>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell>Annual Cost</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tcoReport.on_prem_items.map((item, i) => (
              <TableRow key={i}>
                <TableCell>{item.category}</TableCell>
                <TableCell>{item.description}</TableCell>
                <TableCell>${item.annual_cost.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderAzureCostsTab() {
    if (!tcoReport?.azure_items?.length) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the TCO analysis to see your projected Azure cost breakdown.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" icon={<MoneyRegular />} onClick={handleAnalyze}>
              Run TCO Analysis
            </Button>
          )}
        </div>
      );
    }
    const monthlyTotal = tcoReport.azure_items.reduce((s, i) => s + i.monthly_cost, 0);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px" }}>
          <Text size={600} weight="semibold">${monthlyTotal.toLocaleString()}</Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>/month projected Azure cost</Text>
          <Badge appearance="tint" color="brand">${(monthlyTotal * 12).toLocaleString()}/yr</Badge>
        </div>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Azure Service</TableHeaderCell>
              <TableHeaderCell>SKU / Tier</TableHeaderCell>
              <TableHeaderCell>Monthly Cost</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tcoReport.azure_items.map((item, i) => (
              <TableRow key={i}>
                <TableCell>{item.service}</TableCell>
                <TableCell>{item.sku}</TableCell>
                <TableCell>${item.monthly_cost.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderProjectionTab() {
    if (!tcoReport) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the TCO analysis to see the 3-year financial projection.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" icon={<MoneyRegular />} onClick={handleAnalyze}>
              Run TCO Analysis
            </Button>
          )}
        </div>
      );
    }
    return (
      <div>
        <div className={styles.projCard}>
          <Text weight="semibold" size={300}>3-Year Total Cost Comparison</Text>
          <div className={styles.projRow}>
            <Text size={300}>On-Premises (3 years)</Text>
            <Text size={400} weight="semibold">${tcoReport.three_year_on_prem_total.toLocaleString()}</Text>
          </div>
          <div className={styles.projRow}>
            <Text size={300}>Azure Cloud (3 years)</Text>
            <Text size={400} weight="semibold" style={{ color: tokens.colorBrandForeground1 }}>${tcoReport.three_year_azure_total.toLocaleString()}</Text>
          </div>
          {tcoReport.migration_cost_estimate != null && (
            <div className={styles.projRow}>
              <Text size={300}>Migration Cost (one-time)</Text>
              <Text size={400} weight="semibold">${tcoReport.migration_cost_estimate.toLocaleString()}</Text>
            </div>
          )}
        </div>

        {tcoReport.savings_percentage != null && (
          <div className={styles.savingsHighlight}>
            <div>
              <Text size={300} weight="semibold" style={{ color: "#107C10" }}>3-Year Cloud Savings</Text>
              <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                Total savings vs. continuing on-premises
              </Text>
            </div>
            <div style={{ textAlign: "right" }}>
              <Text size={600} weight="semibold" style={{ color: "#107C10" }}>{tcoReport.savings_percentage.toFixed(1)}%</Text>
              <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                ${(tcoReport.three_year_on_prem_total - tcoReport.three_year_azure_total).toLocaleString()} saved
              </Text>
            </div>
          </div>
        )}

        {tcoReport.break_even_months != null && (
          <div style={{ padding: "12px 16px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "8px", marginTop: "8px" }}>
            <Text size={300} weight="semibold">Break-Even Point</Text>
            <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3, marginTop: "4px" }}>
              Migration investment recovered by <strong>Month {tcoReport.break_even_months}</strong> (~{Math.ceil(tcoReport.break_even_months / 12)} year{tcoReport.break_even_months > 12 ? "s" : ""})
            </Text>
          </div>
        )}

        {tcoReport.recommendations.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <Text weight="semibold" size={300} style={{ display: "block", marginBottom: "8px" }}>Recommendations</Text>
            {tcoReport.recommendations.map((rec, i) => (
              <Text key={i} size={200} style={{ display: "block", padding: "3px 0" }}>• {rec}</Text>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderMigrationTab() {
    if (!migrationPlan && !deliverableStreaming) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Generate a phased migration cost analysis including discovery, execution, and optimization costs with a month-by-month ROI timeline.
          </Text>
          <Button
            appearance="primary"
            onClick={generateMigrationPlan}
            disabled={deliverableStreaming}
          >
            {generatingTab === "migration" ? <><Spinner size="extra-tiny" /> Analyzing…</> : "Generate Migration Cost Analysis"}
          </Button>
        </div>
      );
    }
    return (
      <div>
        {deliverableStreaming && generatingTab === "migration" && (
          <div className={styles.status}><Spinner size="extra-tiny" />Building migration cost analysis…</div>
        )}
        {migrationPlan.length > 0 && (
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{migrationPlan}</ReactMarkdown>
          </div>
        )}
        {migrationPlan && !deliverableStreaming && (
          <Button appearance="subtle" icon={<ArrowSyncRegular />} onClick={generateMigrationPlan} style={{ alignSelf: "flex-start" }}>
            Regenerate
          </Button>
        )}
      </div>
    );
  }

  function renderTabContent() {
    switch (activeTab) {
      case "summary": return renderSummaryTab();
      case "on-premises": return renderOnPremisesTab();
      case "azure-costs": return renderAzureCostsTab();
      case "projection": return renderProjectionTab();
      case "migration": return renderMigrationTab();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PanelGroup orientation="horizontal" style={{ height: "100%", overflow: "hidden" }}>
      {/* ── Left Sidebar ───────────────────────────────────────────────── */}
      <Panel defaultSize={28} minSize={18} maxSize={45}>
        <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "16px", background: tokens.colorNeutralBackground1 }}>
        <div>
          <Text weight="semibold" size={400}>TCO Analysis</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: "4px" }}>
            Compare on-premises costs to Azure to build a business case for cloud migration.
          </Text>
        </div>

        <div>
          <span className={styles.sectionLabel}>Current Environment</span>
          <div className={styles.reqBox}>
            <textarea
              className={styles.reqTextarea}
              placeholder="Describe your current infrastructure, workloads, and migration goals…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div>
          <span className={styles.sectionLabel}>On-Premises Costs (Annual USD)</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Field label="Number of servers">
              <Input type="number" placeholder="e.g. 20" value={numServers} onChange={(_, d) => setNumServers(d.value)} />
            </Field>
            <Field label="Hardware & maintenance">
              <Input type="number" placeholder="e.g. 150000" value={annualHardware} onChange={(_, d) => setAnnualHardware(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
            <Field label="Storage">
              <Input type="number" placeholder="e.g. 30000" value={annualStorage} onChange={(_, d) => setAnnualStorage(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
            <Field label="Software licenses">
              <Input type="number" placeholder="e.g. 60000" value={annualLicenses} onChange={(_, d) => setAnnualLicenses(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
            <Field label="IT staffing">
              <Input type="number" placeholder="e.g. 200000" value={annualStaffing} onChange={(_, d) => setAnnualStaffing(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
            <Field label="Datacenter & facilities">
              <Input type="number" placeholder="e.g. 40000" value={annualDatacenter} onChange={(_, d) => setAnnualDatacenter(d.value)} contentBefore={<Text>$</Text>} />
            </Field>
          </div>
        </div>

        <div>
          <span className={styles.sectionLabel}>Azure Target</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Field label="Primary region">
              <Select value={targetRegion} onChange={(_, d) => setTargetRegion(d.value)}>
                <option>East US</option>
                <option>East US 2</option>
                <option>West US</option>
                <option>West US 2</option>
                <option>West US 3</option>
                <option>Central US</option>
                <option>North Europe</option>
                <option>West Europe</option>
                <option>UK South</option>
                <option>Australia East</option>
                <option>Southeast Asia</option>
              </Select>
            </Field>
            <Field label="Optimization profile">
              <Select value={optimizationProfile} onChange={(_, d) => setOptimizationProfile(d.value)}>
                <option>Lift-and-shift</option>
                <option>Cloud-optimized</option>
                <option>Cloud-native</option>
              </Select>
            </Field>
          </div>
        </div>

        <Button
          appearance="primary"
          icon={isStreaming ? undefined : <MoneyRegular />}
          onClick={isStreaming ? cancel : handleAnalyze}
        >
          {isStreaming ? <><Spinner size="extra-tiny" /> Stop</> : "Run TCO Analysis"}
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
      </Panel>

      <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

      {/* ── Right Panel ─────────────────────────────────────────────────── */}
      <Panel>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className={styles.tabBar}>
          <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as TcoTab)}>
            <Tab value="summary">
              Summary{narrative && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="on-premises">
              On-Premises Costs{tcoReport?.on_prem_items?.length ? <span className={styles.tabDot} /> : null}
            </Tab>
            <Tab value="azure-costs">
              Azure Costs{tcoReport?.azure_items?.length ? <span className={styles.tabDot} /> : null}
            </Tab>
            <Tab value="projection">
              3-Year Projection{tcoReport && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="migration">
              Migration Costs{migrationPlan && <span className={styles.tabDot} />}
            </Tab>
          </TabList>
        </div>
        <div className={styles.tabContent}>
          {renderTabContent()}
        </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
