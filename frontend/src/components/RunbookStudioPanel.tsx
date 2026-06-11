import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Select,
  Spinner,
} from "@fluentui/react-components";
import { DocumentBulletListRegular, CopyRegular, CheckmarkRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, ConversationRecord, Mode } from "../types";

const FAILURE_SCENARIOS = [
  "Database failover",
  "Certificate expiry / renewal",
  "Regional outage",
  "Pod crashloop / OOMKilled",
  "Storage failure / data corruption",
  "API gateway outage",
  "Identity / RBAC misconfiguration",
  "Runaway cost / budget alert",
  "Security incident response",
  "Deployment rollback",
  "Custom…",
];
const RTO_OPTIONS = ["15 minutes", "1 hour", "4 hours", "8 hours", "24 hours", "Best effort"];

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  form: {
    padding: "16px 20px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "flex-end",
  },
  field: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "140px" },
  label: { fontSize: "11px", fontWeight: 700, color: tokens.colorNeutralForeground3, textTransform: "uppercase", letterSpacing: "0.06em" },
  textInput: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  output: { flex: 1, overflowY: "auto", padding: "20px 24px" },
  empty: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    height: "100%", gap: "12px", color: tokens.colorNeutralForeground4,
  },
  mdContent: {
    fontSize: "13px", lineHeight: 1.6, color: tokens.colorNeutralForeground1,
    "& h1, & h2, & h3": { marginTop: "16px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& li": { marginBottom: "3px" },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px", fontSize: "12px" },
    "& pre": { background: tokens.colorNeutralBackground3, borderRadius: "6px", padding: "10px 12px", overflowX: "auto", fontSize: "12px" },
  },
  actionBar: {
    padding: "10px 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    gap: "8px",
    flexShrink: 0,
  },
});

interface RunbookStudioPanelProps {
  onRefine: (ctx: ChatMessage[]) => void;
  sessionId: string;
  onSave: (id: string, m: Mode, msgs: ChatMessage[], sr: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function RunbookStudioPanel({ onRefine, sessionId, onSave }: RunbookStudioPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming } = useSSE();

  const [scenario, setScenario] = useState(FAILURE_SCENARIOS[0]);
  const [customScenario, setCustomScenario] = useState("");
  const [services, setServices] = useState("");
  const [rto, setRto] = useState("1 hour");
  const [escalation, setEscalation] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef("");

  async function handleGenerate() {
    outputRef.current = "";
    setOutput("");
    const effectiveScenario = scenario === "Custom…" ? customScenario : scenario;
    const prompt = [
      `Generate a detailed SRE runbook for the following failure scenario: ${effectiveScenario}.`,
      services ? `Azure services involved: ${services}` : "",
      `RTO target: ${rto}`,
      escalation ? `Escalation path: ${escalation}` : "",
      "Include: numbered step-by-step remediation steps with az CLI / kubectl commands, decision trees for branching scenarios, rollback steps, and post-incident checklist.",
    ].filter(Boolean).join("\n");

    await stream("/api/chat", { mode: "runbookstudio", messages: [{ role: "user", content: prompt }] }, (event) => {
      if (event.type === "token") {
        outputRef.current += event.content;
        setOutput(outputRef.current);
      }
    });

    if (outputRef.current) {
      const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: outputRef.current };
      onSave(sessionId, "runbookstudio", [msg], { text: outputRef.current });
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(outputRef.current).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleExport() {
    const blob = new Blob([outputRef.current], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (scenario === "Custom…" ? customScenario : scenario).replace(/\s+/g, "-").toLowerCase().slice(0, 40);
    a.download = `runbook-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRefineInChat() {
    if (!outputRef.current) return;
    const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: outputRef.current };
    onRefine([msg]);
  }

  return (
    <div className={styles.root}>
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.label}>Failure Scenario</span>
          <Select value={scenario} onChange={(_, d) => setScenario(d.value)} style={{ minWidth: "200px" }}>
            {FAILURE_SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        {scenario === "Custom…" && (
          <div className={styles.field} style={{ minWidth: "200px" }}>
            <span className={styles.label}>Describe scenario</span>
            <input className={styles.textInput} placeholder="e.g., Redis cache eviction storm…" value={customScenario} onChange={(e) => setCustomScenario(e.target.value)} />
          </div>
        )}
        <div className={styles.field} style={{ flex: 1, minWidth: "180px" }}>
          <span className={styles.label}>Azure Services Involved</span>
          <input className={styles.textInput} placeholder="e.g., Azure SQL, AKS, App Service, Redis…" value={services} onChange={(e) => setServices(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>RTO Target</span>
          <Select value={rto} onChange={(_, d) => setRto(d.value)} style={{ minWidth: "130px" }}>
            {RTO_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <div className={styles.field} style={{ minWidth: "180px" }}>
          <span className={styles.label}>Escalation Path (optional)</span>
          <input className={styles.textInput} placeholder="e.g., On-call SRE → Eng Manager" value={escalation} onChange={(e) => setEscalation(e.target.value)} />
        </div>
        <Button appearance="primary" icon={<DocumentBulletListRegular />} onClick={handleGenerate} disabled={isStreaming}>
          {isStreaming ? <Spinner size="tiny" /> : "Generate Runbook"}
        </Button>
      </div>

      <div className={styles.output}>
        {!output && !isStreaming && (
          <div className={styles.empty}>
            <DocumentBulletListRegular style={{ fontSize: 40 }} />
            <Text size={300}>Select a failure scenario above and click Generate Runbook.</Text>
          </div>
        )}
        {output && (
          <div className={styles.mdContent}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
          </div>
        )}
      </div>

      {output && (
        <div className={styles.actionBar}>
          <Button appearance="subtle" size="small" icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button appearance="subtle" size="small" icon={<ArrowDownloadRegular />} onClick={handleExport}>Export .md</Button>
          <Button appearance="subtle" size="small" onClick={handleRefineInChat}>Refine in Chat</Button>
        </div>
      )}
    </div>
  );
}
