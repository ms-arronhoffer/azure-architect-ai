import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
} from "@fluentui/react-components";
import { TagRegular, CopyRegular, CheckmarkRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, ConversationRecord, Mode } from "../types";

const DEFAULT_ENVIRONMENTS = "dev, test, prod";
const DEFAULT_REGIONS = "eastus=eus, westus2=wus2, westeurope=weu";

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
    "& table": { borderCollapse: "collapse" as const, width: "100%", marginBottom: "8px", fontSize: "12px" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px", textAlign: "left" as const },
    "& th": { background: tokens.colorNeutralBackground3, fontWeight: 700 },
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

interface NamingStandardsPanelProps {
  onRefine: (ctx: ChatMessage[]) => void;
  sessionId: string;
  onSave: (id: string, m: Mode, msgs: ChatMessage[], sr: unknown) => void;
  initialSession?: ConversationRecord;
}

export default function NamingStandardsPanel({ onRefine, sessionId, onSave }: NamingStandardsPanelProps) {
  const styles = useStyles();
  const { stream, isStreaming } = useSSE();

  const [orgPrefix, setOrgPrefix] = useState("");
  const [environments, setEnvironments] = useState(DEFAULT_ENVIRONMENTS);
  const [regions, setRegions] = useState(DEFAULT_REGIONS);
  const [resourceTypes, setResourceTypes] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef("");

  async function handleGenerate() {
    outputRef.current = "";
    setOutput("");
    const prompt = [
      "Generate a complete Azure CAF naming convention standard.",
      orgPrefix ? `Org prefix: ${orgPrefix}` : "",
      `Environments: ${environments}`,
      `Region abbreviations: ${regions}`,
      resourceTypes ? `Resource types in scope: ${resourceTypes}` : "Include all common Azure resource types.",
      extraContext ? `Additional context: ${extraContext}` : "",
      "Output: (1) a full naming spec table with resource type, pattern, and example; (2) a ready-to-use Bicep naming.bicep module; (3) a Terraform locals.tf equivalent.",
    ].filter(Boolean).join("\n");

    await stream("/api/chat", { mode: "namingstandards", messages: [{ role: "user", content: prompt }] }, (event) => {
      if (event.type === "token") {
        outputRef.current += event.content;
        setOutput(outputRef.current);
      }
    });

    if (outputRef.current) {
      const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: outputRef.current };
      onSave(sessionId, "namingstandards", [msg], { text: outputRef.current });
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
    a.download = `naming-standards-${(orgPrefix || "org").replace(/\s+/g, "-").toLowerCase()}.md`;
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
        <div className={styles.field} style={{ minWidth: "120px" }}>
          <span className={styles.label}>Org Prefix</span>
          <input className={styles.textInput} placeholder="contoso" value={orgPrefix} onChange={(e) => setOrgPrefix(e.target.value)} />
        </div>
        <div className={styles.field} style={{ minWidth: "180px" }}>
          <span className={styles.label}>Environments</span>
          <input className={styles.textInput} placeholder="dev, test, prod" value={environments} onChange={(e) => setEnvironments(e.target.value)} />
        </div>
        <div className={styles.field} style={{ minWidth: "240px" }}>
          <span className={styles.label}>Region Abbreviations</span>
          <input className={styles.textInput} placeholder="eastus=eus, westus2=wus2" value={regions} onChange={(e) => setRegions(e.target.value)} />
        </div>
        <div className={styles.field} style={{ minWidth: "200px" }}>
          <span className={styles.label}>Resource Types in Scope (optional)</span>
          <input className={styles.textInput} placeholder="VNet, SQL, AKS, Storage…" value={resourceTypes} onChange={(e) => setResourceTypes(e.target.value)} />
        </div>
        <div className={styles.field} style={{ minWidth: "180px" }}>
          <span className={styles.label}>Additional Context (optional)</span>
          <input className={styles.textInput} placeholder="e.g., multi-tenant SaaS, gov cloud…" value={extraContext} onChange={(e) => setExtraContext(e.target.value)} />
        </div>
        <Button appearance="primary" icon={<TagRegular />} onClick={handleGenerate} disabled={isStreaming}>
          {isStreaming ? <Spinner size="tiny" /> : "Generate Standards"}
        </Button>
      </div>

      <div className={styles.output}>
        {!output && !isStreaming && (
          <div className={styles.empty}>
            <TagRegular style={{ fontSize: 40 }} />
            <Text size={300}>Configure your naming parameters above and click Generate Standards.</Text>
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
