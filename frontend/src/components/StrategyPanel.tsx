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
import {
  TargetRegular,
  ChatRegular,
  ArrowDownloadRegular,
  ArrowLeftRegular,
  ArrowRightRegular,
} from "@fluentui/react-icons";
import type {
  ChatMessage,
  ConversationRecord,
  Mode,
  StrategyResult,
  WorkloadContext,
} from "../types";
import { useSSE } from "../hooks/useSSE";
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Packer,
  ExternalHyperlink,
  ShadingType,
} from "docx";

const WORKLOAD_TYPES = [
  "Cloud-Native Application",
  "Data Platform",
  "AI / ML Workload",
  "SAP on Azure",
  "IoT / Edge",
  "DevOps Platform",
  "Migration & Modernization",
  "Security & Identity",
  "API Platform / Governance",
  "High Performance Computing",
  "SaaS Product",
  "Other",
];

const BUSINESS_DRIVERS = [
  "Cost Reduction",
  "Agility & Speed",
  "Innovation / AI",
  "Resilience",
  "Security & Compliance",
  "Scalability",
  "Global Reach",
  "Sustainability",
];

const TIMELINE_OPTIONS = [
  "6 months",
  "12 months",
  "18 months",
  "3 years",
];

const MATURITY_OPTIONS = [
  "Greenfield (new workload, no legacy)",
  "Legacy Migration (moving from on-prem)",
  "Hybrid (split on-prem / cloud)",
  "Cloud-Optimizing (already in cloud, improving)",
];

const WAF_PILLARS: { key: keyof StrategyResult["waf_alignment"]; label: string }[] = [
  { key: "reliability", label: "Reliability" },
  { key: "security", label: "Security" },
  { key: "cost_optimization", label: "Cost Optimization" },
  { key: "operational_excellence", label: "Operational Excellence" },
  { key: "performance_efficiency", label: "Performance Efficiency" },
];

const useStyles = makeStyles({
  panel: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    padding: "20px 16px",
    gap: "14px",
    overflowY: "auto",
    boxSizing: "border-box",
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
    minHeight: "80px",
    lineHeight: "1.5",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  textInput: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  stepHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    paddingBottom: "10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stepBadge: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "#0078D4",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepTitle: { fontWeight: 700, fontSize: "14px", color: tokens.colorNeutralForeground1 },
  stepNav: {
    display: "flex",
    gap: "8px",
    marginTop: "auto",
    paddingTop: "16px",
  },
  chipGroup: { display: "flex", flexWrap: "wrap", gap: "6px" },
  chip: {
    padding: "4px 10px",
    borderRadius: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: "transparent",
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.12s",
    "&:hover": { background: "rgba(0,120,212,0.08)", borderColor: "#0078D4" },
  },
  chipActive: {
    background: "rgba(0,120,212,0.15)",
    borderColor: "#0078D4",
    color: "#50A6E8",
    fontWeight: 600,
  },
  contextRow: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  contextValue: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "5px 10px",
  },
  contextEmpty: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground4,
    fontStyle: "italic",
  },
  reviewCard: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  reviewRow: { display: "flex", flexDirection: "column", gap: "2px" },
  reviewLabel: { fontSize: "11px", fontWeight: 700, color: tokens.colorNeutralForeground4, textTransform: "uppercase", letterSpacing: "0.06em" },
  reviewValue: { fontSize: "12px", color: tokens.colorNeutralForeground2 },
  mdContent: {
    fontSize: "13px",
    lineHeight: 1.6,
    color: tokens.colorNeutralForeground1,
    "& h1, & h2, & h3": { marginTop: "16px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& li": { marginBottom: "4px" },
    "& strong": { fontWeight: 700 },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px", fontSize: "12px" },
  },
  pillarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
    marginTop: "16px",
  },
  pillarCard: {
    background: "var(--glass-bg)",
    border: "1px solid var(--glass-border)",
    borderRadius: "10px",
    padding: "14px",
    borderLeft: "3px solid #0078D4",
  },
  pillarName: { fontWeight: 700, fontSize: "13px", color: tokens.colorNeutralForeground1, marginBottom: "4px" },
  pillarDesc: { fontSize: "12px", color: tokens.colorNeutralForeground2, lineHeight: 1.5, marginBottom: "6px" },
  pillarRationale: { fontSize: "11px", color: tokens.colorNeutralForeground4, lineHeight: 1.4, fontStyle: "italic" },
  capTable: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  capTh: {
    background: tokens.colorNeutralBackground3,
    padding: "8px 12px",
    textAlign: "left" as const,
    fontWeight: 700,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: "nowrap" as const,
  },
  capTd: {
    padding: "10px 12px",
    verticalAlign: "top" as const,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
  },
  serviceBadge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: "4px",
    background: "rgba(0,120,212,0.15)",
    color: "#50A6E8",
    fontSize: "11px",
    fontWeight: 600,
    marginRight: "4px",
    marginBottom: "4px",
    border: "1px solid rgba(0,120,212,0.3)",
  },
  altText: { fontSize: "11px", color: tokens.colorNeutralForeground4 },
  wafGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "10px",
    marginBottom: "24px",
  },
  wafCard: {
    background: "var(--glass-bg)",
    border: "1px solid var(--glass-border)",
    borderRadius: "8px",
    padding: "14px",
  },
  wafPillarName: { fontWeight: 700, fontSize: "12px", color: tokens.colorNeutralForeground2, marginBottom: "8px" },
  wafScore: { fontSize: "22px", fontWeight: 700, color: tokens.colorNeutralForeground1, marginBottom: "4px" },
  wafScoreLabel: { fontSize: "11px", color: tokens.colorNeutralForeground4 },
  wafRecsTitle: { fontSize: "11px", fontWeight: 700, color: tokens.colorNeutralForeground3, marginTop: "10px", marginBottom: "4px" },
  wafRecItem: { fontSize: "11px", color: tokens.colorNeutralForeground2, lineHeight: 1.5, marginBottom: "3px" },
  riskTable: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  riskTh: {
    background: tokens.colorNeutralBackground3,
    padding: "8px 12px",
    textAlign: "left" as const,
    fontWeight: 700,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  riskTd: {
    padding: "10px 12px",
    verticalAlign: "top" as const,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
    fontSize: "12px",
  },
  sectionTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    marginBottom: "12px",
    marginTop: "4px",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: "12px",
    color: tokens.colorNeutralForeground4,
    padding: "40px",
    textAlign: "center",
  },
  actionBar: {
    padding: "12px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#0078D4",
    marginLeft: "6px",
    verticalAlign: "middle",
  },
  errorText: { color: tokens.colorStatusDangerForeground1, fontSize: "13px" },
  divider: { height: "1px", background: tokens.colorNeutralStroke2, margin: "4px 0" },
});

interface StrategyPanelProps {
  onRefine: (ctx: ChatMessage[]) => void;
  sessionId: string;
  onSave: (id: string, m: Mode, msgs: ChatMessage[], sr: unknown) => void;
  initialSession?: ConversationRecord;
  workloadContext?: WorkloadContext;
}

const statusColor: Record<string, string> = {
  Strong: "#107C10",
  Adequate: "#A37F00",
  Gap: "#C50F1F",
};

const impactColor: Record<string, string> = {
  H: "rgba(197,15,31,0.08)",
  M: "rgba(163,127,0,0.08)",
  L: "rgba(16,124,16,0.06)",
};

const impactLabel: Record<string, string> = { H: "High", M: "Medium", L: "Low" };

function buildMarkdownExport(inputs: FormInputs, result: StrategyResult): string {
  const lines: string[] = [];
  lines.push(`# Azure Strategy: ${inputs.workloadName || "Workload"}`);
  lines.push(`*Generated by Azure Architect AI*\n`);

  lines.push(`## Executive Summary\n`);
  lines.push(result.executive_summary);
  lines.push("");

  lines.push(`## Strategic Pillars\n`);
  result.strategic_pillars.forEach((p, i) => {
    lines.push(`### ${i + 1}. ${p.name}`);
    lines.push(p.description);
    lines.push(`> **Azure Rationale:** ${p.rationale}`);
    lines.push("");
  });

  lines.push(`## Azure Capability Map\n`);
  lines.push("| Capability Area | Azure Services | Justification | Alternatives |");
  lines.push("|---|---|---|---|");
  result.capability_map.forEach((r) => {
    lines.push(`| ${r.capability_area} | ${r.azure_services.join(", ")} | ${r.justification} | ${r.alternatives.join(", ")} |`);
  });
  lines.push("");

  lines.push(`## WAF Alignment\n`);
  WAF_PILLARS.forEach(({ key, label }) => {
    const p = result.waf_alignment[key];
    lines.push(`### ${label} — ${p.status} (${p.score}/5)`);
    p.recommendations.forEach((r) => lines.push(`- ${r}`));
    lines.push("");
  });

  lines.push(`## Risk Register\n`);
  lines.push("| Risk | Category | Impact | Likelihood | Mitigation |");
  lines.push("|---|---|---|---|---|");
  result.risk_register.forEach((r) => {
    lines.push(`| ${r.risk} | ${r.category} | ${impactLabel[r.impact] ?? r.impact} | ${impactLabel[r.likelihood] ?? r.likelihood} | ${r.mitigation} |`);
  });

  if (result.strategic_roadmap?.length) {
    lines.push("\n## Strategic Roadmap\n");
    result.strategic_roadmap.forEach((phase) => {
      lines.push(`### ${phase.phase}`);
      lines.push(`**Focus:** ${phase.focus}\n`);
      lines.push("**Key Initiatives:**");
      phase.key_initiatives.forEach((i) => lines.push(`- ${i}`));
      lines.push("\n**Success Metrics:**");
      phase.success_metrics.forEach((m) => lines.push(`- ${m}`));
      lines.push("");
    });
  }

  if (result.references?.length) {
    lines.push("\n## Reference Documentation\n");
    result.references.forEach((ref) => lines.push(`- [${ref.title}](${ref.url})`));
  }

  return lines.join("\n");
}

async function buildDocxExport(inputs: FormInputs, result: StrategyResult): Promise<Blob> {
  const blue = "0078D4";

  const stripMd = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/[#`_]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  const parseInline = (text: string, size = 18): TextRun[] => {
    const runs: TextRun[] = [];
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size }));
      if (m[1]) runs.push(new TextRun({ text: m[1], bold: true, size }));
      else if (m[2]) runs.push(new TextRun({ text: m[2], italics: true, size }));
      else if (m[3]) runs.push(new TextRun({ text: m[3], font: "Courier New", size }));
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size }));
    return runs.length > 0 ? runs : [new TextRun({ text, size })];
  };

  const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 180 } });

  const body = (text: string) => new Paragraph({ children: parseInline(stripMd(text), 20), spacing: { after: 100 } });

  const hCell = (text: string) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })] })],
    shading: { fill: blue, type: ShadingType.CLEAR, color: "auto" },
  });

  const dCell = (text: string, bold = false) => new TableCell({
    children: [new Paragraph({
      children: bold ? [new TextRun({ text: stripMd(text), bold: true, size: 18 })] : parseInline(text),
      spacing: { before: 60, after: 60 },
    })],
  });

  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: `Azure Strategy: ${inputs.workloadName || "Workload"}`, bold: true, color: blue, size: 52 })],
    spacing: { after: 120 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: inputs.workloadType || "Workload Strategy", color: "444444", size: 24 })],
    spacing: { after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Generated by Azure Architect AI", italics: true, color: "888888", size: 18 })],
    spacing: { after: 480 },
  }));

  children.push(h1("Executive Summary"));
  result.executive_summary.split("\n").filter((l) => l.trim()).forEach((line) => {
    children.push(body(line.trim()));
  });

  children.push(h1("Strategic Pillars"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: ["Pillar", "Description", "Azure Rationale"].map(hCell) }),
      ...result.strategic_pillars.map((p) => new TableRow({
        children: [dCell(p.name, true), dCell(p.description), dCell(p.rationale)],
      })),
    ],
  }));

  children.push(h1("Azure Capability Map"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: ["Capability Area", "Azure Services", "Justification", "Alternatives"].map(hCell) }),
      ...result.capability_map.map((row) => new TableRow({
        children: [
          dCell(row.capability_area, true),
          dCell(row.azure_services.join(", ")),
          dCell(row.justification),
          dCell(row.alternatives.join(", ")),
        ],
      })),
    ],
  }));

  children.push(h1("Well-Architected Framework Alignment"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: ["Pillar", "Status", "Score", "Recommendations"].map(hCell) }),
      ...WAF_PILLARS.map(({ key, label }) => {
        const p = result.waf_alignment[key];
        return new TableRow({
          children: [
            dCell(label, true),
            dCell(p.status),
            dCell(`${p.score}/5`),
            new TableCell({
              children: p.recommendations.map((r) => new Paragraph({ children: parseInline(`• ${r}`), spacing: { before: 40, after: 40 } })),
            }),
          ],
        });
      }),
    ],
  }));

  children.push(h1("Risk Register"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: ["Risk", "Category", "Impact", "Likelihood", "Mitigation"].map(hCell) }),
      ...result.risk_register.map((r) => new TableRow({
        children: [
          dCell(r.risk),
          dCell(r.category),
          dCell(impactLabel[r.impact] ?? r.impact),
          dCell(impactLabel[r.likelihood] ?? r.likelihood),
          dCell(r.mitigation),
        ],
      })),
    ],
  }));

  if (result.strategic_roadmap?.length) {
    children.push(h1("Strategic Roadmap"));
    result.strategic_roadmap.forEach((phase) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: phase.phase, bold: true, size: 24, color: blue })],
        spacing: { before: 200, after: 60 },
      }));
      children.push(body(phase.focus));
      children.push(new Paragraph({
        children: [new TextRun({ text: "Key Initiatives", bold: true, size: 20 })],
        spacing: { before: 120, after: 40 },
      }));
      phase.key_initiatives.forEach((initiative) => {
        children.push(new Paragraph({ children: parseInline(initiative), bullet: { level: 0 }, spacing: { after: 40 } }));
      });
      children.push(new Paragraph({
        children: [new TextRun({ text: "Success Metrics", bold: true, size: 20 })],
        spacing: { before: 120, after: 40 },
      }));
      phase.success_metrics.forEach((metric) => {
        children.push(new Paragraph({ children: parseInline(metric), bullet: { level: 0 }, spacing: { after: 40 } }));
      });
    });
  }

  if (result.references?.length) {
    children.push(h1("Reference Documentation"));
    children.push(body("The following Microsoft Learn resources support the recommendations in this strategy:"));
    result.references.forEach((ref) => {
      children.push(new Paragraph({
        children: [
          new ExternalHyperlink({
            link: ref.url,
            children: [new TextRun({ text: ref.title, style: "Hyperlink", size: 18 })],
          }),
        ],
        bullet: { level: 0 },
        spacing: { after: 80 },
      }));
    });
  }

  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

interface FormInputs {
  workloadName: string;
  workloadType: string;
  description: string;
  businessDrivers: string[];
  successCriteria: string;
  timeline: string;
  maturity: string;
  constraints: string;
}

const DEFAULT_INPUTS: FormInputs = {
  workloadName: "",
  workloadType: "",
  description: "",
  businessDrivers: [],
  successCriteria: "",
  timeline: "12 months",
  maturity: "",
  constraints: "",
};

export default function StrategyPanel({
  onRefine,
  sessionId,
  onSave,
  initialSession,
  workloadContext,
}: StrategyPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming } = useSSE();
  const [step, setStep] = useState(1);
  const [inputs, setInputs] = useState<FormInputs>(DEFAULT_INPUTS);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { inputs?: FormInputs; result?: StrategyResult };
    if (sr.inputs) setInputs(sr.inputs);
    if (sr.result) { setResult(sr.result); setStep(4); }
  }, []);

  function toggleDriver(driver: string) {
    setInputs((prev) => {
      const next = prev.businessDrivers.includes(driver)
        ? prev.businessDrivers.filter((d) => d !== driver)
        : [...prev.businessDrivers, driver];
      return { ...prev, businessDrivers: next };
    });
  }

  async function handleGenerate() {
    setError(null);
    await stream(
      "/api/strategy",
      {
        workload_name: inputs.workloadName,
        workload_type: inputs.workloadType,
        description: inputs.description,
        business_drivers: inputs.businessDrivers,
        success_criteria: inputs.successCriteria,
        timeline: inputs.timeline,
        maturity: inputs.maturity,
        constraints: inputs.constraints,
        region: workloadContext?.region ?? "",
        compliance: workloadContext?.complianceFramework ?? "",
        budget: workloadContext?.budgetRange ?? "",
        team_size: workloadContext?.teamSize ?? "",
      },
      (event) => {
        if (event.type === "strategy_result") {
          const sr = event.result;
          setResult(sr);
          setActiveTab("overview");
          const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "Strategy generated." };
          onSave(sessionId, "strategy", [msg], { inputs, result: sr });
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    );
  }

  function handleRefineInChat() {
    if (!result) return;
    const summary = buildMarkdownExport(inputs, result);
    const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: summary };
    onRefine([msg]);
  }

  async function handleExport() {
    if (!result) return;
    const blob = await buildDocxExport(inputs, result);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `azure-strategy-${inputs.workloadName.replace(/\s+/g, "-").toLowerCase() || "workload"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderStep() {
    switch (step) {
      case 1:
        return (
          <>
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>1</span>
              <span className={styles.stepTitle}>Workload Profile</span>
            </div>
            <div>
              <span className={styles.label}>Workload Name</span>
              <input
                className={styles.textInput}
                placeholder="e.g., Customer Portal, Data Lakehouse"
                value={inputs.workloadName}
                onChange={(e) => setInputs((p) => ({ ...p, workloadName: e.target.value }))}
              />
            </div>
            <div>
              <span className={styles.label}>Workload Type</span>
              <Select
                value={inputs.workloadType}
                onChange={(_, d) => setInputs((p) => ({ ...p, workloadType: d.value }))}
                style={{ width: "100%" }}
              >
                <option value="">Select type…</option>
                {WORKLOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <span className={styles.label}>Description</span>
              <textarea
                className={styles.reqBox}
                placeholder="Describe what this workload does, who uses it, and its current state…"
                value={inputs.description}
                onChange={(e) => setInputs((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </>
        );
      case 2:
        return (
          <>
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>2</span>
              <span className={styles.stepTitle}>Strategic Goals</span>
            </div>
            <div>
              <span className={styles.label}>Business Drivers (select all that apply)</span>
              <div className={styles.chipGroup}>
                {BUSINESS_DRIVERS.map((d) => (
                  <button
                    key={d}
                    className={`${styles.chip} ${inputs.businessDrivers.includes(d) ? styles.chipActive : ""}`}
                    onClick={() => toggleDriver(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={styles.label}>Success Criteria</span>
              <textarea
                className={styles.reqBox}
                placeholder="What does success look like? (e.g., 99.9% SLA, 50% cost reduction, sub-100ms latency)"
                value={inputs.successCriteria}
                onChange={(e) => setInputs((p) => ({ ...p, successCriteria: e.target.value }))}
              />
            </div>
            <div>
              <span className={styles.label}>Timeline Horizon</span>
              <Select
                value={inputs.timeline}
                onChange={(_, d) => setInputs((p) => ({ ...p, timeline: d.value }))}
                style={{ width: "100%" }}
              >
                {TIMELINE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>3</span>
              <span className={styles.stepTitle}>Constraints</span>
            </div>
            <div>
              <span className={styles.label}>Current Maturity</span>
              <Select
                value={inputs.maturity}
                onChange={(_, d) => setInputs((p) => ({ ...p, maturity: d.value }))}
                style={{ width: "100%" }}
              >
                <option value="">Select maturity…</option>
                {MATURITY_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div>
              <span className={styles.label}>Key Constraints</span>
              <textarea
                className={styles.reqBox}
                placeholder="e.g., Cannot re-architect database, team has no Kubernetes experience, must support air-gap…"
                value={inputs.constraints}
                onChange={(e) => setInputs((p) => ({ ...p, constraints: e.target.value }))}
              />
            </div>
            <div className={styles.divider} />
            <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground3 }}>
              From Workload Context
            </Text>
            {[
              { label: "Primary Region", value: workloadContext?.region },
              { label: "Compliance", value: workloadContext?.complianceFramework },
              { label: "Budget Range", value: workloadContext?.budgetRange },
              { label: "Team Size", value: workloadContext?.teamSize },
            ].map(({ label, value }) => (
              <div key={label} className={styles.contextRow}>
                <span className={styles.label}>{label}</span>
                {value ? (
                  <span className={styles.contextValue}>{value}</span>
                ) : (
                  <span className={styles.contextEmpty}>Not set — configure in Workload Context</span>
                )}
              </div>
            ))}
          </>
        );
      case 4:
        return (
          <>
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>4</span>
              <span className={styles.stepTitle}>Review & Generate</span>
            </div>
            <div className={styles.reviewCard}>
              {[
                { label: "Workload", value: `${inputs.workloadName} — ${inputs.workloadType}` },
                { label: "Description", value: inputs.description },
                { label: "Drivers", value: inputs.businessDrivers.join(", ") || "None selected" },
                { label: "Timeline", value: inputs.timeline },
                { label: "Maturity", value: inputs.maturity || "Not specified" },
                { label: "Region", value: workloadContext?.region || "Not set" },
                { label: "Compliance", value: workloadContext?.complianceFramework || "None" },
              ].map(({ label, value }) => (
                <div key={label} className={styles.reviewRow}>
                  <span className={styles.reviewLabel}>{label}</span>
                  <span className={styles.reviewValue}>{value}</span>
                </div>
              ))}
            </div>
            {error && <Text className={styles.errorText}>{error}</Text>}
            {isStreaming ? (
              <Spinner label="Generating Azure strategy…" size="small" />
            ) : (
              <Button
                appearance="primary"
                icon={<TargetRegular />}
                onClick={handleGenerate}
                style={{ marginTop: "4px" }}
              >
                Generate Strategy
              </Button>
            )}
          </>
        );
    }
  }

  function renderOverview() {
    if (!result) return <div className={styles.emptyState}><TargetRegular style={{ fontSize: 40 }} /><Text>Complete the wizard to generate your strategy.</Text></div>;
    return (
      <>
        <div className={styles.mdContent}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.executive_summary}</ReactMarkdown>
        </div>
        <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>Strategic Pillars</div>
        <div className={styles.pillarGrid}>
          {result.strategic_pillars.map((p) => (
            <div key={p.name} className={styles.pillarCard}>
              <div className={styles.pillarName}>{p.name}</div>
              <div className={styles.pillarDesc}>{p.description}</div>
              <div className={styles.pillarRationale}>{p.rationale}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderCapabilityMap() {
    if (!result) return <div className={styles.emptyState}><Text>No data yet.</Text></div>;
    return (
      <table className={styles.capTable}>
        <thead>
          <tr>
            <th className={styles.capTh} style={{ width: "18%" }}>Capability Area</th>
            <th className={styles.capTh} style={{ width: "28%" }}>Azure Services</th>
            <th className={styles.capTh} style={{ width: "32%" }}>Justification</th>
            <th className={styles.capTh} style={{ width: "22%" }}>Alternatives</th>
          </tr>
        </thead>
        <tbody>
          {result.capability_map.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
              <td className={styles.capTd} style={{ fontWeight: 600 }}>{row.capability_area}</td>
              <td className={styles.capTd}>
                {row.azure_services.map((s) => (
                  <span key={s} className={styles.serviceBadge}>{s}</span>
                ))}
              </td>
              <td className={styles.capTd}>{row.justification}</td>
              <td className={styles.capTd}>
                <span className={styles.altText}>{row.alternatives.join(", ")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderWafRisk() {
    if (!result) return <div className={styles.emptyState}><Text>No data yet.</Text></div>;
    return (
      <>
        <div className={styles.sectionTitle}>WAF Pillar Assessment</div>
        <div className={styles.wafGrid}>
          {WAF_PILLARS.map(({ key, label }) => {
            const pillar = result.waf_alignment[key];
            const color = statusColor[pillar.status] ?? "#0078D4";
            return (
              <div key={key} className={styles.wafCard} style={{ borderTop: `3px solid ${color}` }}>
                <div className={styles.wafPillarName}>{label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span className={styles.wafScore}>{pillar.score}</span>
                  <span className={styles.wafScoreLabel}>/5</span>
                  <Badge
                    style={{ marginLeft: "auto", background: color, color: "#fff" }}
                    size="small"
                  >
                    {pillar.status}
                  </Badge>
                </div>
                <div className={styles.wafRecsTitle}>Recommendations</div>
                {pillar.recommendations.map((r, i) => (
                  <div key={i} className={styles.wafRecItem}>• {r}</div>
                ))}
              </div>
            );
          })}
        </div>

        <div className={styles.sectionTitle} style={{ marginTop: "24px" }}>Risk Register</div>
        <table className={styles.riskTable}>
          <thead>
            <tr>
              <th className={styles.riskTh} style={{ width: "25%" }}>Risk</th>
              <th className={styles.riskTh} style={{ width: "14%" }}>Category</th>
              <th className={styles.riskTh} style={{ width: "9%" }}>Impact</th>
              <th className={styles.riskTh} style={{ width: "12%" }}>Likelihood</th>
              <th className={styles.riskTh}>Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {result.risk_register.map((r, i) => (
              <tr key={i} style={{ background: impactColor[r.impact] ?? "transparent" }}>
                <td className={styles.riskTd} style={{ fontWeight: 500 }}>{r.risk}</td>
                <td className={styles.riskTd}>{r.category}</td>
                <td className={styles.riskTd}>
                  <span style={{ color: statusColor[r.impact === "H" ? "Gap" : r.impact === "M" ? "Adequate" : "Strong"], fontWeight: 700 }}>
                    {impactLabel[r.impact] ?? r.impact}
                  </span>
                </td>
                <td className={styles.riskTd}>{impactLabel[r.likelihood] ?? r.likelihood}</td>
                <td className={styles.riskTd}>{r.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {result.references?.length > 0 && (
          <>
            <div className={styles.sectionTitle} style={{ marginTop: "28px" }}>Reference Documentation</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {result.references.map((ref, i) => (
                <a
                  key={i}
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "13px", color: "#50A6E8", textDecoration: "none", display: "flex", alignItems: "flex-start", gap: "6px" }}
                >
                  <span style={{ flexShrink: 0, marginTop: "1px", opacity: 0.6 }}>↗</span>
                  <span>{ref.title}</span>
                </a>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  function renderRoadmap() {
    if (!result?.strategic_roadmap?.length) {
      return <div className={styles.emptyState}><Text>No roadmap data yet.</Text></div>;
    }
    const phaseColors = ["#0078D4", "#107C10", "#A37F00", "#8764B8"];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {result.strategic_roadmap.map((phase, i) => (
          <div
            key={i}
            style={{
              background: "var(--glass-bg)",
              border: "1px solid var(--glass-border)",
              borderRadius: "10px",
              borderLeft: `4px solid ${phaseColors[i % phaseColors.length]}`,
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{
                width: "26px", height: "26px", borderRadius: "50%",
                background: phaseColors[i % phaseColors.length],
                color: "#fff", fontSize: "12px", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{ fontWeight: 700, fontSize: "14px", color: tokens.colorNeutralForeground1 }}>
                {phase.phase}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: tokens.colorNeutralForeground3, fontStyle: "italic", marginBottom: "12px", marginLeft: "36px" }}>
              {phase.focus}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginLeft: "36px" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: tokens.colorNeutralForeground4, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                  Key Initiatives
                </div>
                {phase.key_initiatives.map((initiative, j) => (
                  <div key={j} style={{ fontSize: "12px", color: tokens.colorNeutralForeground2, lineHeight: 1.5, marginBottom: "3px", display: "flex", gap: "6px" }}>
                    <span style={{ color: phaseColors[i % phaseColors.length], flexShrink: 0 }}>›</span>
                    <span>{initiative}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: tokens.colorNeutralForeground4, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                  Success Metrics
                </div>
                {phase.success_metrics.map((metric, j) => (
                  <div key={j} style={{ fontSize: "12px", color: tokens.colorNeutralForeground2, lineHeight: 1.5, marginBottom: "3px", display: "flex", gap: "6px" }}>
                    <span style={{ color: "#107C10", flexShrink: 0 }}>✓</span>
                    <span>{metric}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
        <Panel defaultSize="32%" minSize="22%" maxSize="55%">
          <div className={styles.sidebar}>
            {renderStep()}
            <div className={styles.stepNav}>
              {step > 1 && (
                <Button
                  appearance="subtle"
                  icon={<ArrowLeftRegular />}
                  onClick={() => setStep((s) => s - 1)}
                  disabled={isStreaming}
                  size="small"
                >
                  Back
                </Button>
              )}
              {step < 4 && (
                <Button
                  appearance="primary"
                  icon={<ArrowRightRegular />}
                  iconPosition="after"
                  onClick={() => setStep((s) => s + 1)}
                  size="small"
                  style={{ marginLeft: "auto" }}
                >
                  Next
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        <Panel>
          <div className={styles.right}>
            <div className={styles.tabBar}>
              <TabList
                selectedValue={activeTab}
                onTabSelect={(_, d) => setActiveTab(d.value as string)}
                size="small"
              >
                <Tab value="overview">
                  Overview{result && <span className={styles.tabDot} />}
                </Tab>
                <Tab value="capability">
                  Capability Map{result && <span className={styles.tabDot} />}
                </Tab>
                <Tab value="wafrisk">
                  WAF &amp; Risk{result && <span className={styles.tabDot} />}
                </Tab>
                <Tab value="roadmap">
                  Roadmap{result?.strategic_roadmap?.length ? <span className={styles.tabDot} /> : null}
                </Tab>
              </TabList>
            </div>
            <div className={styles.tabContent}>
              {activeTab === "overview" && renderOverview()}
              {activeTab === "capability" && renderCapabilityMap()}
              {activeTab === "wafrisk" && renderWafRisk()}
              {activeTab === "roadmap" && renderRoadmap()}
            </div>
            {result && (
              <div className={styles.actionBar}>
                <Button
                  appearance="subtle"
                  icon={<ChatRegular />}
                  onClick={handleRefineInChat}
                  size="small"
                >
                  Refine in Chat
                </Button>
                <Button
                  appearance="subtle"
                  icon={<ArrowDownloadRegular />}
                  onClick={handleExport}
                  size="small"
                >
                  Export Word (.docx)
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
