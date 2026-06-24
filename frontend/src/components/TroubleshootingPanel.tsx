import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Tab,
  TabList,
  Badge,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowUploadRegular,
  DismissCircleRegular,
  DocumentRegular,
} from "@fluentui/react-icons";
import { exportMessageToDocx } from "../utils/docxExport";
import { exportMarkdownToPdf } from "../utils/pdfExport";
import { useSSE } from "../hooks/useSSE";
import type {
  SseEvent,
  ChatMessage,
  ConversationRecord,
  Mode,
  DiagnosisResult,
  DiagnosticKqlQuery,
  RemediationRunbook,
} from "../types";

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  panel: { display: "flex", height: "100%", overflow: "hidden" },
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
  logTextarea: {
    display: "block",
    width: "100%",
    minHeight: "100px",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "vertical",
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground1,
  },
  tabBar: {
    padding: "8px 16px 0",
    background: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
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
    "& code": { fontFamily: "Consolas, 'Courier New', monospace", fontSize: "12px" },
    "& ul, & ol": { paddingLeft: "20px" },
  },
  hypothesisCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  kqlCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  kqlBlock: {
    background: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    padding: "10px 12px",
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: "12px",
    overflowX: "auto",
    whiteSpace: "pre",
    position: "relative" as const,
  },
  stepCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
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
    overflow: "hidden",
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

// ── Types ─────────────────────────────────────────────────────────────────────

type TroubleTab = "analysis" | "diagnosis" | "kql" | "runbook";

interface Attachment {
  id: string;
  name: string;
  content: string;
}

interface TroubleshootingPanelProps {
  sessionId?: string;
  onRefine?: (context: ChatMessage[]) => void;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}

const LIKELIHOOD_COLOR: Record<string, "danger" | "warning" | "informative"> = {
  high: "danger",
  medium: "warning",
  low: "informative",
};

const SEVERITY_COLOR: Record<string, "danger" | "warning" | "informative" | "success"> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "informative",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TroubleshootingPanel({ sessionId, onRefine: _onRefine, onSave, initialSession }: TroubleshootingPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [symptoms, setSymptoms] = useState("");
  const [errorLogs, setErrorLogs] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activeTab, setActiveTab] = useState<TroubleTab>("analysis");
  const [narrative, setNarrative] = useState(() => {
    const sr = initialSession?.structuredResult as { narrative?: string } | undefined;
    return sr?.narrative ?? "";
  });
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(() => {
    const sr = initialSession?.structuredResult as { diagnosis?: DiagnosisResult } | undefined;
    return sr?.diagnosis ?? null;
  });
  const [kqlQueries, setKqlQueries] = useState<DiagnosticKqlQuery[]>(() => {
    const sr = initialSession?.structuredResult as { kqlQueries?: DiagnosticKqlQuery[] } | undefined;
    return sr?.kqlQueries ?? [];
  });
  const [runbook, setRunbook] = useState<RemediationRunbook | null>(() => {
    const sr = initialSession?.structuredResult as { runbook?: RemediationRunbook } | undefined;
    return sr?.runbook ?? null;
  });
  const [statusMsg, setStatusMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const hasResults = narrative.length > 0 || diagnosis !== null;

  function handleFiles(files: File[]) {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setAttachments((prev) => [...prev, { id: crypto.randomUUID(), name: file.name, content: text }]);
      };
      reader.readAsText(file);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  async function handleDiagnose() {
    if (!symptoms.trim() || isStreaming) return;

    setNarrative("");
    setDiagnosis(null);
    setKqlQueries([]);
    setRunbook(null);
    setStatusMsg("");

    const attachText = attachments.map((a) => `\n\n[File: ${a.name}]\n${a.content}`).join("");
    const userContent = [
      `Symptoms:\n${symptoms}`,
      errorLogs.trim() ? `\nError Messages / Logs:\n${errorLogs}` : "",
      attachText,
    ].filter(Boolean).join("\n");

    let localNarrative = "";
    let localDiagnosis: DiagnosisResult | null = null;
    let localKql: DiagnosticKqlQuery[] = [];
    let localRunbook: RemediationRunbook | null = null;

    await stream(
      "/api/chat",
      { mode: "troubleshoot", messages: [{ role: "user", content: userContent }] },
      (event: SseEvent) => {
        if (event.type === "token") { localNarrative += event.content; setNarrative((n) => n + event.content); }
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "diagnosis") { localDiagnosis = event.diagnosis; setDiagnosis(event.diagnosis); }
        if (event.type === "kql_queries") { localKql = event.queries; setKqlQueries(event.queries); }
        if (event.type === "remediation_runbook") {
          const rb: RemediationRunbook = { steps: event.steps, escalation_path: event.escalation_path, estimated_resolution_minutes: event.estimated_minutes };
          localRunbook = rb;
          setRunbook(rb);
        }
      }
    );
    setStatusMsg("");
    setActiveTab("analysis");

    if (onSave && sessionId && (localNarrative || localDiagnosis)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: userContent },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(sessionId, "troubleshoot", msgs, { narrative: localNarrative, diagnosis: localDiagnosis, kqlQueries: localKql, runbook: localRunbook });
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function buildMarkdown(): string {
    const lines: string[] = ["# Troubleshooting Report", ""];

    if (symptoms.trim()) {
      lines.push("## Symptoms", "", symptoms.trim(), "");
    }
    if (errorLogs.trim()) {
      lines.push("## Error Messages / Logs", "", "```", errorLogs.trim(), "```", "");
    }
    if (narrative.trim()) {
      lines.push("## Analysis", "", narrative.trim(), "");
    }
    if (diagnosis) {
      lines.push("## Diagnosis", "");
      lines.push(`- **Severity:** ${(diagnosis.severity ?? "").toUpperCase()}`);
      if (diagnosis.affected_services?.length) {
        lines.push(`- **Affected services:** ${diagnosis.affected_services.join(", ")}`);
      }
      if (diagnosis.estimated_blast_radius) {
        lines.push(`- **Estimated blast radius:** ${diagnosis.estimated_blast_radius}`);
      }
      lines.push("");
      const hypotheses = diagnosis.root_cause_hypotheses ?? [];
      if (hypotheses.length) {
        lines.push("### Root Cause Hypotheses", "");
        hypotheses.forEach((h, i) => {
          lines.push(`${i + 1}. **${h.hypothesis}** _(${(h.likelihood ?? "").toUpperCase()}${h.azure_service ? `, ${h.azure_service}` : ""})_`);
          if (h.evidence_to_confirm) {
            lines.push(`   - Evidence needed: ${h.evidence_to_confirm}`);
          }
        });
        lines.push("");
      }
    }
    if (kqlQueries.length) {
      lines.push("## KQL Queries", "");
      kqlQueries.forEach((q) => {
        lines.push(`### ${q.name}${q.table ? ` (${q.table})` : ""}`, "");
        if (q.purpose) lines.push(q.purpose, "");
        lines.push("```kql", q.query, "```", "");
      });
    }
    if (runbook) {
      lines.push("## Remediation Runbook", "");
      if (runbook.estimated_resolution_minutes != null) {
        lines.push(`_Estimated resolution: ${runbook.estimated_resolution_minutes} min_`, "");
      }
      (runbook.steps ?? []).forEach((step) => {
        lines.push(`### Step ${step.step_number}: ${step.action}`, "");
        if (step.command) lines.push("```", step.command, "```", "");
        if (step.expected_output) lines.push(`Expected: ${step.expected_output}`, "");
        if (step.if_fails) lines.push(`If fails: ${step.if_fails}`, "");
      });
      if (runbook.escalation_path) {
        lines.push("### Escalation Path", "", runbook.escalation_path, "");
      }
    }

    return lines.join("\n");
  }

  function handleExport(format: "md" | "docx" | "pdf") {
    if (!hasResults) return;
    const md = buildMarkdown();
    if (format === "docx") {
      void exportMessageToDocx(md, "troubleshooting-report.docx");
      return;
    }
    if (format === "pdf") {
      exportMarkdownToPdf(md, "troubleshooting-report.pdf");
      return;
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "troubleshooting-report.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderAnalysisTab() {
    if (!hasResults && !isStreaming) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Describe your symptoms and paste error logs to get a structured root-cause analysis, KQL queries, and remediation runbook.
          </Text>
          <Button appearance="primary" onClick={handleDiagnose} disabled={!symptoms.trim()}>
            Diagnose Issue
          </Button>
        </div>
      );
    }
    return (
      <div>
        {diagnosis && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
            <Badge appearance="filled" color={SEVERITY_COLOR[diagnosis.severity] ?? "informative"} size="large">
              {(diagnosis.severity ?? "").toUpperCase()}
            </Badge>
            {(diagnosis.affected_services ?? []).map((s) => (
              <Badge key={s} appearance="tint" color="brand" size="small">{s}</Badge>
            ))}
            {diagnosis.estimated_blast_radius && (
              <Badge appearance="tint" color="warning" size="small">{diagnosis.estimated_blast_radius}</Badge>
            )}
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

  function renderDiagnosisTab() {
    const hypotheses = diagnosis?.root_cause_hypotheses ?? [];
    if (!diagnosis || hypotheses.length === 0) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run a diagnosis to see ranked root cause hypotheses.
          </Text>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Text weight="semibold" size={400}>Root Cause Hypotheses</Text>
        {hypotheses.map((h, i) => (
          <div key={i} className={styles.hypothesisCard}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Badge appearance="filled" color={LIKELIHOOD_COLOR[h.likelihood] ?? "informative"} size="small">
                {(h.likelihood ?? "").toUpperCase()}
              </Badge>
              {h.azure_service && (
                <Badge appearance="tint" color="brand" size="small">{h.azure_service}</Badge>
              )}
            </div>
            <Text size={300} weight="semibold">{h.hypothesis}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Evidence needed: {h.evidence_to_confirm}
            </Text>
          </div>
        ))}
      </div>
    );
  }

  function renderKqlTab() {
    if (!kqlQueries.length) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run a diagnosis to generate Azure Monitor KQL queries.
          </Text>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {kqlQueries.map((q, i) => (
          <div key={i} className={styles.kqlCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text size={300} weight="semibold">{q.name}</Text>
              {q.table && <Badge appearance="tint" color="informative" size="small">{q.table}</Badge>}
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{q.purpose}</Text>
            <div style={{ position: "relative" }}>
              <div className={styles.kqlBlock}>{q.query}</div>
              <Button
                size="small"
                appearance="outline"
                style={{ marginTop: "6px" }}
                onClick={() => copyToClipboard(q.query)}
              >
                Copy Query
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderRunbookTab() {
    if (!runbook) {
      return (
        <div className={styles.emptyTabHint}>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Run a diagnosis to generate a step-by-step remediation runbook.
          </Text>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {runbook.estimated_resolution_minutes != null && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
            <Badge appearance="tint" color="informative">Est. {runbook.estimated_resolution_minutes} min</Badge>
          </div>
        )}
        {(runbook.steps ?? []).map((step, i) => (
          <div key={i} className={styles.stepCard}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Badge appearance="filled" color="brand" size="small">Step {step.step_number}</Badge>
            </div>
            <Text size={300} weight="semibold">{step.action}</Text>
            {step.command && (
              <div>
                <div className={styles.kqlBlock}>{step.command}</div>
                <Button size="small" appearance="outline" style={{ marginTop: "4px" }} onClick={() => copyToClipboard(step.command!)}>
                  Copy
                </Button>
              </div>
            )}
            {step.expected_output && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Expected: {step.expected_output}</Text>
            )}
            {step.if_fails && (
              <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>If fails: {step.if_fails}</Text>
            )}
          </div>
        ))}
        {runbook.escalation_path && (
          <div style={{ marginTop: "8px", padding: "12px", background: tokens.colorNeutralBackground3, borderRadius: "8px" }}>
            <Text size={200} weight="semibold" block>Escalation Path</Text>
            <Text size={200}>{runbook.escalation_path}</Text>
          </div>
        )}
      </div>
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
        {/* ── Left Sidebar ─────────────────────────────────────────────── */}
        <Panel defaultSize="32%" minSize="15%" maxSize="65%">
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: "16px", background: tokens.colorNeutralBackground1 }}>
            <Text weight="semibold" size={500}>Troubleshoot</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-10px" }}>
              Diagnose Azure architecture issues with root-cause analysis, KQL queries, and remediation runbooks.
            </Text>

            <div>
              <span className={styles.sectionLabel}>Symptoms</span>
              <div className={styles.reqBox}>
                <textarea
                  className={styles.reqTextarea}
                  placeholder="Describe what's wrong: slow responses, 5xx errors, failed deployments, unexpected costs, connectivity issues…"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                />
              </div>
            </div>

            <div>
              <span className={styles.sectionLabel}>Error Messages / Logs</span>
              <div className={styles.reqBox}>
                <textarea
                  className={styles.logTextarea}
                  placeholder="Paste error messages, stack traces, or log excerpts here…"
                  value={errorLogs}
                  onChange={(e) => setErrorLogs(e.target.value)}
                />
              </div>
            </div>

            <div>
              <span className={styles.sectionLabel}>Attachments (optional)</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.log,.json,.yaml,.yml,.bicep"
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
                Upload Log Files
              </Button>
              {attachments.length > 0 && (
                <div className={styles.attachmentList} style={{ marginTop: "8px" }}>
                  {attachments.map((att) => (
                    <div key={att.id} className={styles.attachmentItem}>
                      <DocumentRegular style={{ width: 24, height: 24, color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                      <Text size={200} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</Text>
                      <Button
                        appearance="transparent"
                        icon={<DismissCircleRegular />}
                        size="small"
                        onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                        aria-label={`Remove ${att.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isStreaming ? (
              <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
            ) : (
              <Button appearance="primary" onClick={handleDiagnose} disabled={!symptoms.trim()}>
                Diagnose Issue
              </Button>
            )}

            {statusMsg && (
              <div className={styles.status}>
                <Spinner size="tiny" />
                <span>{statusMsg}</span>
              </div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        {/* ── Right Panel ──────────────────────────────────────────────── */}
        <Panel>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className={styles.tabBar}>
              <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as TroubleTab)} size="small">
                <Tab value="analysis">Analysis{hasResults && <span className={styles.tabDot} />}</Tab>
                <Tab value="diagnosis">Diagnosis{diagnosis && <span className={styles.tabDot} />}</Tab>
                <Tab value="kql">KQL Queries{kqlQueries.length > 0 && <span className={styles.tabDot} />}</Tab>
                <Tab value="runbook">Runbook{runbook && <span className={styles.tabDot} />}</Tab>
              </TabList>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    size="small"
                    appearance="outline"
                    icon={<ArrowDownloadRegular />}
                    disabled={!hasResults}
                  >
                    Export
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => handleExport("md")}>Markdown (.md)</MenuItem>
                    <MenuItem onClick={() => handleExport("docx")}>Word (.docx)</MenuItem>
                    <MenuItem onClick={() => handleExport("pdf")}>PDF (.pdf)</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>

            <div className={styles.tabContent}>
              {activeTab === "analysis" && renderAnalysisTab()}
              {activeTab === "diagnosis" && renderDiagnosisTab()}
              {activeTab === "kql" && renderKqlTab()}
              {activeTab === "runbook" && renderRunbookTab()}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
