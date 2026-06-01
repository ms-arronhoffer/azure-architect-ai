import { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  makeStyles,
  tokens,
  Button,
  Field,
  Textarea,
  Text,
  Spinner,
  Badge,
  Checkbox,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  ProgressBar,
  Tooltip,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  ChatRegular,
  ArrowUploadRegular,
  DismissCircleRegular,
  DocumentRegular,
  CodeRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useFindingChecklist } from "../hooks/useFindingChecklist";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { parseArmTemplate, parseBicepText, formatResourceList } from "../utils/templateParser";
import { exportReviewToDocx } from "../utils/reviewDocxExport";
import type { SseEvent, WafPillarResult, ChatMessage, ConversationRecord, Mode } from "../types";

const PILLAR_LABELS: Record<string, string> = {
  reliability: "Reliability",
  security: "Security",
  cost: "Cost Optimization",
  "operational-excellence": "Operational Excellence",
  performance: "Performance Efficiency",
};

const BADGE_COLOR: Record<number, "danger" | "warning" | "success"> = {
  1: "danger", 2: "danger", 3: "warning", 4: "success", 5: "success",
};
const SCORE_COLOR: Record<number, "error" | "warning" | "success"> = {
  1: "error", 2: "error", 3: "warning", 4: "success", 5: "success",
};

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.drawio,.xml,.json";

function buildDiagramSrcdoc(xml: string): string {
  const xmlLiteral = JSON.stringify(xml).replace(/<\/script>/gi, "<\\/script>");
  return `<!DOCTYPE html>
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
</html>`;
}

const useStyles = makeStyles({
  panel: { display: "flex", height: "100%", overflow: "hidden" },
  form: {
    width: "340px",
    minWidth: "280px",
    padding: "16px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    background: tokens.colorNeutralBackground1,
  },
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  tabBar: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    padding: "0 16px",
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
  diagramFrame: {
    flex: 1,
    border: "none",
    width: "100%",
    minHeight: "500px",
  },
  diagramContainer: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    height: "100%",
  },
  diagramActions: {
    display: "flex",
    gap: "8px",
    padding: "8px 0",
    flexShrink: 0,
  },
  narrative: {
    "& p": { margin: "4px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, padding: "8px", borderRadius: "4px" },
    "& ul, & ol": { paddingLeft: "20px" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "4px 8px" },
  },
  pillarHeader: { display: "flex", gap: "12px", alignItems: "center", width: "100%" },
  pillarLabel: { fontWeight: 600, flex: 1 },
  scoreBar: { width: "120px" },
  status: {
    color: tokens.colorBrandForeground1,
    fontSize: "13px",
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  attachmentList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  attachmentItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "4px",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  attachmentThumb: {
    width: "40px",
    height: "40px",
    objectFit: "cover",
    borderRadius: "2px",
    flexShrink: 0,
  },
  attachmentName: {
    flex: 1,
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground1,
  },
  findingRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    marginBottom: "4px",
  },
  templateTextarea: {
    display: "block",
    width: "100%",
    minHeight: "120px",
    padding: "8px 10px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    outline: "none",
    resize: "vertical",
    fontFamily: "monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground1,
    "&:focus": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  resourceBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginTop: "6px",
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
    flex: 1,
    padding: "40px 20px",
    textAlign: "center",
  },
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

interface Attachment {
  id: string;
  name: string;
  dataUrl: string;
  isImage: boolean;
}

interface ReviewPanelProps {
  onRefine?: (context: ChatMessage[], suggestedReplies?: string[]) => void;
  conversationId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function ReviewPanel({ onRefine, conversationId, onSave, initialSession }: ReviewPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { stream: deliverableStream, isStreaming: deliverableStreaming, cancel: cancelDeliverable } = useSSE();
  const { toggle, isResolved } = useFindingChecklist(conversationId ?? "review");
  const { spec } = useWorkloadSpec();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState(() => toSpecPromptPrefix(spec));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [narrative, setNarrative] = useState("");
  const [pillars, setPillars] = useState<WafPillarResult[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [templateMode, setTemplateMode] = useState<"arm" | "bicep">("arm");
  const [detectedResources, setDetectedResources] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState("overview");
  const [currentDiagramXml, setCurrentDiagramXml] = useState("");
  const [targetDiagramXml, setTargetDiagramXml] = useState("");
  const [migrationPlan, setMigrationPlan] = useState("");
  const [referenceDesign, setReferenceDesign] = useState("");
  const [extractedRequirements, setExtractedRequirements] = useState("");
  const [generatingTab, setGeneratingTab] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { narrative?: string; pillars?: WafPillarResult[]; templateText?: string; migrationPlan?: string; referenceDesign?: string };
    if (sr.narrative) setNarrative(sr.narrative);
    if (sr.pillars?.length) setPillars(sr.pillars);
    if (sr.templateText) setTemplateText(sr.templateText);
    if (sr.migrationPlan) setMigrationPlan(sr.migrationPlan);
    if (sr.referenceDesign) setReferenceDesign(sr.referenceDesign);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
    e.target.value = "";
  }

  function handleFiles(files: File[]) {
    if (!files.length) return;
    files.forEach((file) => {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        const dataUrl = isImage ? result : `[Attached file: ${file.name}]\n${result}`;
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), name: file.name, dataUrl, isImage },
        ]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDetectResources() {
    const types = templateMode === "arm"
      ? parseArmTemplate(templateText)
      : parseBicepText(templateText);
    setDetectedResources(types);
  }

  function buildReviewContext(): string {
    const pillarSummary = pillars.length > 0
      ? "\n\n## WAF Assessment\n" + pillars.map((p) =>
          `- ${PILLAR_LABELS[p.pillar] ?? p.pillar}: ${p.score}/5\n  Findings: ${p.findings.join("; ")}`
        ).join("\n")
      : "";
    return `## Architecture Description\n${description}${templateText.trim() ? `\n\n## Existing Template\n\`\`\`${templateMode === "arm" ? "json" : "bicep"}\n${templateText}\n\`\`\`` : ""}${narrative ? `\n\n## Review Narrative\n${narrative}` : ""}${pillarSummary}`;
  }

  async function handleReview() {
    if (!description.trim() || isStreaming) return;
    setNarrative("");
    setPillars([]);
    setStatusMsg("");
    setCurrentDiagramXml("");
    setTargetDiagramXml("");
    setMigrationPlan("");
    setReferenceDesign("");
    setExtractedRequirements("");
    setActiveTab("overview");

    let existingDescription = description;
    if (templateText.trim()) {
      const lang = templateMode === "arm" ? "json" : "bicep";
      existingDescription += `\n\n## Existing Template\n\`\`\`${lang}\n${templateText}\n\`\`\``;
    }

    let localNarrative = "";
    let localPillars: WafPillarResult[] = [];
    let firstToken = true;

    await stream(
      "/api/architecture",
      {
        requirements: existingDescription,
        mode: "review",
        existing_description: existingDescription,
        attachments: attachments.map((a) => a.dataUrl),
      },
      (event: SseEvent) => {
        if (event.type === "token") {
          if (firstToken) { firstToken = false; setActiveTab("overview"); }
          localNarrative += event.content;
          setNarrative((n) => n + event.content);
        }
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "waf_pillar") {
          localPillars = [...localPillars.filter((p) => p.pillar !== event.pillar.pillar), event.pillar];
          setPillars((prev) => {
            const exists = prev.find((p) => p.pillar === event.pillar.pillar);
            if (exists) return prev.map((p) => p.pillar === event.pillar.pillar ? event.pillar : p);
            return [...prev, event.pillar];
          });
        }
      }
    );
    setStatusMsg("");

    if (onSave && conversationId && (localNarrative || localPillars.length > 0)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: existingDescription },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(conversationId, "review", msgs, { narrative: localNarrative, pillars: localPillars, templateText, migrationPlan: "", referenceDesign: "" });
    }
  }

  async function generateDiagram(kind: "current" | "target") {
    if (deliverableStreaming) return;
    const tabKey = kind === "current" ? "current-arch" : "target-arch";
    setGeneratingTab(tabKey);
    setActiveTab(tabKey);

    const requirements = kind === "current"
      ? description
      : `Based on the following architecture review, design an improved TARGET architecture that addresses all WAF findings:\n\n${buildReviewContext()}\n\nDesign the target state that resolves these issues.`;

    let xml = "";
    await deliverableStream(
      "/api/architecture",
      {
        requirements,
        mode: "architecture",
        include_components: ["diagram"],
        attachments: kind === "current" ? attachments.map((a) => a.dataUrl) : [],
        constraints: "",
        pattern: "custom",
      },
      (event: SseEvent) => {
        if (event.type === "diagram") {
          xml = event.xml as string;
          if (kind === "current") setCurrentDiagramXml(xml);
          else setTargetDiagramXml(xml);
        }
        if (event.type === "status") setStatusMsg(event.message);
      }
    );
    setStatusMsg("");
    setGeneratingTab(null);
  }

  async function generateDeliverable(kind: "migration" | "reference" | "requirements") {
    if (deliverableStreaming) return;
    const tabMap = { migration: "migration", reference: "reference", requirements: "requirements" };
    const tabKey = tabMap[kind];
    setGeneratingTab(tabKey);
    setActiveTab(tabKey);

    const setter = kind === "migration" ? setMigrationPlan : kind === "reference" ? setReferenceDesign : setExtractedRequirements;
    setter("");

    const context = buildReviewContext();
    const promptMap: Record<string, string> = {
      migration: `You are a senior Azure Architect. Based on this architecture review, create a detailed phased migration plan.\n\n${context}\n\nGenerate a phased migration plan with:\n**Phase 1 (0–30 days): Quick Wins**\n- Objectives\n- Services to add/change/remove\n- Timeline and effort\n- Success criteria\n\n**Phase 2 (30–90 days): Core Improvements**\n- Objectives\n- Services to add/change/remove\n- Dependencies and risks\n- Success criteria\n\n**Phase 3 (90+ days): Advanced Optimization**\n- Objectives\n- Long-term architectural changes\n- Expected outcomes\n- Success criteria`,
      reference: `You are a senior Azure Architect. Based on this architecture review, create a service-by-service reference design.\n\n${context}\n\nFor each service in the architecture, provide:\n- **Service Name**: (Azure resource type)\n- **Recommended SKU/Tier**: with rationale\n- **Configuration**: key settings, sizing, and redundancy\n- **Security Hardening**: specific controls and policies\n- **Integration Points**: how it connects to other services\n- **Monitoring**: key metrics and alert thresholds`,
      requirements: `You are a senior Azure Architect. Extract and categorize all requirements from this architecture review.\n\n${context}\n\nOrganize requirements into these categories:\n\n**Functional Requirements** (what the system must do)\n**Non-Functional Requirements** (performance, availability, security, scalability)\n**Compliance Requirements** (regulatory, policy)\n**Integration Requirements** (external systems and interfaces)\n**Operational Requirements** (monitoring, backup, DR)\n\nFor each requirement provide: ID, Description, Priority (Must/Should/Could), and Source (explicit from description or derived from WAF findings).`,
    };

    await deliverableStream(
      "/api/chat",
      { mode: "qa", messages: [{ role: "user", content: promptMap[kind] }] },
      (event: SseEvent) => {
        if (event.type === "token") setter((prev) => prev + event.content);
        if (event.type === "status") setStatusMsg(event.message);
      }
    );
    setStatusMsg("");
    setGeneratingTab(null);
  }

  function downloadDiagram(xml: string, filename: string) {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openInDrawIo(xml: string) {
    const encoded = encodeURIComponent(xml);
    window.open(`https://app.diagrams.net/?src=embed#R${encoded}`, "_blank");
  }

  function handleRefine() {
    if (!onRefine) return;
    const pillarSummary = pillars.length > 0
      ? "\n\n**WAF Scores:**\n" + pillars.map((p) => `- ${PILLAR_LABELS[p.pillar] ?? p.pillar}: ${p.score}/5`).join("\n")
      : "";
    onRefine([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: narrative + pillarSummary,
    }]);
  }

  function handleExport() {
    setExporting(true);
    exportReviewToDocx(narrative, pillars, {
      migrationPlan: migrationPlan || undefined,
      referenceDesign: referenceDesign || undefined,
      requirements: extractedRequirements || undefined,
      hasDiagrams: !!(currentDiagramXml || targetDiagramXml),
    }).finally(() => setExporting(false));
  }

  const hasResults = narrative.length > 0 || pillars.length > 0;
  const anyDeliverable = !!(currentDiagramXml || targetDiagramXml || migrationPlan || referenceDesign || extractedRequirements);
  const isAnyStreaming = isStreaming || deliverableStreaming;

  function renderDiagramTab(xml: string, kind: "current" | "target") {
    const tabKey = kind === "current" ? "current-arch" : "target-arch";
    const label = kind === "current" ? "Current Architecture" : "Target Architecture";
    const filename = kind === "current" ? "current-architecture.drawio" : "target-architecture.drawio";

    if (!xml) {
      const isGenerating = generatingTab === tabKey;
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            {isGenerating
              ? `Generating ${label} diagram…`
              : kind === "target"
                ? "Generate a target architecture diagram based on the WAF review findings."
                : "Generate a draw.io diagram of your current architecture."}
          </Text>
          {isGenerating ? (
            <Spinner size="small" />
          ) : (
            <Button
              appearance="primary"
              icon={<ArrowSyncRegular />}
              onClick={() => generateDiagram(kind)}
              disabled={deliverableStreaming || (!hasResults && kind === "target")}
            >
              Generate {label}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className={styles.diagramContainer}>
        <div className={styles.diagramActions}>
          <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDiagram(kind)} disabled={deliverableStreaming}>
            Regenerate
          </Button>
          <Button size="small" appearance="outline" icon={<ArrowDownloadRegular />} onClick={() => downloadDiagram(xml, filename)}>
            Download (.drawio)
          </Button>
          <Button size="small" appearance="outline" onClick={() => openInDrawIo(xml)}>
            Open in draw.io
          </Button>
        </div>
        <iframe
          srcDoc={buildDiagramSrcdoc(xml)}
          className={styles.diagramFrame}
          sandbox="allow-scripts allow-same-origin"
          title={`${label} Diagram`}
        />
      </div>
    );
  }

  function renderTextTab(content: string, kind: "migration" | "reference" | "requirements") {
    const labels = { migration: "Migration Plan", reference: "Reference Design", requirements: "Requirements" };
    const hints = {
      migration: "Generate a phased migration plan (0–30d quick wins, 30–90d core, 90d+ advanced) based on the review findings.",
      reference: "Generate a service-by-service reference design with recommended SKUs, configuration, and security hardening.",
      requirements: "Extract and categorize functional, non-functional, compliance, and operational requirements.",
    };
    const label = labels[kind];
    const tabKey = kind;
    const isGenerating = generatingTab === tabKey;

    if (!content) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>{hints[kind]}</Text>
          {isGenerating ? (
            <Spinner size="small" />
          ) : (
            <Button
              appearance="primary"
              icon={<ArrowSyncRegular />}
              onClick={() => generateDeliverable(kind)}
              disabled={deliverableStreaming || !hasResults}
            >
              Generate {label}
            </Button>
          )}
        </div>
      );
    }

    return (
      <>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable(kind)} disabled={deliverableStreaming}>
            Regenerate
          </Button>
        </div>
        <div className={styles.narrative}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </>
    );
  }

  return (
    <div
      className={styles.panel}
      style={{ position: "relative" }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
    >
      {isDragging && <div className={styles.dropOverlay}><Text size={400} weight="semibold">Drop files to attach</Text></div>}
      <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
        {/* Left sidebar */}
        <Panel defaultSize={32} minSize={15} maxSize={65}>
          <div style={{ height: "100%", overflowY: "auto", padding: "16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "12px", background: tokens.colorNeutralBackground1 }}>
        <Text weight="semibold" size={400}>Architecture Review</Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Red-team your architecture. Get severity-tagged findings and WAF-pillar scores.
        </Text>

        <Accordion collapsible>
          <AccordionItem value="import-template">
            <AccordionHeader icon={<CodeRegular />}>Import Existing Template</AccordionHeader>
            <AccordionPanel>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TabList
                  selectedValue={templateMode}
                  onTabSelect={(_, d) => { setTemplateMode(d.value as "arm" | "bicep"); setDetectedResources([]); }}
                  size="small"
                >
                  <Tab value="arm">Paste ARM JSON</Tab>
                  <Tab value="bicep">Paste Bicep</Tab>
                </TabList>
                <textarea
                  className={styles.templateTextarea}
                  placeholder={templateMode === "arm" ? '{\n  "$schema": "...",\n  "resources": [...]\n}' : "resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {...}"}
                  value={templateText}
                  onChange={(e) => { setTemplateText(e.target.value); setDetectedResources([]); }}
                  style={{ boxSizing: "border-box" }}
                />
                <Button size="small" appearance="outline" onClick={handleDetectResources} disabled={!templateText.trim()}>
                  Detect Resources
                </Button>
                {detectedResources.length > 0 && (
                  <div>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {formatResourceList(detectedResources)}
                    </Text>
                    <div className={styles.resourceBadges}>
                      {detectedResources.slice(0, 10).map((r) => (
                        <Badge key={r} appearance="tint" color="brand" size="small">{r.split("/").pop() ?? r}</Badge>
                      ))}
                      {detectedResources.length > 10 && (
                        <Badge appearance="tint" color="informative" size="small">+{detectedResources.length - 10} more</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>

        <Field label="Architecture Description" required>
          <Textarea
            rows={8}
            placeholder="Describe your architecture in detail. Include services, networking, identity, data flows, and any known constraints or compliance requirements…"
            value={description}
            onChange={(_, d) => setDescription(d.value)}
          />
        </Field>

        <Field label="Diagrams & Files" hint="PNG, JPEG, WebP, SVG, draw.io XML, JSON">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <Button
            appearance="outline"
            icon={<ArrowUploadRegular />}
            onClick={() => fileInputRef.current?.click()}
            style={{ width: "100%" }}
          >
            Upload Files
          </Button>
        </Field>

        {attachments.length > 0 && (
          <div className={styles.attachmentList}>
            {attachments.map((att) => (
              <div key={att.id} className={styles.attachmentItem}>
                {att.isImage ? (
                  <img src={att.dataUrl} alt={att.name} className={styles.attachmentThumb} />
                ) : (
                  <DocumentRegular style={{ width: 40, height: 40, color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                )}
                <Tooltip content={att.name} relationship="label">
                  <span className={styles.attachmentName}>{att.name}</span>
                </Tooltip>
                <Button
                  appearance="transparent"
                  icon={<DismissCircleRegular />}
                  size="small"
                  onClick={() => removeAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                />
              </div>
            ))}
          </div>
        )}

        {isStreaming ? (
          <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
        ) : (
          <Button appearance="primary" onClick={handleReview} disabled={!description.trim() || isAnyStreaming}>
            Run Review
          </Button>
        )}

        {deliverableStreaming && generatingTab && (
          <Button appearance="outline" icon={<Spinner size="tiny" />} onClick={cancelDeliverable} size="small">
            Cancel Generation
          </Button>
        )}

        {statusMsg && (
          <div className={styles.status}>
            <Spinner size="tiny" />
            <span>{statusMsg}</span>
          </div>
        )}

        {hasResults && onRefine && (
          <Button appearance="outline" icon={<ChatRegular />} onClick={handleRefine}>
            Refine in Chat
          </Button>
        )}

        {(hasResults || anyDeliverable) && !isAnyStreaming && (
          <Button appearance="outline" icon={<ArrowDownloadRegular />} onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export Report (.docx)"}
          </Button>
        )}
      </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        {/* Right panel with tabs */}
        <Panel>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div className={styles.tabBar}>
          <TabList
            selectedValue={activeTab}
            onTabSelect={(_, d) => setActiveTab(d.value as string)}
            size="small"
          >
            <Tab value="overview">
              Overview{narrative && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="waf">
              WAF Assessment{pillars.length > 0 && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="current-arch">
              Current Architecture{currentDiagramXml && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="target-arch">
              Target Architecture{targetDiagramXml && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="migration">
              Migration Plan{migrationPlan && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="reference">
              Reference Design{referenceDesign && <span className={styles.tabDot} />}
            </Tab>
            <Tab value="requirements">
              Requirements{extractedRequirements && <span className={styles.tabDot} />}
            </Tab>
          </TabList>
        </div>

        <div className={styles.tabContent}>
          {/* Overview tab */}
          {activeTab === "overview" && (
            <>
              {!narrative && !isStreaming && (
                <Text style={{ color: tokens.colorNeutralForeground3 }}>
                  Describe your architecture and click Run Review. Optionally upload diagrams for visual
                  analysis. You'll receive severity-tagged findings and WAF scores across all 5 pillars.
                </Text>
              )}
              {narrative && (
                <div className={styles.narrative}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
                </div>
              )}
            </>
          )}

          {/* WAF Assessment tab */}
          {activeTab === "waf" && (
            <>
              {pillars.length === 0 && !isStreaming && (
                <Text style={{ color: tokens.colorNeutralForeground3 }}>
                  Run a review to see WAF pillar scores and findings.
                </Text>
              )}
              {pillars.length > 0 && (
                <>
                  {(() => {
                    const totalFindings = pillars.reduce((sum, p) => sum + p.findings.length, 0);
                    const totalResolved = pillars.reduce((sum, p) => sum + p.findings.filter((f) => isResolved(f)).length, 0);
                    return totalFindings > 0 ? (
                      <div style={{ marginBottom: "4px" }}>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{totalResolved}/{totalFindings} findings resolved</Text>
                        <ProgressBar value={totalFindings > 0 ? totalResolved / totalFindings : 0} color="success" style={{ marginTop: "4px" }} />
                      </div>
                    ) : null;
                  })()}
                  {pillars.map((p) => {
                    const pillarResolved = p.findings.filter((f) => isResolved(f)).length;
                    return (
                      <Accordion collapsible key={p.pillar}>
                        <AccordionItem value={p.pillar}>
                          <AccordionHeader>
                            <div className={styles.pillarHeader}>
                              <Text className={styles.pillarLabel}>{PILLAR_LABELS[p.pillar] ?? p.pillar}</Text>
                              {p.findings.length > 0 && (
                                <Badge appearance="tint" color={pillarResolved === p.findings.length ? "success" : "informative"} size="small">
                                  {pillarResolved}/{p.findings.length}
                                </Badge>
                              )}
                              <Badge color={BADGE_COLOR[p.score] ?? "informative"} appearance="filled" size="large">
                                {p.score}/5
                              </Badge>
                              <div className={styles.scoreBar}>
                                <ProgressBar value={p.score / 5} color={SCORE_COLOR[p.score] ?? "brand"} />
                              </div>
                            </div>
                          </AccordionHeader>
                          <AccordionPanel>
                            <Text weight="semibold" size={300}>Findings</Text>
                            <div style={{ marginTop: 4 }}>
                              {p.findings.map((f, i) => (
                                <div key={i} className={styles.findingRow}>
                                  <Checkbox
                                    checked={isResolved(f)}
                                    onChange={() => toggle(f)}
                                    label={<Text size={300} style={{ textDecoration: isResolved(f) ? "line-through" : "none", color: isResolved(f) ? tokens.colorNeutralForeground3 : undefined }}>{f}</Text>}
                                  />
                                </div>
                              ))}
                            </div>
                            <Text weight="semibold" size={300} style={{ marginTop: 8, display: "block" }}>Recommendations</Text>
                            <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                              {p.recommendations.map((r, i) => <li key={i}><Text size={300}>{r}</Text></li>)}
                            </ul>
                          </AccordionPanel>
                        </AccordionItem>
                      </Accordion>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* Diagram tabs */}
          {activeTab === "current-arch" && renderDiagramTab(currentDiagramXml, "current")}
          {activeTab === "target-arch" && renderDiagramTab(targetDiagramXml, "target")}

          {/* Text deliverable tabs */}
          {activeTab === "migration" && renderTextTab(migrationPlan, "migration")}
          {activeTab === "reference" && renderTextTab(referenceDesign, "reference")}
          {activeTab === "requirements" && renderTextTab(extractedRequirements, "requirements")}
        </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
