import { useState, useRef, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Tab,
  TabList,
  Tooltip,
  Select,
  Label,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  CodeRegular,
  MoneyRegular,
  ChatRegular,
  DocumentRegular,
  BookOpenRegular,
  SparkleRegular,
  AttachRegular,
  DismissRegular,
  ImageRegular,
  ShieldCheckmarkRegular,
  NetworkCheckRegular,
  CalendarRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import DiagramEditor from "./DiagramEditor";
import ArchitectureTabContent, { type ResultTab } from "./architecture/ArchitectureTabContent";
import { parseDiagramNodes } from "../utils/diagramParser";
import { toPromptPrefix } from "../hooks/useWorkloadContext";
import { exportArchitectureToDocx } from "../utils/architectureDocxExport";
import type { SseEvent, Citation, BicepResult, CostEstimate, AdrRecord, ChatMessage, WorkloadContext, NetworkTopology, WafPillarResult, Mode, ConversationRecord, ProjectTimeline } from "../types";
import type { DiagramNode } from "../utils/diagramParser";
import { apiPath } from "../config/api";

// ── Pattern definitions ───────────────────────────────────────────────────────

interface PatternDef {
  value: string;
  label: string;
  hint: string;
}

const PATTERNS: PatternDef[] = [
  { value: "custom", label: "Custom", hint: "Let the AI choose the best approach for your requirements. Good for complex or hybrid workloads." },
  { value: "web-app", label: "Web App", hint: "N-tier or serverless web application. Uses App Service or Function Apps, Azure SQL or Cosmos DB, CDN, and Azure Front Door for edge delivery." },
  { value: "microservices", label: "Microservices", hint: "Independent, container-based services on AKS or Container Apps. Best for large teams, high deployment frequency, or workloads needing per-service scaling." },
  { value: "event-driven", label: "Event-Driven", hint: "Async processing via Event Hubs, Service Bus, or Azure Functions. Best for high-throughput ingest, decoupled workflows, or real-time data pipelines." },
  { value: "hub-spoke", label: "Hub-Spoke", hint: "Enterprise network topology with a central hub VNet (Azure Firewall, VPN Gateway, DNS) and isolated spoke VNets per workload or team." },
  { value: "saas-multitenant", label: "SaaS Multi-Tenant", hint: "B2B/B2C SaaS platform with per-tenant isolation, shared infrastructure, Entra External ID, and multi-region active-active or active-passive." },
  { value: "batch", label: "Batch", hint: "Large-scale scheduled or on-demand compute using Azure Batch, Data Factory, Databricks, or Synapse. Best for ETL, ML training, or media processing." },
];

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.yaml,.yml,.bicep,.tf,.pdf,.docx";

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  panel: { display: "flex", height: "100%", overflow: "hidden" },
  form: {
    width: "360px",
    minWidth: "300px",
    padding: "20px 16px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    background: tokens.colorNeutralBackground1,
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
  reqFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 8px 7px",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2,
  },
  constraintBox: {
    display: "block",
    width: "100%",
    minHeight: "72px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.55",
    color: tokens.colorNeutralForeground1,
    transition: "border-color 0.15s",
    "&:focus": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  attachSection: { display: "flex", flexDirection: "column", gap: "7px" },
  attachChips: { display: "flex", flexWrap: "wrap", gap: "5px" },
  attachChip: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: "3px 8px 3px 7px",
    borderRadius: "20px",
    fontSize: "11.5px",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    maxWidth: "180px",
  },
  attachChipName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  attachChipRemove: {
    cursor: "pointer",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: "11px",
    "&:hover": { color: tokens.colorNeutralForeground1 },
  },
  patternGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5px" },
  patternChip: {
    padding: "7px 4px",
    textAlign: "center",
    borderRadius: "7px",
    fontSize: "11.5px",
    cursor: "pointer",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    transition: "all 0.12s",
    userSelect: "none",
    lineHeight: "1.2",
    "&:hover": { background: "rgba(0, 120, 212, 0.08)", border: "1px solid rgba(0, 120, 212, 0.3)", color: tokens.colorNeutralForeground1 },
  },
  patternChipActive: { background: "rgba(0, 120, 212, 0.15)", border: "1px solid rgba(0, 120, 212, 0.5)", color: "#50A6E8", fontWeight: 600 },
  status: { color: tokens.colorBrandForeground1, fontSize: "13px", display: "flex", gap: "6px", alignItems: "center" },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: tokens.colorBrandBackground,
    marginLeft: "5px",
    verticalAlign: "middle",
  },
  dropOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 10,
    background: "rgba(0,120,212,0.08)",
    border: `2px dashed ${tokens.colorBrandBackground}`,
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
});

interface Attachment {
  name: string;
  content: string;
  isImage: boolean;
}

const DESIGN_TYPES: { mode: Mode; label: string; subtitle: string; generateLabel: string }[] = [
  { mode: "architecture", label: "General Architecture", subtitle: "Describe your requirements and get an explanation, diagram, IaC, cost estimate, and more.", generateLabel: "Generate Architecture" },
  { mode: "network", label: "Network Design", subtitle: "Describe your network requirements to generate a hub-spoke topology, NSG rules, and Bicep.", generateLabel: "Design Network" },
  { mode: "aiarchitecture", label: "AI Architecture", subtitle: "Describe your AI/ML workload to get a reference architecture with RAG, agents, or MLOps design.", generateLabel: "Design AI Architecture" },
  { mode: "dataplatform", label: "Data Platform", subtitle: "Describe your analytics requirements to generate a medallion architecture with Fabric, Synapse, or Databricks.", generateLabel: "Design Data Platform" },
  { mode: "apim", label: "API Management", subtitle: "Describe your API landscape to generate an APIM topology with policies, backends, and Bicep.", generateLabel: "Design API Platform" },
];

interface ArchitecturePanelProps {
  mode?: Mode;
  onRefine?: (context: ChatMessage[]) => void;
  onModeChange?: (mode: Mode) => void;
  workloadContext?: WorkloadContext;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function ArchitecturePanel({ mode = "architecture", onRefine, onModeChange, workloadContext, onSave, initialSession }: ArchitecturePanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { stream: streamService, cancel: cancelService } = useSSE();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [requirements, setRequirements] = useState("");
  const [constraints, setConstraints] = useState("");
  const [pattern, setPattern] = useState("custom");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isImproving, setIsImproving] = useState(false);

  const [activeTab, setActiveTab] = useState<ResultTab>("explanation");
  const [explanation, setExplanation] = useState("");
  const [diagramXml, setDiagramXml] = useState<string | null>(null);
  const [runbook, setRunbook] = useState<string | null>(null);
  const [bicepResult, setBicepResult] = useState<BicepResult | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [adrRecord, setAdrRecord] = useState<AdrRecord | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [wafResults, setWafResults] = useState<Record<string, WafPillarResult>>({});
  const [networkTopology, setNetworkTopology] = useState<NetworkTopology | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);

  const [diagramNodes, setDiagramNodes] = useState<DiagramNode[]>([]);
  const [popoverServiceLabel, setPopoverServiceLabel] = useState<string | null>(null);
  const [popoverStreamText, setPopoverStreamText] = useState("");
  const [popoverLoading, setPopoverLoading] = useState(false);
  const [diagramHtml, setDiagramHtml] = useState<string | null>(null);
  const [projectTimeline, setProjectTimeline] = useState<ProjectTimeline | null>(null);
  const [ganttHtml, setGanttHtml] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const sessionId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as {
      explanation?: string;
      diagramXml?: string | null;
      bicepResult?: BicepResult | null;
      costEstimate?: CostEstimate | null;
      adrRecord?: AdrRecord | null;
      networkTopology?: NetworkTopology | null;
      wafResults?: Record<string, WafPillarResult>;
      runbook?: string | null;
      projectTimeline?: ProjectTimeline | null;
    };
    if (sr.explanation) setExplanation(sr.explanation);
    if (sr.diagramXml) setDiagramXml(sr.diagramXml);
    if (sr.bicepResult) setBicepResult(sr.bicepResult);
    if (sr.costEstimate) setCostEstimate(sr.costEstimate);
    if (sr.adrRecord) setAdrRecord(sr.adrRecord);
    if (sr.networkTopology) setNetworkTopology(sr.networkTopology);
    if (sr.wafResults) setWafResults(sr.wafResults);
    if (sr.runbook) setRunbook(sr.runbook);
    if (sr.projectTimeline) setProjectTimeline(sr.projectTimeline);
  }, []);

  useEffect(() => {
    setDiagramNodes(diagramXml ? parseDiagramNodes(diagramXml) : []);
  }, [diagramXml]);

  useEffect(() => {
    if (!diagramXml) { setDiagramHtml(null); return; }
    const xmlLiteral = JSON.stringify(diagramXml).replace(/<\/script>/gi, "<\\/script>");
    setDiagramHtml(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#fff;}</style>
</head>
<body>
<div class="mxgraph" style="width:100%;height:100%;max-width:initial;"></div>
<script>
window.mxBasePath = 'https://viewer.diagrams.net/';
(function(){
  var xml = ${xmlLiteral};
  var cfg = JSON.stringify({highlight:'#0000ff',nav:true,resize:true,xml:xml});
  document.querySelector('.mxgraph').setAttribute('data-mxgraph', cfg);
})();
</script>
<script type="text/javascript" src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>`);
  }, [diagramXml]);

  useEffect(() => {
    if (!projectTimeline?.diagramXml) { setGanttHtml(null); return; }
    const xmlLiteral = JSON.stringify(projectTimeline.diagramXml).replace(/<\/script>/gi, "<\\/script>");
    setGanttHtml(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#fff;}</style>
</head>
<body>
<div class="mxgraph" style="width:100%;height:100%;max-width:initial;"></div>
<script>
window.mxBasePath = 'https://viewer.diagrams.net/';
(function(){
  var xml = ${xmlLiteral};
  var cfg = JSON.stringify({highlight:'#0000ff',nav:true,resize:true,xml:xml});
  document.querySelector('.mxgraph').setAttribute('data-mxgraph', cfg);
})();
</script>
<script type="text/javascript" src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>`);
  }, [projectTimeline]);

  useEffect(() => {
    if (!popoverServiceLabel) return;
    setPopoverStreamText("");
    setPopoverLoading(true);
    const prompt = `Give 3 concise bullet points about ${popoverServiceLabel} in an Azure architecture: key configuration choices, cost considerations, and WAF risks.`;
    streamService(
      "/api/chat",
      { messages: [{ role: "user", content: prompt }], mode: "qa" },
      (event: SseEvent) => { if (event.type === "token") setPopoverStreamText((t) => t + event.content); }
    ).finally(() => setPopoverLoading(false));
  }, [popoverServiceLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setExplanation("");
    setDiagramXml(null);
    setRunbook(null);
    setBicepResult(null);
    setCostEstimate(null);
    setAdrRecord(null);
    setCitations([]);
    setWafResults({});
    setNetworkTopology(null);
    setProjectTimeline(null);
    setStatusMsg("");
  }

  function handleFiles(files: File[]) {
    setParseError(null);
    files.forEach(async (file) => {
      const lower = file.name.toLowerCase();
      const isImage = file.type.startsWith("image/");
      const isParsed = lower.endsWith(".pdf") || lower.endsWith(".docx");
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          setAttachments((prev) => [...prev, { name: file.name, content, isImage: true }]);
        };
        reader.readAsDataURL(file);
      } else if (isParsed) {
        try {
          const res = await fetch(apiPath("/api/parse"), { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name }, body: await file.arrayBuffer() });
          if (res.ok) {
            const { text } = await res.json() as { text: string };
            setAttachments((prev) => [...prev, { name: file.name, content: text, isImage: false }]);
          } else {
            const err = await res.json().catch(() => ({ detail: "Unknown error" })) as { detail?: string };
            setParseError(`Could not parse ${file.name}: ${err.detail ?? res.statusText}`);
          }
        } catch {
          setParseError(`Could not upload ${file.name}. Check that the backend is running.`);
        }
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          setAttachments((prev) => [...prev, { name: file.name, content, isImage: false }]);
        };
        reader.readAsText(file);
      }
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleImprove() {
    if (!requirements.trim() || isImproving) return;
    setIsImproving(true);
    try {
      const res = await fetch(apiPath("/api/improve"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: requirements }) });
      if (res.ok) {
        const data = await res.json() as { improved: string };
        setRequirements(data.improved);
      }
    } finally {
      setIsImproving(false);
    }
  }

  function buildPayload(include_components: string[]) {
    const prefix = workloadContext ? toPromptPrefix(workloadContext) : "";
    return {
      requirements: prefix ? prefix + requirements : requirements,
      constraints,
      pattern,
      mode,
      include_components,
      attachments: attachments.map((a) => a.content),
    };
  }

  function applyEvent(event: SseEvent) {
    if (event.type === "token") setExplanation((e) => e + event.content);
    if (event.type === "status") setStatusMsg(event.message);
    if (event.type === "diagram") { setDiagramXml(event.xml); }
    if (event.type === "runbook") setRunbook(event.markdown);
    if (event.type === "bicep") setBicepResult({ bicep_code: event.code, param_file: event.param_file, deploy_commands: event.deploy_commands ?? [], notes: event.notes ?? [] });
    if (event.type === "cost_estimate") setCostEstimate(event.estimate);
    if (event.type === "adr") setAdrRecord(event.data as AdrRecord);
    if (event.type === "citations") setCitations(event.citations);
    if (event.type === "waf_pillar") setWafResults((prev) => ({ ...prev, [event.pillar.pillar]: event.pillar }));
    if (event.type === "network_topology") setNetworkTopology(event.topology);
    if (event.type === "project_timeline") setProjectTimeline({ phases: event.phases, total_weeks: event.total_weeks, notes: event.notes, diagramXml: event.xml });
    if (event.type === "error") setExplanation((e) => e + `\n\n*Error: ${event.message}*`);
  }

  async function handleGenerate() {
    if (!requirements.trim() || isStreaming) return;
    reset();
    setActiveTab("explanation");

    let localExplanation = "";
    let localDiagramXml: string | null = null;
    let localBicepResult: BicepResult | null = null;
    let localCostEstimate: CostEstimate | null = null;
    let localAdrRecord: AdrRecord | null = null;
    let localNetworkTopology: NetworkTopology | null = null;
    let localWafResults: Record<string, WafPillarResult> = {};
    let localProjectTimeline: ProjectTimeline | null = null;

    await stream("/api/architecture", buildPayload([]), (event: SseEvent) => {
      if (event.type === "token") localExplanation += event.content;
      if (event.type === "diagram") localDiagramXml = event.xml;
      if (event.type === "bicep") localBicepResult = { bicep_code: event.code, param_file: event.param_file, deploy_commands: event.deploy_commands ?? [], notes: event.notes ?? [] };
      if (event.type === "cost_estimate") localCostEstimate = event.estimate;
      if (event.type === "adr") localAdrRecord = event.data as AdrRecord;
      if (event.type === "network_topology") localNetworkTopology = event.topology;
      if (event.type === "waf_pillar") localWafResults = { ...localWafResults, [event.pillar.pillar]: event.pillar };
      if (event.type === "project_timeline") localProjectTimeline = { phases: event.phases, total_weeks: event.total_weeks, notes: event.notes, diagramXml: event.xml };
      applyEvent(event);
    });
    setStatusMsg("");

    if (onSave && localExplanation) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: requirements },
        { id: crypto.randomUUID(), role: "assistant", content: localExplanation },
      ];
      onSave(sessionId, mode, msgs, {
        explanation: localExplanation,
        diagramXml: localDiagramXml,
        bicepResult: localBicepResult,
        costEstimate: localCostEstimate,
        adrRecord: localAdrRecord,
        networkTopology: localNetworkTopology,
        wafResults: localWafResults,
        projectTimeline: localProjectTimeline,
      });
    }
  }

  async function generateDeliverable(component: string, tabKey: ResultTab) {
    if (deliverableStreaming || !requirements.trim()) return;
    setGeneratingTab(tabKey);
    setActiveTab(tabKey);
    await deliverableStream("/api/architecture", buildPayload([component]), applyEvent);
    setStatusMsg("");
    setGeneratingTab(null);
  }

  function handleRefine() {
    if (!onRefine || !explanation) return;
    const context = explanation + (runbook ? `\n\n**Runbook:**\n${runbook}` : "");
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: `Here is the Azure architecture I've designed:\n\n${context}` }]);
  }

  async function handleExport() {
    if (!explanation || isExporting) return;
    setIsExporting(true);
    exportArchitectureToDocx({
      explanation,
      runbook,
      bicepResult,
      costEstimate,
      adrRecord,
      wafResults: Object.keys(wafResults).length > 0 ? wafResults : undefined,
      hasDiagram: !!diagramXml,
    }).finally(() => setIsExporting(false));
  }

  function downloadDiagram() {
    if (!diagramXml) return;
    const blob = new Blob([diagramXml], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "architecture.drawio"; a.click();
    URL.revokeObjectURL(url);
  }

  function openInDrawio() {
    if (!diagramXml) return;
    window.open(`https://viewer.diagrams.net/?xml=${encodeURIComponent(diagramXml)}`, "_blank");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }

  function downloadGantt() {
    if (!projectTimeline?.diagramXml) return;
    const blob = new Blob([projectTimeline.diagramXml], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "project-timeline.drawio"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadBicep() {
    const blob = new Blob([bicepResult!.bicep_code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "main.bicep"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadParamFile() {
    if (!bicepResult?.param_file) return;
    const blob = new Blob([bicepResult.param_file], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "main.bicepparam"; a.click();
    URL.revokeObjectURL(url);
  }

  const designType = DESIGN_TYPES.find((dt) => dt.mode === mode);
  const isAnyStreaming = isStreaming || deliverableStreaming;
  const hasResults = !!explanation;

  return (
    <div
      className={styles.panel}
      style={{ position: "relative" }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className={styles.dropOverlay}>
          <Text size={400} weight="semibold">Drop files to attach</Text>
        </div>
      )}
      {showEditor && diagramXml && (
        <DiagramEditor xml={diagramXml} onSave={(xml) => { setDiagramXml(xml); setShowEditor(false); }} onClose={() => setShowEditor(false)} />
      )}

      <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
        <Panel defaultSize="32%" minSize="15%" maxSize="65%">
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "18px", background: tokens.colorNeutralBackground1, boxSizing: "border-box" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {onModeChange ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Label htmlFor="arch-design-type" weight="semibold" size="small">Design Type</Label>
                  <Select id="arch-design-type" value={mode} onChange={(_, data) => onModeChange(data.value as Mode)} size="small" style={{ minWidth: "200px" }}>
                    {DESIGN_TYPES.map((dt) => <option key={dt.mode} value={dt.mode}>{dt.label}</option>)}
                  </Select>
                </div>
              ) : (
                <Text weight="semibold" size={400}>{designType?.label ?? "Architecture Design"}</Text>
              )}
              <Text block size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {designType?.subtitle ?? "Describe your requirements."}
              </Text>
            </div>

            {/* Requirements */}
            <div>
              <span className={styles.sectionLabel}>Requirements</span>
              <div className={styles.reqBox}>
                <textarea
                  className={styles.reqTextarea}
                  placeholder={
                    mode === "network" ? "e.g. Hub-spoke with Azure Firewall, 3 spoke VNets, private endpoints for SQL and Storage, forced tunneling…"
                    : mode === "aiarchitecture" ? "e.g. RAG pipeline with Azure OpenAI, AI Search, Blob Storage; enterprise chatbot with Entra auth, 100 concurrent users…"
                    : mode === "dataplatform" ? "e.g. Medallion architecture for retail analytics; 5TB/day ingestion via Event Hubs, Delta Lake on ADLS Gen2, Power BI reporting, Purview governance…"
                    : mode === "apim" ? "e.g. 12 microservices behind Premium APIM, JWT validation, rate limiting by subscription key, developer portal, 3 products (Internal, Partner, Public)…"
                    : "Describe what the system needs to do, who uses it, expected scale, integrations…"
                  }
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  style={{ boxSizing: "border-box" }}
                />
                <div className={styles.reqFooter}>
                  <Button appearance="subtle" size="small" icon={isImproving ? <Spinner size="tiny" /> : <SparkleRegular />} onClick={handleImprove} disabled={!requirements.trim() || isImproving}>
                    {isImproving ? "Improving…" : "Improve with AI"}
                  </Button>
                  <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>{requirements.length} chars</Text>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className={styles.attachSection}>
              <span className={styles.sectionLabel}>Attachments</span>
              <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_TYPES} style={{ display: "none" }} onChange={handleFileChange} />
              <Button appearance="outline" size="small" icon={<AttachRegular />} onClick={() => fileInputRef.current?.click()}>Attach Files</Button>
              <Text size={100} style={{ color: tokens.colorNeutralForeground4, marginTop: "-2px" }}>Images, .txt, .md, .json, .yaml, .bicep, .tf, .pdf, .docx</Text>
              {parseError && <Text size={100} style={{ color: tokens.colorPaletteRedForeground1, marginTop: "4px" }}>{parseError}</Text>}
              {attachments.length > 0 && (
                <div className={styles.attachChips}>
                  {attachments.map((a, i) => (
                    <div key={i} className={styles.attachChip}>
                      {a.isImage ? <ImageRegular style={{ flexShrink: 0, fontSize: "12px" }} /> : <DocumentRegular style={{ flexShrink: 0, fontSize: "12px" }} />}
                      <span className={styles.attachChipName}>{a.name}</span>
                      <DismissRegular className={styles.attachChipRemove} onClick={() => removeAttachment(i)} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Constraints */}
            <div>
              <span className={styles.sectionLabel}>Constraints</span>
              <textarea className={styles.constraintBox} placeholder="Compliance (HIPAA, PCI), region, budget, latency SLAs…" value={constraints} onChange={(e) => setConstraints(e.target.value)} style={{ boxSizing: "border-box" }} />
            </div>

            {/* Pattern selection */}
            <div>
              <span className={styles.sectionLabel}>Architecture Pattern</span>
              <div className={styles.patternGrid}>
                {PATTERNS.map((p) => (
                  <Tooltip key={p.value} content={p.hint} relationship="description" positioning="after" withArrow>
                    <div className={`${styles.patternChip} ${pattern === p.value ? styles.patternChipActive : ""}`} onClick={() => setPattern(p.value)}>
                      {p.label}
                    </div>
                  </Tooltip>
                ))}
              </div>
            </div>

            {isStreaming ? (
              <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
            ) : (
              <Button appearance="primary" onClick={handleGenerate} disabled={!requirements.trim() || deliverableStreaming}>
                {designType?.generateLabel ?? "Generate Architecture"}
              </Button>
            )}

            {deliverableStreaming && generatingTab && (
              <Button appearance="outline" icon={<Spinner size="tiny" />} onClick={cancelDeliverable} size="small">Cancel Generation</Button>
            )}

            {statusMsg && (
              <div className={styles.status}>
                <Spinner size="tiny" />
                <span>{statusMsg}</span>
              </div>
            )}

            {hasResults && onRefine && (
              <Button appearance="outline" icon={<ChatRegular />} onClick={handleRefine}>Refine in Chat</Button>
            )}

            {hasResults && !isAnyStreaming && (
              <Button appearance="outline" icon={isExporting ? <Spinner size="tiny" /> : <ArrowDownloadRegular />} onClick={handleExport} disabled={isExporting}>
                {isExporting ? "Exporting…" : "Export Report (.docx)"}
              </Button>
            )}

            {citations.length > 0 && (
              <div>
                <Text size={200} weight="semibold">Sources</Text>
                <ul style={{ margin: "4px 0", paddingLeft: "16px" }}>
                  {citations.map((c, i) => (
                    <li key={i}><a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px" }}>{c.title}</a></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />
        <Panel>
          {/* ── Right panel with tabs ─────────────────────────────── */}
          <div className={styles.rightPanel}>
            <div className={styles.tabBar}>
              <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as ResultTab)} size="small">
                <Tab value="explanation">Explanation{explanation && <span className={styles.tabDot} />}</Tab>
                <Tab value="diagram">Diagram{diagramXml && <span className={styles.tabDot} />}</Tab>
                <Tab value="runbook">Runbook{runbook && <span className={styles.tabDot} />}</Tab>
                <Tab value="bicep" icon={<CodeRegular />}>IaC{bicepResult && <span className={styles.tabDot} />}</Tab>
                <Tab value="cost" icon={<MoneyRegular />}>Cost{costEstimate && <span className={styles.tabDot} />}</Tab>
                <Tab value="adr" icon={<BookOpenRegular />}>ADR{adrRecord && <span className={styles.tabDot} />}</Tab>
                <Tab value="waf" icon={<ShieldCheckmarkRegular />}>WAF{Object.keys(wafResults).length > 0 && <span className={styles.tabDot} />}</Tab>
                <Tab value="network" icon={<NetworkCheckRegular />}>Network{networkTopology && <span className={styles.tabDot} />}</Tab>
                <Tab value="gantt" icon={<CalendarRegular />}>Gantt{projectTimeline && <span className={styles.tabDot} />}</Tab>
              </TabList>
            </div>

            <ArchitectureTabContent
              activeTab={activeTab}
              explanation={explanation}
              diagramXml={diagramXml}
              diagramHtml={diagramHtml}
              diagramNodes={diagramNodes}
              runbook={runbook}
              bicepResult={bicepResult}
              costEstimate={costEstimate}
              adrRecord={adrRecord}
              wafResults={wafResults}
              networkTopology={networkTopology}
              projectTimeline={projectTimeline}
              ganttHtml={ganttHtml}
              popoverServiceLabel={popoverServiceLabel}
              popoverStreamText={popoverStreamText}
              popoverLoading={popoverLoading}
              generatingTab={generatingTab}
              isAnyStreaming={isAnyStreaming}
              deliverableStreaming={deliverableStreaming}
              requirements={requirements}
              generateDeliverable={generateDeliverable}
              downloadDiagram={downloadDiagram}
              openInDrawio={openInDrawio}
              setShowEditor={setShowEditor}
              setPopoverServiceLabel={setPopoverServiceLabel}
              cancelService={cancelService}
              downloadGantt={downloadGantt}
              downloadBicep={downloadBicep}
              downloadParamFile={downloadParamFile}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
