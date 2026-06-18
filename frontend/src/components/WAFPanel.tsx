import { useState, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Checkbox,
  Text,
  Spinner,
  Tab,
  TabList,
  Badge,
  ProgressBar,
} from "@fluentui/react-components";
import {
  ChatRegular,
  DocumentRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useFindingChecklist } from "../hooks/useFindingChecklist";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { exportWAFToDocx } from "../utils/wafDocxExport";
import type { SseEvent, WafPillarResult, ChatMessage, ConversationRecord, Mode } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const PILLAR_ORDER = ["reliability", "security", "cost", "operational-excellence", "performance"];

const PILLAR_LABELS: Record<string, string> = {
  reliability: "Reliability",
  security: "Security",
  cost: "Cost Optimization",
  "operational-excellence": "Operational Excellence",
  performance: "Performance Efficiency",
};

const PILLAR_SHORT: Record<string, string> = {
  reliability: "Reliability",
  security: "Security",
  cost: "Cost",
  "operational-excellence": "Operations",
  performance: "Performance",
};

const BADGE_COLOR: Record<number, "danger" | "warning" | "success"> = {
  1: "danger", 2: "danger", 3: "warning", 4: "success", 5: "success",
};

const SCORE_COLOR: Record<number, "error" | "warning" | "success"> = {
  1: "error", 2: "error", 3: "warning", 4: "success", 5: "success",
};

const SCORE_LABEL: Record<number, string> = {
  1: "Critical", 2: "Poor", 3: "Fair", 4: "Good", 5: "Excellent",
};

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
    minHeight: "160px",
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
  scoreCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: "8px",
  },
  summaryCell: {
    textAlign: "center",
    padding: "10px 4px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
  },
  pillarHeader: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    marginBottom: "16px",
    flexWrap: "wrap",
  },
  findingRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    marginBottom: "4px",
  },
  prose: {
    "& p": { margin: "6px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, padding: "10px", borderRadius: "4px", overflowX: "auto" },
    "& ul, & ol": { paddingLeft: "20px" },
  },
  divider: {
    height: "1px",
    background: tokens.colorNeutralStroke2,
    margin: "4px 0",
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type WafTab = "summary" | "reliability" | "security" | "cost" | "operational-excellence" | "performance" | "remediation";

interface WAFPanelProps {
  onRefine?: (context: ChatMessage[]) => void;
  conversationId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WAFPanel({ onRefine, conversationId, onSave, initialSession }: WAFPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { toggle, isResolved } = useFindingChecklist(conversationId ?? "waf");
  const { spec } = useWorkloadSpec();
  const [description, setDescription] = useState(() => toSpecPromptPrefix(spec));
  const [activeTab, setActiveTab] = useState<WafTab>("summary");
  const [pillars, setPillars] = useState<WafPillarResult[]>([]);
  const [remediationPlan, setRemediationPlan] = useState("");
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { pillars?: WafPillarResult[]; remediationPlan?: string };
    if (sr.pillars?.length) setPillars(sr.pillars);
    if (sr.remediationPlan) setRemediationPlan(sr.remediationPlan);
  }, []);

  const pillarMap = Object.fromEntries(pillars.map((p) => [p.pillar, p]));
  const avgScore = pillars.length > 0
    ? Math.round((pillars.reduce((s, p) => s + p.score, 0) / pillars.length) * 10) / 10
    : null;

  async function handleAssess() {
    if (!description.trim() || isStreaming) return;
    setPillars([]);
    setRemediationPlan("");
    setStatusMsg("");

    let localPillars: WafPillarResult[] = [];

    await stream(
      "/api/architecture",
      { requirements: description, mode: "waf", existing_description: description },
      (event: SseEvent) => {
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "waf_pillar") {
          localPillars = [...localPillars.filter((p) => p.pillar !== event.pillar.pillar), event.pillar];
          setPillars((prev) => {
            const exists = prev.find((p) => p.pillar === event.pillar.pillar);
            if (exists) return prev.map((p) => p.pillar === event.pillar.pillar ? event.pillar : p);
            return [...prev, event.pillar];
          });
        }
        if (event.type === "waf_complete") {
          localPillars = event.pillars;
          setPillars(event.pillars);
        }
      }
    );
    setStatusMsg("");
    setActiveTab("summary");

    if (onSave && conversationId && localPillars.length > 0) {
      const summary = localPillars.map((p) => `${p.pillar}: ${p.score}/5`).join(", ");
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: description },
        { id: crypto.randomUUID(), role: "assistant", content: `WAF Assessment: ${summary}` },
      ];
      onSave(conversationId, "waf", msgs, { pillars: localPillars, remediationPlan: "" });
    }
  }

  async function generateRemediation() {
    if (deliverableStreaming || pillars.length === 0) return;
    setGeneratingTab("remediation");
    setRemediationPlan("");

    const pillarSummary = pillars.map((p) =>
      `**${PILLAR_LABELS[p.pillar] ?? p.pillar}** (${p.score}/5): ${p.findings.slice(0, 3).join("; ")}${p.findings.length > 3 ? "…" : ""}`
    ).join("\n");

    const prompt = `You are an Azure solutions architect. Based on the following WAF assessment, generate a detailed remediation roadmap.

## WAF Assessment
${pillarSummary}

## Architecture Context
${description}

Generate a phased remediation roadmap:
- **Phase 1 (0–30 days): Quick Wins** — Low effort, high impact items from Critical/Poor pillars
- **Phase 2 (30–90 days): Core Improvements** — Medium effort items addressing Fair pillar gaps
- **Phase 3 (90+ days): Strategic Enhancements** — Architectural changes for long-term excellence

For each phase, include: objectives, specific Azure services to add/configure, implementation steps, success metrics.`;

    await deliverableStream(
      "/api/chat",
      { messages: [{ role: "user", content: prompt }], mode: "qa" },
      (event: SseEvent) => {
        if (event.type === "token") setRemediationPlan((prev) => prev + event.content);
      }
    );
    setGeneratingTab(null);
    setActiveTab("remediation");
  }

  function handleRefine() {
    if (!onRefine || pillars.length === 0) return;
    const summary = pillars.map((p) =>
      `**${PILLAR_LABELS[p.pillar] ?? p.pillar}**: ${p.score}/5\n- Findings: ${p.findings.join("; ")}\n- Recommendations: ${p.recommendations.map((r) => typeof r === "string" ? r : r.text).join("; ")}`
    ).join("\n\n");
    onRefine([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: `WAF Assessment Results (avg: ${avgScore}/5):\n\n${summary}`,
    }]);
  }

  async function handleExport() {
    await exportWAFToDocx(pillars, { remediationPlan: remediationPlan || undefined });
  }

  function renderPillarTab(pillarKey: string) {
    const p = pillarMap[pillarKey];
    if (!p) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the WAF assessment to see {PILLAR_LABELS[pillarKey]} results.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" size="small" onClick={handleAssess} disabled={!description.trim()}>
              Run Assessment
            </Button>
          )}
        </div>
      );
    }

    const resolved = p.findings.filter((f) => isResolved(f)).length;
    return (
      <div>
        <div className={styles.pillarHeader}>
          <Badge color={BADGE_COLOR[p.score] ?? "informative"} appearance="filled" size="large">
            {p.score}/5
          </Badge>
          <Text weight="semibold">{SCORE_LABEL[p.score] ?? ""}</Text>
          <div style={{ flex: 1, maxWidth: 200 }}>
            <ProgressBar value={p.score / 5} color={SCORE_COLOR[p.score] ?? "brand"} />
          </div>
          <Button size="small" appearance="subtle" icon={<ArrowSyncRegular />} onClick={handleAssess} disabled={isStreaming}>
            Reassess
          </Button>
        </div>

        {p.findings.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <Text weight="semibold" size={300}>Findings</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{resolved}/{p.findings.length} resolved</Text>
            </div>
            <ProgressBar value={p.findings.length > 0 ? resolved / p.findings.length : 0} color="success" style={{ marginBottom: "10px" }} />
            {p.findings.map((f, i) => (
              <div key={i} className={styles.findingRow}>
                <Checkbox
                  checked={isResolved(f)}
                  onChange={() => toggle(f)}
                  label={
                    <Text size={300} style={{ textDecoration: isResolved(f) ? "line-through" : "none", color: isResolved(f) ? tokens.colorNeutralForeground3 : undefined }}>
                      {f}
                    </Text>
                  }
                />
              </div>
            ))}
          </>
        )}

        {p.recommendations.length > 0 && (
          <>
            <div className={styles.divider} style={{ margin: "12px 0 8px" }} />
            <Text weight="semibold" size={300} block style={{ marginBottom: "8px" }}>Recommendations</Text>
            <ul style={{ marginTop: 0, paddingLeft: 16 }}>
              {p.recommendations.map((r, i) => {
                const text = typeof r === "string" ? r : r.text;
                const url = typeof r === "string" ? undefined : r.learn_url;
                return (
                  <li key={i}>
                    <Text size={300}>
                      {text}
                      {url && (
                        <> — <a href={url} target="_blank" rel="noopener noreferrer">Microsoft Docs ↗</a></>
                      )}
                    </Text>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    );
  }

  function renderSummaryTab() {
    if (pillars.length === 0) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Describe your architecture and run the assessment. All 5 WAF pillars will be evaluated independently.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" onClick={handleAssess} disabled={!description.trim()}>
              Run WAF Assessment
            </Button>
          )}
        </div>
      );
    }

    const totalFindings = pillars.reduce((s, p) => s + p.findings.length, 0);
    const totalResolved = pillars.reduce((s, p) => s + p.findings.filter((f) => isResolved(f)).length, 0);

    return (
      <div>
        <div className={styles.scoreCard} style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <Text size={600} weight="bold" style={{ color: tokens.colorBrandForeground1 }}>{avgScore}/5</Text>
            <Text size={400} weight="semibold">
              {avgScore !== null && avgScore >= 4 ? "Good" : avgScore !== null && avgScore >= 3 ? "Fair" : "Needs Attention"}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginLeft: "auto" }}>Overall WAF Score</Text>
          </div>
          <ProgressBar
            value={avgScore !== null ? avgScore / 5 : 0}
            color={avgScore !== null && avgScore >= 4 ? "success" : avgScore !== null && avgScore >= 3 ? "warning" : "error"}
          />
        </div>

        <div className={styles.summaryGrid}>
          {PILLAR_ORDER.map((key) => {
            const p = pillarMap[key];
            if (!p) return null;
            const bg = p.score >= 4 ? "#C8F0C8" : p.score >= 3 ? "#FFF3B0" : "#FFB3B3";
            return (
              <div key={key} className={styles.summaryCell} style={{ background: bg }} onClick={() => setActiveTab(key as WafTab)}>
                <Text size={500} weight="bold" block>{p.score}/5</Text>
                <Text size={200} block style={{ marginTop: "4px" }}>{PILLAR_SHORT[key]}</Text>
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{p.findings.length} finding{p.findings.length !== 1 ? "s" : ""}</Text>
              </div>
            );
          })}
        </div>

        {totalFindings > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <Text size={300} weight="semibold">Overall Finding Progress</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{totalResolved}/{totalFindings} resolved</Text>
            </div>
            <ProgressBar value={totalResolved / totalFindings} color="success" />
          </div>
        )}
      </div>
    );
  }

  function renderRemediationTab() {
    if (!remediationPlan && generatingTab !== "remediation") {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Generate a phased remediation roadmap (0–30d, 30–90d, 90d+) based on WAF findings.
          </Text>
          <Button appearance="primary" size="small" onClick={generateRemediation} disabled={pillars.length === 0 || deliverableStreaming}>
            Generate Remediation Roadmap
          </Button>
        </div>
      );
    }
    if (generatingTab === "remediation" && !remediationPlan) {
      return (
        <div className={styles.emptyTabHint}>
          <Spinner size="small" />
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Generating roadmap…</Text>
        </div>
      );
    }
    return (
      <div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={generateRemediation} disabled={deliverableStreaming || pillars.length === 0}>
            Regenerate
          </Button>
        </div>
        <div className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{remediationPlan}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // Suppress unused-variable warnings for cancelDeliverable
  void cancelDeliverable;

  return (
    <PanelGroup orientation="horizontal" style={{ height: "100%", overflow: "hidden" }}>
      {/* ── Left Sidebar ─────────────────────────────────────────────────────── */}
      <Panel defaultSize="32%" minSize="15%" maxSize="65%">
        <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "16px", background: tokens.colorNeutralBackground1 }}>
        <Text weight="semibold" size={500}>WAF Assessment</Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-10px" }}>
          Evaluate your architecture against all 5 Azure Well-Architected Framework pillars.
        </Text>

        <div>
          <span className={styles.sectionLabel}>Architecture Description</span>
          <div className={styles.reqBox}>
            <textarea
              className={styles.reqTextarea}
              placeholder="Describe your existing or planned Azure architecture. Include services used, networking topology, data flows, and any compliance requirements…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {isStreaming ? (
          <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop Assessment</Button>
        ) : (
          <Button appearance="primary" onClick={handleAssess} disabled={!description.trim()}>
            Run WAF Assessment
          </Button>
        )}

        {statusMsg && (
          <div className={styles.status}>
            <Spinner size="tiny" />
            <span>{statusMsg}</span>
          </div>
        )}

        {avgScore !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Overall Score</Text>
            <Badge color={avgScore >= 4 ? "success" : avgScore >= 3 ? "warning" : "danger"} appearance="filled" size="large">
              {avgScore}/5
            </Badge>
          </div>
        )}

        {pillars.length > 0 && (
          <Button appearance="outline" icon={<DocumentRegular />} onClick={handleExport}>
            Export Report (.docx)
          </Button>
        )}

        {pillars.length > 0 && onRefine && (
          <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
            Refine in Chat
          </Button>
        )}
        </div>
      </Panel>

      <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

      {/* ── Right Panel ──────────────────────────────────────────────────────── */}
      <Panel>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className={styles.tabBar}>
          <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as WafTab)} size="small">
            <Tab value="summary">Summary{pillars.length > 0 && <span className={styles.tabDot} />}</Tab>
            <Tab value="reliability">{PILLAR_SHORT["reliability"]}{pillarMap["reliability"] && <span className={styles.tabDot} />}</Tab>
            <Tab value="security">{PILLAR_SHORT["security"]}{pillarMap["security"] && <span className={styles.tabDot} />}</Tab>
            <Tab value="cost">{PILLAR_SHORT["cost"]}{pillarMap["cost"] && <span className={styles.tabDot} />}</Tab>
            <Tab value="operational-excellence">{PILLAR_SHORT["operational-excellence"]}{pillarMap["operational-excellence"] && <span className={styles.tabDot} />}</Tab>
            <Tab value="performance">{PILLAR_SHORT["performance"]}{pillarMap["performance"] && <span className={styles.tabDot} />}</Tab>
            <Tab value="remediation">Remediation{remediationPlan && <span className={styles.tabDot} />}</Tab>
          </TabList>
        </div>

        <div className={styles.tabContent}>
          {activeTab === "summary" && renderSummaryTab()}
          {activeTab === "reliability" && renderPillarTab("reliability")}
          {activeTab === "security" && renderPillarTab("security")}
          {activeTab === "cost" && renderPillarTab("cost")}
          {activeTab === "operational-excellence" && renderPillarTab("operational-excellence")}
          {activeTab === "performance" && renderPillarTab("performance")}
          {activeTab === "remediation" && renderRemediationTab()}
        </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
