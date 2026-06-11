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
import { DocumentRegular, CopyRegular, CheckmarkRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, ConversationRecord, Mode } from "../types";

const TIMELINES = ["3 months", "6 months", "12 months", "18 months", "2+ years"];
const BUDGETS = ["< $50K", "$50K–$200K", "$200K–$1M", "$1M–$5M", "$5M+", "Not specified"];

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
  reqBox: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    resize: "vertical" as const,
    minHeight: "52px",
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
    "& table": { borderCollapse: "collapse" as const, width: "100%", marginBottom: "8px", fontSize: "12px" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px", textAlign: "left" as const },
    "& th": { background: tokens.colorNeutralBackground3, fontWeight: 700 },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px", fontSize: "12px" },
    "& pre": { background: tokens.colorNeutralBackground3, borderRadius: "6px", padding: "10px 12px", overflowX: "auto", fontSize: "12px" },
    "& blockquote": { borderLeft: "3px solid #0078D4", paddingLeft: "12px", color: tokens.colorNeutralForeground3, fontStyle: "italic" },
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

interface RfpProposalPanelProps {
  onRefine: (ctx: ChatMessage[]) => void;
  sessionId: string;
  onSave: (id: string, m: Mode, msgs: ChatMessage[], sr: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function RfpProposalPanel({ onRefine, sessionId, onSave }: RfpProposalPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming } = useSSE();

  const [customerName, setCustomerName] = useState("");
  const [businessProblem, setBusinessProblem] = useState("");
  const [workloadDescription, setWorkloadDescription] = useState("");
  const [scaleRequirements, setScaleRequirements] = useState("");
  const [timeline, setTimeline] = useState("12 months");
  const [budget, setBudget] = useState("Not specified");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef("");

  async function handleGenerate() {
    outputRef.current = "";
    setOutput("");
    const prompt = [
      `Write a structured Azure technical proposal for: ${customerName || "the customer"}.`,
      `Business problem: ${businessProblem || "modernize and scale their workloads on Azure"}`,
      workloadDescription ? `Workload: ${workloadDescription}` : "",
      scaleRequirements ? `Scale requirements: ${scaleRequirements}` : "",
      `Timeline: ${timeline}`,
      budget !== "Not specified" ? `Budget range: ${budget}` : "",
      "Structure: (1) Executive Summary, (2) Understanding of Requirements, (3) Proposed Architecture with Azure services, (4) Implementation Phases, (5) High-Level Cost Estimate, (6) Success Criteria and SLAs, (7) Why Microsoft Azure. Use professional proposal language.",
    ].filter(Boolean).join("\n");

    await stream("/api/chat", { mode: "rfpproposal", message: prompt }, (event) => {
      if (event.type === "token") {
        outputRef.current += event.content;
        setOutput(outputRef.current);
      }
    });

    if (outputRef.current) {
      const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: outputRef.current };
      onSave(sessionId, "rfpproposal", [msg], { text: outputRef.current });
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
    a.download = `azure-proposal-${(customerName || "customer").replace(/\s+/g, "-").toLowerCase()}.md`;
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
        <div className={styles.field} style={{ minWidth: "150px" }}>
          <span className={styles.label}>Customer / Prospect</span>
          <input className={styles.textInput} placeholder="Contoso Ltd." value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div className={styles.field} style={{ flex: 1, minWidth: "200px" }}>
          <span className={styles.label}>Business Problem</span>
          <textarea className={styles.reqBox} placeholder="What challenge is the customer trying to solve?" value={businessProblem} onChange={(e) => setBusinessProblem(e.target.value)} />
        </div>
        <div className={styles.field} style={{ flex: 1, minWidth: "200px" }}>
          <span className={styles.label}>Workload Description</span>
          <textarea className={styles.reqBox} placeholder="Describe the workload: app type, current infra, tech stack…" value={workloadDescription} onChange={(e) => setWorkloadDescription(e.target.value)} />
        </div>
        <div className={styles.field} style={{ minWidth: "160px" }}>
          <span className={styles.label}>Scale Requirements</span>
          <input className={styles.textInput} placeholder="e.g., 1M users, 10K TPS…" value={scaleRequirements} onChange={(e) => setScaleRequirements(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Timeline</span>
          <Select value={timeline} onChange={(_, d) => setTimeline(d.value)} style={{ minWidth: "130px" }}>
            {TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Budget Range</span>
          <Select value={budget} onChange={(_, d) => setBudget(d.value)} style={{ minWidth: "140px" }}>
            {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </div>
        <Button appearance="primary" icon={<DocumentRegular />} onClick={handleGenerate} disabled={isStreaming}>
          {isStreaming ? <Spinner size="tiny" /> : "Write Proposal"}
        </Button>
      </div>

      <div className={styles.output}>
        {!output && !isStreaming && (
          <div className={styles.empty}>
            <DocumentRegular style={{ fontSize: 40 }} />
            <Text size={300}>Fill in the customer details above and click Write Proposal.</Text>
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
