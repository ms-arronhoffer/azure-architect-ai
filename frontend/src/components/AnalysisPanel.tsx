import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
  ResizeRegular,
  LockShieldRegular,
  CheckmarkCircleRegular,
  ArrowClockwiseRegular,
  DocumentRegular,
  ChatRegular,
} from "@fluentui/react-icons";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import type { WafPillarResult, ChatMessage } from "../types";

interface JobStatus {
  status: "idle" | "running" | "done" | "error";
  events: unknown[];
}

type JobKey = "architecture" | "waf" | "sizing" | "security";

const JOB_META: Record<JobKey, { label: string; icon: JSX.Element }> = {
  architecture: { label: "Architecture Design", icon: <BuildingRegular /> },
  waf: { label: "WAF Assessment", icon: <ShieldCheckmarkRegular /> },
  sizing: { label: "Capacity Sizing", icon: <ResizeRegular /> },
  security: { label: "Security & Identity", icon: <LockShieldRegular /> },
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  header: {
    padding: "20px 28px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "6px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  progressGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  progressCard: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "16px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  progressCardRunning: {
    border: "1px solid #0078D4",
  },
  progressCardDone: {
    border: `1px solid ${tokens.colorStatusSuccessBorder1}`,
  },
  progressIcon: {
    fontSize: "20px",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    flexShrink: 0,
  },
  progressIconRunning: {
    color: "#0078D4",
  },
  progressIconDone: {
    color: tokens.colorStatusSuccessForeground1,
  },
  progressLabel: {
    fontWeight: 600,
    fontSize: "13px",
    flex: 1,
  },
  resultsArea: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    overflow: "hidden",
  },
  tabContent: {
    padding: "16px",
    overflowY: "auto",
    maxHeight: "60vh",
  },
  mdContent: {
    fontSize: "13px",
    lineHeight: 1.6,
    "& h1, & h2, & h3": { marginTop: "12px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, borderRadius: "6px", padding: "10px", overflowX: "auto" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px", textAlign: "left" },
  },
  pillarRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  pillarScore: {
    fontSize: "18px",
    fontWeight: 700,
    minWidth: "32px",
    textAlign: "right",
  },
  footer: {
    padding: "16px 28px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexShrink: 0,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px",
    gap: "16px",
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
});

const SCORE_COLOR = (score: number): "success" | "warning" | "danger" =>
  score >= 4 ? "success" : score >= 3 ? "warning" : "danger";

export default function AnalysisPanel({ onRefine }: { onRefine?: (context: ChatMessage[]) => void }) {
  const styles = useStyles();
  const { spec } = useWorkloadSpec();
  const [jobs, setJobs] = useState<Record<JobKey, JobStatus>>({
    architecture: { status: "idle", events: [] },
    waf: { status: "idle", events: [] },
    sizing: { status: "idle", events: [] },
    security: { status: "idle", events: [] },
  });
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<JobKey>("architecture");
  const [architectureText, setArchitectureText] = useState("");
  const [wafPillars, setWafPillars] = useState<WafPillarResult[]>([]);
  const [sizingText, setSizingText] = useState("");
  const [securityText, setSecurityText] = useState("");
  const [allDone, setAllDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleRun() {
    setIsRunning(true);
    setAllDone(false);
    setArchitectureText("");
    setWafPillars([]);
    setSizingText("");
    setSecurityText("");
    setJobs({
      architecture: { status: "running", events: [] },
      waf: { status: "running", events: [] },
      sizing: { status: "running", events: [] },
      security: { status: "running", events: [] },
    });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const requirements = toSpecPromptPrefix(spec) || spec.additionalNotes || "General Azure workload analysis.";

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements,
          constraints: spec.regulatoryNotes,
          region: spec.primaryRegion,
          compliance: spec.complianceFrameworks,
          budget_usd: spec.monthlyBudgetUsd,
        }),
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
            const job = obj._job as JobKey | undefined;

            if (obj.type === "analyze_status") {
              const j = obj.job as JobKey;
              setJobs((prev) => ({
                ...prev,
                [j]: { ...prev[j], status: obj.status },
              }));
            } else if (obj.type === "done") {
              setAllDone(true);
              setIsRunning(false);
            } else if (job === "architecture") {
              if (obj.type === "token") setArchitectureText((p) => p + obj.content);
              else if (obj.type === "runbook") setArchitectureText((p) => p + "\n\n### Runbook\n" + obj.markdown);
            } else if (job === "waf") {
              if (obj.type === "waf_pillar") setWafPillars((p) => [...p, obj.pillar]);
            } else if (job === "sizing") {
              if (obj.type === "token") setSizingText((p) => p + obj.content);
            } else if (job === "security") {
              if (obj.type === "token") setSecurityText((p) => p + obj.content);
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch {
      setIsRunning(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  function handleRefine() {
    if (!onRefine) return;
    const parts: string[] = [];
    if (architectureText) parts.push(`## Architecture Design\n\n${architectureText}`);
    if (wafPillars.length > 0) {
      const wafSummary = wafPillars.map((p) => `- **${p.pillar}**: ${p.score}/5 — ${p.recommendations.slice(0, 2).join(", ")}`).join("\n");
      parts.push(`## WAF Assessment\n\n${wafSummary}`);
    }
    if (sizingText) parts.push(`## Capacity Sizing\n\n${sizingText}`);
    if (securityText) parts.push(`## Security & Identity\n\n${securityText}`);
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: parts.join("\n\n") }]);
  }

  async function handleExportBrief() {
    const res = await fetch("/api/export/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workload_spec: {
          name: spec.name, type: spec.type, criticality: spec.criticality,
          primaryRegion: spec.primaryRegion, availabilitySla: spec.availabilitySla,
          rtoHours: spec.rtoHours, rpoHours: spec.rpoHours,
          complianceFrameworks: spec.complianceFrameworks,
          dataClassification: spec.dataClassification,
          monthlyBudgetUsd: spec.monthlyBudgetUsd, teamSize: spec.teamSize,
        },
        architecture_text: architectureText,
        waf_pillars: wafPillars,
        sizing_text: sizingText,
        security_text: securityText,
      }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name || "workload"}_architecture_brief.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const anyStarted = Object.values(jobs).some((j) => j.status !== "idle");

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <Text className={styles.title}>Workload Analysis</Text>
          {allDone && <Badge appearance="filled" color="success" size="small">Complete</Badge>}
        </div>
        <Text className={styles.subtitle}>
          {spec.name
            ? `Analyzing: ${spec.name} — runs Architecture, WAF, Sizing, and Security in parallel.`
            : "Fill out Requirements Studio first to get the most precise analysis."}
        </Text>
      </div>

      <div className={styles.body}>
        {anyStarted && (
          <div className={styles.progressGrid}>
            {(Object.keys(JOB_META) as JobKey[]).map((job) => {
              const meta = JOB_META[job];
              const status = jobs[job].status;
              return (
                <div
                  key={job}
                  className={`${styles.progressCard} ${status === "running" ? styles.progressCardRunning : ""} ${status === "done" ? styles.progressCardDone : ""}`}
                >
                  <span className={`${styles.progressIcon} ${status === "running" ? styles.progressIconRunning : ""} ${status === "done" ? styles.progressIconDone : ""}`}>
                    {status === "running" ? <Spinner size="tiny" /> : status === "done" ? <CheckmarkCircleRegular /> : meta.icon}
                  </span>
                  <Text className={styles.progressLabel}>{meta.label}</Text>
                  <Badge appearance="tint" color={status === "done" ? "success" : status === "running" ? "brand" : "subtle"} size="small">
                    {status === "done" ? "Done" : status === "running" ? "Running" : "Idle"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {anyStarted && (
          <div className={styles.resultsArea}>
            <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as JobKey)} style={{ padding: "8px 8px 0" }}>
              <Tab value="architecture">Architecture{jobs.architecture.status === "done" && <span className={styles.tabDot} />}</Tab>
              <Tab value="waf">WAF Assessment{jobs.waf.status === "done" && <span className={styles.tabDot} />}</Tab>
              <Tab value="sizing">Sizing{jobs.sizing.status === "done" && <span className={styles.tabDot} />}</Tab>
              <Tab value="security">Security{jobs.security.status === "done" && <span className={styles.tabDot} />}</Tab>
            </TabList>

            <div className={styles.tabContent}>
              {activeTab === "architecture" && (
                architectureText ? (
                  <div className={styles.mdContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{architectureText}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.architecture.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.architecture.status === "running" ? "Generating architecture design…" : "Architecture analysis not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "waf" && (
                wafPillars.length > 0 ? (
                  <div>
                    {wafPillars.map((p, i) => (
                      <div key={i} className={styles.pillarRow}>
                        <span className={styles.pillarScore} style={{ color: p.score >= 4 ? tokens.colorStatusSuccessForeground1 : p.score >= 3 ? tokens.colorStatusWarningForeground1 : tokens.colorStatusDangerForeground1 }}>
                          {p.score}/5
                        </span>
                        <div style={{ flex: 1 }}>
                          <Text weight="semibold" size={300}>{p.pillar}</Text>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                            {p.recommendations.slice(0, 3).map((r, j) => (
                              <Badge key={j} appearance="tint" color={SCORE_COLOR(p.score)} size="small">{r}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.waf.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.waf.status === "running" ? "Running WAF assessment…" : "WAF assessment not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "sizing" && (
                sizingText ? (
                  <div className={styles.mdContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{sizingText}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.sizing.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.sizing.status === "running" ? "Generating capacity sizing…" : "Sizing analysis not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "security" && (
                securityText ? (
                  <div className={styles.mdContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{securityText}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.security.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.security.status === "running" ? "Analyzing security posture…" : "Security analysis not started."}
                    </Text>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {!anyStarted && (
          <div className={styles.emptyState}>
            <BuildingRegular style={{ fontSize: "48px", opacity: 0.3 }} />
            <Text size={400} weight="semibold">Ready to analyze your workload</Text>
            <Text size={300}>Click "Run Analysis" to generate architecture design, WAF assessment, capacity sizing, and security posture simultaneously.</Text>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {isRunning ? (
          <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={handleCancel}>Cancel</Button>
        ) : (
          <Button appearance="primary" icon={<BuildingRegular />} onClick={handleRun} disabled={!spec.name && !spec.additionalNotes}>
            Run Analysis
          </Button>
        )}
        {isRunning && <Spinner size="small" label="Analyzing in parallel…" />}
        {allDone && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            {onRefine && (
              <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
                Refine in Chat
              </Button>
            )}
            <Button appearance="subtle" icon={<DocumentRegular />} onClick={handleExportBrief}>
              Export Brief
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
