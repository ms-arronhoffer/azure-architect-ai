import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  makeStyles,
  tokens,
  Button,
  Field,
  Input,
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
  CalendarRegular,
  ChatRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  OpenRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { exportDRBCToDocx } from "../utils/drbcDocxExport";
import { buildDiagramSrcdoc, downloadDiagramFile, openDiagramInDrawIo } from "../utils/diagramViewer";
import type { SseEvent, DrStrategy, ChatMessage, ConversationRecord, Mode, ProjectTimeline } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const DR_PATTERN_LABELS: Record<string, string> = {
  "hot-standby": "Hot Standby",
  "warm-standby": "Warm Standby",
  "cold-standby": "Cold Standby",
  "pilot-light": "Pilot Light",
  "multi-region-active": "Multi-Region Active/Active",
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
    minHeight: "150px",
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
  slaRow: { display: "flex", gap: "8px" },
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
  strategyHeader: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  prose: {
    "& p": { margin: "6px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, padding: "10px", borderRadius: "4px", overflowX: "auto" },
    "& ul, & ol": { paddingLeft: "20px" },
  },
  diagramContainer: { display: "flex", flexDirection: "column", height: "100%" },
  diagramActions: { display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" },
  diagramFrame: { flex: 1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "4px", minHeight: "480px" },
  dropOverlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 10,
    background: "rgba(0,120,212,0.08)",
    border: `2px dashed ${tokens.colorBrandBackground}`,
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none" as const,
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type DRBCTab = "strategy" | "runbook" | "rto-rpo" | "diagram" | "test-plan" | "gantt";

interface DRBCPanelProps {
  onRefine?: (context: ChatMessage[]) => void;
  sessionId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DRBCPanel({ onRefine, sessionId, onSave, initialSession }: DRBCPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { spec } = useWorkloadSpec();
  const [description, setDescription] = useState(() => toSpecPromptPrefix(spec));
  const [rto, setRto] = useState(() => spec.rtoHours > 0 ? String(spec.rtoHours) : "4");
  const [rpo, setRpo] = useState(() => spec.rpoHours > 0 ? String(spec.rpoHours) : "1");
  const [activeTab, setActiveTab] = useState<DRBCTab>("strategy");
  const [narrative, setNarrative] = useState("");
  const [drStrategy, setDrStrategy] = useState<DrStrategy | null>(null);
  const [diagramXml, setDiagramXml] = useState("");
  const [testPlan, setTestPlan] = useState("");
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [projectTimeline, setProjectTimeline] = useState<ProjectTimeline | null>(null);
  const [ganttHtml, setGanttHtml] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { narrative?: string; drStrategy?: DrStrategy; diagramXml?: string; testPlan?: string; projectTimeline?: ProjectTimeline };
    if (sr.narrative) setNarrative(sr.narrative);
    if (sr.drStrategy) setDrStrategy(sr.drStrategy);
    if (sr.diagramXml) setDiagramXml(sr.diagramXml);
    if (sr.testPlan) setTestPlan(sr.testPlan);
    if (sr.projectTimeline) setProjectTimeline(sr.projectTimeline);
  }, []);

  useEffect(() => {
    if (!projectTimeline?.diagramXml) return;
    setGanttHtml(buildDiagramSrcdoc(projectTimeline.diagramXml));
  }, [projectTimeline]);

  const hasResults = narrative.length > 0 || drStrategy !== null;

  async function handleDesign() {
    if (!description.trim() || isStreaming) return;
    setNarrative("");
    setDrStrategy(null);
    setProjectTimeline(null);
    setStatusMsg("");

    const enrichedReqs = `${description}\n\nRTO: ${rto} hours | RPO: ${rpo} hours`;
    let localNarrative = "";
    let localStrategy: DrStrategy | null = null;
    let localTimeline: ProjectTimeline | null = null;

    await stream(
      "/api/architecture",
      { requirements: enrichedReqs, mode: "drbc", existing_description: enrichedReqs },
      (event: SseEvent) => {
        if (event.type === "token") { localNarrative += event.content; setNarrative((n) => n + event.content); }
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "dr_strategy") { localStrategy = event.strategy; setDrStrategy(event.strategy); }
        if (event.type === "project_timeline") {
          const tl: ProjectTimeline = { phases: event.phases, total_weeks: event.total_weeks, notes: event.notes, diagramXml: event.xml };
          localTimeline = tl;
          setProjectTimeline(tl);
        }
      }
    );
    setStatusMsg("");
    setActiveTab("strategy");

    if (onSave && sessionId && (localNarrative || localStrategy)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: enrichedReqs },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(sessionId, "drbc", msgs, { narrative: localNarrative, drStrategy: localStrategy, diagramXml: "", testPlan: "", projectTimeline: localTimeline });
    }
  }

  async function generateDiagram() {
    if (deliverableStreaming) return;
    setGeneratingTab("diagram");
    setDiagramXml("");

    const context = `Design a DR/BC architecture diagram for this workload:\n\n${description}\n\nRTO: ${rto}h | RPO: ${rpo}h\n\nDR Pattern: ${drStrategy ? (DR_PATTERN_LABELS[drStrategy.dr_pattern] ?? drStrategy.dr_pattern) : "hot-standby"}\nPrimary: ${drStrategy?.primary_region ?? "East US"} → Secondary: ${drStrategy?.secondary_region ?? "West US"}`;

    await deliverableStream(
      "/api/architecture",
      { requirements: context, mode: "architecture", include_components: ["diagram"], pattern: "custom" },
      (event: SseEvent) => {
        if (event.type === "diagram") setDiagramXml(event.xml);
      }
    );
    setGeneratingTab(null);
    if (diagramXml) setActiveTab("diagram");
  }

  async function generateTestPlan() {
    if (deliverableStreaming || !drStrategy) return;
    setGeneratingTab("test-plan");
    setTestPlan("");

    const stratSummary = `Pattern: ${DR_PATTERN_LABELS[drStrategy.dr_pattern] ?? drStrategy.dr_pattern}\nPrimary: ${drStrategy.primary_region} → ${drStrategy.secondary_region}\nServices: ${drStrategy.service_configs.map((s) => s.service).join(", ")}`;

    const prompt = `You are an Azure reliability engineer. Generate a comprehensive DR test plan for the following DR strategy:

${stratSummary}

RTO Target: ${rto} hours | RPO Target: ${rpo} hours

Create a detailed test plan including:
1. **Pre-Test Prerequisites** — environment checks, notifications, rollback plan
2. **Failover Test Scenarios** — planned failover, unplanned failover, partial failures
3. **Per-Service Validation** — for each service: what to verify, acceptance criteria, rollback step
4. **RTO/RPO Validation** — how to measure and prove the targets are met
5. **Post-Test Cleanup** — failback steps, documentation, lessons learned

Format as a structured runbook with numbered steps.`;

    await deliverableStream(
      "/api/chat",
      { messages: [{ role: "user", content: prompt }], mode: "qa" },
      (event: SseEvent) => {
        if (event.type === "token") setTestPlan((prev) => prev + event.content);
      }
    );
    setGeneratingTab(null);
    setActiveTab("test-plan");
  }

  function handleRefine() {
    if (!onRefine) return;
    const stratSummary = drStrategy
      ? `**DR Pattern: ${DR_PATTERN_LABELS[drStrategy.dr_pattern] ?? drStrategy.dr_pattern}**\n${drStrategy.primary_region} → ${drStrategy.secondary_region}\n\n`
      : "";
    onRefine([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: stratSummary + narrative,
    }]);
  }

  async function handleExport() {
    await exportDRBCToDocx(drStrategy, {
      narrative: narrative || undefined,
      testPlan: testPlan || undefined,
      diagramAvailable: !!diagramXml,
    });
  }

  function renderStrategyTab() {
    if (!hasResults) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Describe your workload and SLA targets to generate a DR pattern recommendation and failover runbook.
          </Text>
          {!isStreaming && (
            <Button appearance="primary" onClick={handleDesign} disabled={!description.trim()}>
              Design DR Strategy
            </Button>
          )}
        </div>
      );
    }

    return (
      <div>
        {drStrategy && (
          <div style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "10px", padding: "16px", marginBottom: "16px", background: tokens.colorNeutralBackground1 }}>
            <div className={styles.strategyHeader}>
              <Badge appearance="filled" color="brand" size="large">
                {DR_PATTERN_LABELS[drStrategy.dr_pattern] ?? drStrategy.dr_pattern}
              </Badge>
              <Badge appearance="tint" color="informative">
                {drStrategy.primary_region} → {drStrategy.secondary_region}
              </Badge>
              {drStrategy.estimated_monthly_dr_cost && (
                <Badge appearance="tint" color="success">{drStrategy.estimated_monthly_dr_cost}/mo</Badge>
              )}
            </div>
            <div style={{ display: "flex", gap: "16px" }}>
              <div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }} block>RTO Target</Text>
                <Text size={400} weight="bold">{rto}h</Text>
              </div>
              <div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }} block>RPO Target</Text>
                <Text size={400} weight="bold">{rpo}h</Text>
              </div>
              <div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }} block>Services</Text>
                <Text size={400} weight="bold">{drStrategy.service_configs.length}</Text>
              </div>
              <div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }} block>Failover Steps</Text>
                <Text size={400} weight="bold">{drStrategy.failover_steps.length}</Text>
              </div>
            </div>
          </div>
        )}
        {narrative && (
          <div className={styles.prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  function renderRunbookTab() {
    if (!drStrategy?.failover_steps.length) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the DR design to generate a step-by-step failover runbook.
          </Text>
        </div>
      );
    }
    return (
      <div>
        <Text weight="semibold" size={400} block style={{ marginBottom: "12px" }}>Failover Runbook</Text>
        <ol style={{ paddingLeft: "20px" }}>
          {drStrategy.failover_steps.map((step, i) => (
            <li key={i} style={{ marginBottom: "8px" }}><Text size={300}>{step}</Text></li>
          ))}
        </ol>
        {drStrategy.test_plan.length > 0 && (
          <>
            <Text weight="semibold" size={400} block style={{ marginTop: "20px", marginBottom: "12px" }}>Quick Test Checklist</Text>
            <ul style={{ paddingLeft: "20px" }}>
              {drStrategy.test_plan.map((t, i) => <li key={i}><Text size={300}>{t}</Text></li>)}
            </ul>
          </>
        )}
      </div>
    );
  }

  function renderRtoRpoTab() {
    if (!drStrategy?.service_configs.length) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the DR design to see per-service RTO/RPO analysis.
          </Text>
        </div>
      );
    }
    return (
      <div>
        <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
          <div style={{ padding: "12px 20px", background: tokens.colorNeutralBackground3, borderRadius: "8px", textAlign: "center" }}>
            <Text size={500} weight="bold" block style={{ color: tokens.colorBrandForeground1 }}>{rto}h</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>RTO Target</Text>
          </div>
          <div style={{ padding: "12px 20px", background: tokens.colorNeutralBackground3, borderRadius: "8px", textAlign: "center" }}>
            <Text size={500} weight="bold" block style={{ color: tokens.colorBrandForeground1 }}>{rpo}h</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>RPO Target</Text>
          </div>
        </div>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Service</TableHeaderCell>
              <TableHeaderCell>DR Approach</TableHeaderCell>
              <TableHeaderCell>RPO Achieved</TableHeaderCell>
              <TableHeaderCell>Azure Feature</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drStrategy.service_configs.map((sc, i) => (
              <TableRow key={i}>
                <TableCell><Text size={200} weight="semibold">{sc.service}</Text></TableCell>
                <TableCell><Text size={200}>{sc.dr_approach}</Text></TableCell>
                <TableCell><Text size={200}>{sc.rpo_achieved ?? "—"}</Text></TableCell>
                <TableCell><Text size={200}>{sc.azure_feature ?? "—"}</Text></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderDiagramTab() {
    if (!diagramXml && generatingTab !== "diagram") {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Generate a draw.io diagram showing the DR topology with primary and secondary regions, failover paths, and data replication.
          </Text>
          <Button appearance="primary" size="small" onClick={generateDiagram} disabled={deliverableStreaming || !hasResults}>
            Generate DR Architecture Diagram
          </Button>
        </div>
      );
    }
    if (generatingTab === "diagram" && !diagramXml) {
      return <div className={styles.emptyTabHint}><Spinner size="small" /><Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Generating diagram…</Text></div>;
    }
    return (
      <div className={styles.diagramContainer}>
        <div className={styles.diagramActions}>
          <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={generateDiagram} disabled={deliverableStreaming}>Regenerate</Button>
          <Button size="small" appearance="outline" icon={<ArrowDownloadRegular />} onClick={() => downloadDiagramFile(diagramXml, "dr-architecture.drawio")}>Download (.drawio)</Button>
          <Button size="small" appearance="outline" icon={<OpenRegular />} onClick={() => openDiagramInDrawIo(diagramXml)}>Open in draw.io</Button>
        </div>
        <iframe srcDoc={buildDiagramSrcdoc(diagramXml)} className={styles.diagramFrame} sandbox="allow-scripts allow-same-origin" title="DR Architecture Diagram" />
      </div>
    );
  }

  function renderTestPlanTab() {
    if (!testPlan && generatingTab !== "test-plan") {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Generate a comprehensive DR test plan with failover scenarios, per-service validation, and RTO/RPO measurement.
          </Text>
          <Button appearance="primary" size="small" onClick={generateTestPlan} disabled={!drStrategy || deliverableStreaming}>
            Generate Test Plan
          </Button>
        </div>
      );
    }
    if (generatingTab === "test-plan" && !testPlan) {
      return <div className={styles.emptyTabHint}><Spinner size="small" /><Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Generating test plan…</Text></div>;
    }
    return (
      <div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={generateTestPlan} disabled={deliverableStreaming || !drStrategy}>Regenerate</Button>
        </div>
        <div className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{testPlan}</ReactMarkdown>
        </div>
      </div>
    );
  }

  function renderGanttTab() {
    if (!projectTimeline) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run the DR design to generate a project Gantt chart with phases, milestones, and critical path.
          </Text>
        </div>
      );
    }
    return (
      <div className={styles.diagramContainer}>
        <div className={styles.diagramActions}>
          <Button size="small" appearance="outline" icon={<ArrowDownloadRegular />} onClick={() => downloadDiagramFile(projectTimeline.diagramXml, "dr-timeline.drawio")}>Download (.drawio)</Button>
          <Button size="small" appearance="outline" icon={<OpenRegular />} onClick={() => openDiagramInDrawIo(projectTimeline.diagramXml)}>Open in draw.io</Button>
        </div>
        {ganttHtml && (
          <iframe srcDoc={ganttHtml} className={styles.diagramFrame} sandbox="allow-scripts allow-same-origin" title="DR Project Timeline" />
        )}
        {projectTimeline.notes && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "8px" }}>{projectTimeline.notes}</Text>
        )}
      </div>
    );
  }

  // Suppress unused-variable warning
  void cancelDeliverable;

  return (
    <div
      className={styles.panel}
      style={{ position: "relative" }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
    >
      {isDragging && <div className={styles.dropOverlay}><Text size={400} weight="semibold">Drop files to attach</Text></div>}
      <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
        {/* ── Left Sidebar ───────────────────────────────────────────────────── */}
        <Panel defaultSize="32%" minSize="15%" maxSize="65%">
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "16px", background: tokens.colorNeutralBackground1 }}>
            <Text weight="semibold" size={500}>DR/BC Design</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-10px" }}>
              Design a disaster recovery strategy with pattern recommendation, failover runbook, and test plan.
            </Text>

            <div>
              <span className={styles.sectionLabel}>Workload Description</span>
              <div className={styles.reqBox}>
                <textarea
                  className={styles.reqTextarea}
                  placeholder="Describe your workload: services, data stores, scale, criticality, and current availability setup…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.slaRow}>
              <Field label="RTO (hours)">
                <Input type="number" value={rto} onChange={(_, d) => setRto(d.value)} style={{ width: "100%" }} />
              </Field>
              <Field label="RPO (hours)">
                <Input type="number" value={rpo} onChange={(_, d) => setRpo(d.value)} style={{ width: "100%" }} />
              </Field>
            </div>

            {isStreaming ? (
              <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
            ) : (
              <Button appearance="primary" onClick={handleDesign} disabled={!description.trim()}>
                Design DR Strategy
              </Button>
            )}

            {statusMsg && (
              <div className={styles.status}>
                <Spinner size="tiny" />
                <span>{statusMsg}</span>
              </div>
            )}

            {hasResults && (
              <Button appearance="outline" icon={<DocumentRegular />} onClick={handleExport}>
                Export Report (.docx)
              </Button>
            )}

            {hasResults && onRefine && (
              <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
                Refine in Chat
              </Button>
            )}
          </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        {/* ── Right Panel ────────────────────────────────────────────────────── */}
        <Panel>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className={styles.tabBar}>
              <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as DRBCTab)} size="small">
                <Tab value="strategy">DR Strategy{hasResults && <span className={styles.tabDot} />}</Tab>
                <Tab value="runbook">Runbook{drStrategy && drStrategy.failover_steps.length > 0 && <span className={styles.tabDot} />}</Tab>
                <Tab value="rto-rpo">RTO/RPO{drStrategy && drStrategy.service_configs.length > 0 && <span className={styles.tabDot} />}</Tab>
                <Tab value="diagram">Diagram{diagramXml && <span className={styles.tabDot} />}</Tab>
                <Tab value="test-plan">Test Plan{testPlan && <span className={styles.tabDot} />}</Tab>
                <Tab value="gantt" icon={<CalendarRegular />}>Gantt{projectTimeline && <span className={styles.tabDot} />}</Tab>
              </TabList>
            </div>

            <div className={styles.tabContent}>
              {activeTab === "strategy" && renderStrategyTab()}
              {activeTab === "runbook" && renderRunbookTab()}
              {activeTab === "rto-rpo" && renderRtoRpoTab()}
              {activeTab === "diagram" && renderDiagramTab()}
              {activeTab === "test-plan" && renderTestPlanTab()}
              {activeTab === "gantt" && renderGanttTab()}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
