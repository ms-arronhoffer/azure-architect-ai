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
import { BranchForkRegular, CopyRegular, CheckmarkRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, ConversationRecord, Mode } from "../types";

const DEPLOY_TARGETS = ["Azure Container Apps", "Azure Kubernetes Service (AKS)", "Azure App Service", "Azure Functions", "Azure Static Web Apps"];
const PLATFORMS = ["GitHub Actions", "Azure DevOps"];
const STACKS = ["Node.js", "Python", "Java", "Go", ".NET / C#", "React / Next.js", "Ruby", "PHP", "Other"];

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
    minHeight: "56px",
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

interface PipelineForgePanelProps {
  onRefine: (ctx: ChatMessage[]) => void;
  sessionId: string;
  onSave: (id: string, m: Mode, msgs: ChatMessage[], sr: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function PipelineForgePanel({ onRefine, sessionId, onSave, initialSession }: PipelineForgePanelProps) {
  const styles = useStyles();
  const { stream, isStreaming } = useSSE();

  const [appName, setAppName] = useState(initialSession ? "" : "");
  const [stack, setStack] = useState("Node.js");
  const [deployTarget, setDeployTarget] = useState("Azure Container Apps");
  const [platform, setPlatform] = useState("GitHub Actions");
  const [securityReqs, setSecurityReqs] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef("");

  async function handleGenerate() {
    outputRef.current = "";
    setOutput("");
    const prompt = [
      `Generate a complete CI/CD pipeline YAML for: ${appName || "a cloud application"}.`,
      `Stack: ${stack}`,
      `Deploy target: ${deployTarget}`,
      `Pipeline platform: ${platform}`,
      securityReqs ? `Security requirements: ${securityReqs}` : "",
      "Include: build, test, SAST scan (Trivy or CodeQL), and deploy stages with workload identity (no secrets in YAML).",
    ].filter(Boolean).join("\n");

    await stream("/api/chat", { mode: "pipelineforge", message: prompt }, (event) => {
      if (event.type === "token") {
        outputRef.current += event.content;
        setOutput(outputRef.current);
      }
    });

    if (outputRef.current) {
      const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: outputRef.current };
      onSave(sessionId, "pipelineforge", [msg], { text: outputRef.current });
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
    a.download = `pipeline-${(appName || "app").replace(/\s+/g, "-").toLowerCase()}.md`;
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
        <div className={styles.field} style={{ minWidth: "160px" }}>
          <span className={styles.label}>App / Repo Name</span>
          <input className={styles.textInput} placeholder="my-app" value={appName} onChange={(e) => setAppName(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Stack</span>
          <Select value={stack} onChange={(_, d) => setStack(d.value)} style={{ minWidth: "140px" }}>
            {STACKS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Deploy Target</span>
          <Select value={deployTarget} onChange={(_, d) => setDeployTarget(d.value)} style={{ minWidth: "200px" }}>
            {DEPLOY_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Platform</span>
          <Select value={platform} onChange={(_, d) => setPlatform(d.value)} style={{ minWidth: "160px" }}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div className={styles.field} style={{ flex: 1, minWidth: "180px" }}>
          <span className={styles.label}>Security Requirements (optional)</span>
          <input className={styles.textInput} placeholder="e.g., SCA scan, container scanning, DAST…" value={securityReqs} onChange={(e) => setSecurityReqs(e.target.value)} />
        </div>
        <Button appearance="primary" icon={<BranchForkRegular />} onClick={handleGenerate} disabled={isStreaming}>
          {isStreaming ? <Spinner size="tiny" /> : "Forge Pipeline"}
        </Button>
      </div>

      <div className={styles.output}>
        {!output && !isStreaming && (
          <div className={styles.empty}>
            <BranchForkRegular style={{ fontSize: 40 }} />
            <Text size={300}>Configure your pipeline above and click Forge Pipeline.</Text>
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
