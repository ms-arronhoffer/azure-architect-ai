import { useState, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  TabList,
  Tab,
  Select,
  Badge,
} from "@fluentui/react-components";
import { SendRegular, ChatRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, SloFramework, SloService, BurnRateAlert, ConversationRecord, Mode } from "../types";

type RlTab = "overview" | "slo" | "fmea" | "chaos" | "monitoring" | "toil";

const SLA_OPTIONS = ["99.0%", "99.5%", "99.9%", "99.95%", "99.99%"];
const CRITICALITY_OPTIONS = ["Low", "Medium", "High", "Mission Critical"];

const useStyles = makeStyles({
  panel: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  layout: { display: "flex", flex: 1, overflow: "hidden" },
  sidebar: {
    width: "340px",
    minWidth: "280px",
    flexShrink: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    padding: "20px 16px",
    gap: "14px",
    overflowY: "auto",
  },
  right: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  tabBar: {
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  tabContent: { flex: 1, overflowY: "auto", padding: "20px" },
  label: {
    fontWeight: 600,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    marginBottom: "4px",
    display: "block",
  },
  reqBox: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "8px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: "100px",
    lineHeight: "1.5",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  divider: { height: "1px", background: tokens.colorNeutralStroke2, margin: "2px 0" },
  statusText: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  mdContent: {
    fontSize: "13px",
    lineHeight: 1.6,
    "& h1, & h2, & h3": { marginTop: "12px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px" },
  },
  emptyTab: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "120px",
    color: tokens.colorNeutralForeground3,
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
  sloTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
  },
  sloTh: {
    padding: "8px 10px",
    textAlign: "left" as const,
    fontWeight: 600,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
  },
  sloTd: {
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: "top" as const,
  },
  alertCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "8px",
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
  },
  listItem: {
    padding: "8px 0",
    fontSize: "13px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
  compositeSla: {
    background: "rgba(0, 120, 212, 0.08)",
    border: "1px solid rgba(0, 120, 212, 0.25)",
    borderRadius: "8px",
    padding: "12px 16px",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
});

function SloTable({ services, styles }: { services: SloService[]; styles: ReturnType<typeof useStyles> }) {
  return (
    <table className={styles.sloTable}>
      <thead>
        <tr>
          <th className={styles.sloTh}>Service</th>
          <th className={styles.sloTh}>Azure SLA</th>
          <th className={styles.sloTh}>Customer SLO</th>
          <th className={styles.sloTh}>Error Budget (min/mo)</th>
          <th className={styles.sloTh}>SLI Definition</th>
        </tr>
      </thead>
      <tbody>
        {services.map((s, i) => (
          <tr key={i}>
            <td className={styles.sloTd}><Text weight="semibold" size={200}>{s.name}</Text></td>
            <td className={styles.sloTd}><Badge appearance="tint" color="informative" size="small">{s.azure_sla}</Badge></td>
            <td className={styles.sloTd}><Badge appearance="filled" color="brand" size="small">{s.customer_slo}</Badge></td>
            <td className={styles.sloTd}><Text size={200}>{s.error_budget_minutes.toLocaleString()}</Text></td>
            <td className={styles.sloTd}><Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{s.sli_definition}</Text></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlertCard({ alert, styles }: { alert: BurnRateAlert; styles: ReturnType<typeof useStyles> }) {
  return (
    <div className={styles.alertCard}>
      <Badge appearance="filled" color="warning" size="medium">{alert.burn_rate}x</Badge>
      <div>
        <Text weight="semibold" size={200} block>{alert.window} window</Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{alert.description}</Text>
      </div>
    </div>
  );
}

export default function ReliabilityPanel({ onRefine, sessionId, onSave, initialSession }: {
  onRefine?: (context: ChatMessage[]) => void;
  sessionId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [workloadDescription, setWorkloadDescription] = useState("");
  const [targetSla, setTargetSla] = useState("99.9%");
  const [criticality, setCriticality] = useState("High");

  const [activeTab, setActiveTab] = useState<RlTab>("overview");
  const [narrative, setNarrative] = useState("");
  const [framework, setFramework] = useState<SloFramework | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { narrative?: string; framework?: SloFramework };
    if (sr.narrative) setNarrative(sr.narrative);
    if (sr.framework) setFramework(sr.framework);
  }, []);

  async function handleRun() {
    if (!workloadDescription.trim() || isStreaming) return;
    setNarrative("");
    setFramework(null);
    setStatusMsg("");
    setActiveTab("overview");

    const prompt = [
      `Workload Description: ${workloadDescription}`,
      `Target Availability SLA: ${targetSla}`,
      `Criticality: ${criticality}`,
    ].join("\n");

    let localNarrative = "";
    let localFramework: SloFramework | null = null;

    await stream("/api/chat", { mode: "reliability", message: prompt }, (event) => {
      if (event.type === "token") { localNarrative += event.content; setNarrative((p) => p + event.content); }
      if (event.type === "slo_framework") { localFramework = event.framework; setFramework(event.framework); }
      if (event.type === "status") setStatusMsg(event.message);
    });
    setStatusMsg("");

    if (onSave && sessionId && (localNarrative || localFramework)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: prompt },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(sessionId, "reliability", msgs, { narrative: localNarrative, framework: localFramework });
    }
  }

  function handleRefine() {
    if (!onRefine || !narrative) return;
    const parts: string[] = [`## Reliability Overview\n\n${narrative}`];
    if (framework?.services.length) {
      const sloSummary = framework.services
        .map((s) => `- **${s.name}**: Azure SLA ${s.azure_sla} → Customer SLO ${s.customer_slo} (${s.error_budget_minutes.toLocaleString()} min/mo error budget)`)
        .join("\n");
      parts.push(`## SLO Framework\n\nComposite SLA: **${framework.composite_sla}**\n\n${sloSummary}`);
    }
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: parts.join("\n\n") }]);
  }

  const hasSlo = (framework?.services?.length ?? 0) > 0;
  const hasChaos = (framework?.chaos_experiments?.length ?? 0) > 0;
  const hasToil = (framework?.toil_inventory?.length ?? 0) > 0;
  const hasAlerts = (framework?.error_budget_alerts?.length ?? 0) > 0;

  return (
    <div className={styles.panel}>
      <PanelGroup orientation="horizontal" style={{ height: "100%", overflow: "hidden" }}>
        <Panel defaultSize={28} minSize={18} maxSize={45}>
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1, display: "flex", flexDirection: "column", gap: "14px" }}>
          <Text weight="semibold" size={400}>Reliability & SLO</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-8px" }}>
            SLO Design, FMEA & Chaos Engineering
          </Text>
          <div className={styles.divider} />

          <div>
            <label className={styles.label}>Workload Description *</label>
            <textarea
              className={styles.reqBox}
              value={workloadDescription}
              onChange={(e) => setWorkloadDescription(e.target.value)}
              placeholder="e.g. E-commerce platform with product catalog, cart, payment processing, and order management. Serves 500k users/day..."
              disabled={isStreaming}
            />
          </div>

          <div>
            <label className={styles.label}>Target Availability SLA</label>
            <Select value={targetSla} onChange={(_, d) => setTargetSla(d.value)} disabled={isStreaming}>
              {SLA_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>

          <div>
            <label className={styles.label}>Workload Criticality</label>
            <Select value={criticality} onChange={(_, d) => setCriticality(d.value)} disabled={isStreaming}>
              {CRITICALITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          <div className={styles.divider} />

          {isStreaming ? (
            <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
          ) : (
            <Button appearance="primary" icon={<SendRegular />} onClick={handleRun} disabled={!workloadDescription.trim()}>
              Design Reliability
            </Button>
          )}

          {statusMsg && <Text className={styles.statusText}>{statusMsg}</Text>}

          {narrative && !isStreaming && onRefine && (
            <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
              Refine in Chat
            </Button>
          )}
        </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        <Panel>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className={styles.tabBar}>
            <TabList
              selectedValue={activeTab}
              onTabSelect={(_, d) => setActiveTab(d.value as RlTab)}
              size="small"
            >
              <Tab value="overview">Overview{narrative && <span className={styles.tabDot} />}</Tab>
              <Tab value="slo">SLO Design{hasSlo && <span className={styles.tabDot} />}</Tab>
              <Tab value="fmea">Failure Mode Analysis{narrative && <span className={styles.tabDot} />}</Tab>
              <Tab value="chaos">Chaos Engineering{hasChaos && <span className={styles.tabDot} />}</Tab>
              <Tab value="monitoring">Monitoring & Alerts{hasAlerts && <span className={styles.tabDot} />}</Tab>
              <Tab value="toil">Toil Inventory{hasToil && <span className={styles.tabDot} />}</Tab>
            </TabList>
          </div>

          <div className={styles.tabContent}>
            {activeTab === "overview" && (
              narrative ? (
                <div className={styles.mdContent}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Designing reliability framework…" : "Describe your workload and click Design Reliability."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "slo" && (
              hasSlo ? (
                <div>
                  {framework!.composite_sla && (
                    <div className={styles.compositeSla}>
                      <Text weight="semibold" size={300}>Composite SLA:</Text>
                      <Badge appearance="filled" color="brand" size="large">{framework!.composite_sla}</Badge>
                    </div>
                  )}
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Service SLO Targets</Text>
                  <SloTable services={framework!.services} styles={styles} />
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Calculating SLO targets…" : "Run Design Reliability to see SLO framework."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "fmea" && (
              narrative ? (
                <div className={styles.mdContent}>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Failure Mode & Effects Analysis</Text>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    See the Overview tab for the full FMEA narrative generated by the reliability analysis.
                  </Text>
                  <div style={{ marginTop: "16px" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {narrative.split("##").find((s) => s.toLowerCase().includes("failure") || s.toLowerCase().includes("fmea"))
                        ? `##${narrative.split("##").find((s) => s.toLowerCase().includes("failure") || s.toLowerCase().includes("fmea"))}`
                        : "*FMEA details are included in the Overview narrative above.*"}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Analyzing failure modes…" : "Run Design Reliability to see FMEA."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "chaos" && (
              hasChaos ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Chaos Engineering Experiments</Text>
                  {framework!.chaos_experiments.map((exp, i) => (
                    <div key={i} className={styles.listItem}>
                      <Badge appearance="filled" color="danger" size="small" style={{ marginTop: "2px", flexShrink: 0 }}>{i + 1}</Badge>
                      <Text size={200}>{exp}</Text>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Designing chaos experiments…" : "Run Design Reliability to see chaos experiments."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "monitoring" && (
              hasAlerts ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Error Budget Burn Rate Alerts</Text>
                  {framework!.error_budget_alerts.map((alert, i) => (
                    <AlertCard key={i} alert={alert} styles={styles} />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Configuring alert thresholds…" : "Run Design Reliability to see monitoring config."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "toil" && (
              hasToil ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Toil Inventory</Text>
                  {framework!.toil_inventory.map((item, i) => (
                    <div key={i} className={styles.listItem}>
                      <Badge appearance="tint" color="warning" size="small" style={{ marginTop: "2px", flexShrink: 0 }}>{i + 1}</Badge>
                      <Text size={200}>{item}</Text>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Cataloging operational toil…" : "Run Design Reliability to see toil inventory."}
                  </Text>
                </div>
              )
            )}
          </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
