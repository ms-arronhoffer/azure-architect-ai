import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Link,
  Button,
} from "@fluentui/react-components";
import { CopyRegular, CheckmarkRegular, BotRegular, PersonRegular, BranchRegular, DocumentRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { exportMessageToDocx } from "../utils/docxExport";
import StructuredResultCard from "./chat/StructuredResultCard";
import type { ChatMessage as ChatMessageType, Mode } from "../types";

const useStyles = makeStyles({
  rowUser: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    alignItems: "flex-end",
  },
  rowAssistant: {
    display: "flex",
    justifyContent: "flex-start",
    gap: "8px",
    alignItems: "flex-end",
  },
  avatar: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: "14px",
  },
  avatarUser: {
    background: "linear-gradient(135deg, #0078D4 0%, #1B94E8 100%)",
    color: "#fff",
  },
  avatarBot: {
    background: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  contentUser: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "4px",
    maxWidth: "78%",
  },
  contentAssistant: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    maxWidth: "88%",
    minWidth: 0,
  },
  bubble: {
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "14px",
    lineHeight: "1.6",
    "& p": { margin: "4px 0" },
    "& p:first-child": { marginTop: 0 },
    "& p:last-child": { marginBottom: 0 },
    "& ul, & ol": { paddingLeft: "22px", margin: "6px 0" },
    "& li": { margin: "2px 0" },
    "& h2": { fontSize: "15px", fontWeight: 700, margin: "14px 0 6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, paddingBottom: "4px" },
    "& h3": { fontSize: "14px", fontWeight: 600, margin: "10px 0 4px" },
    "& strong": { fontWeight: 600 },
    "& table": { borderCollapse: "collapse", width: "100%", fontSize: "13px" },
    "& th": { background: tokens.colorNeutralBackground3, fontWeight: 600, padding: "6px 10px", textAlign: "left", border: `1px solid ${tokens.colorNeutralStroke2}` },
    "& td": { padding: "5px 10px", border: `1px solid ${tokens.colorNeutralStroke2}` },
    "& blockquote": { borderLeft: "3px solid #0078D4", paddingLeft: "12px", margin: "6px 0", color: tokens.colorNeutralForeground2, fontStyle: "italic" },
    "& a": { color: "#50A6E8" },
    "& hr": { border: "none", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, margin: "10px 0" },
  },
  bubbleUser: {
    background: "linear-gradient(135deg, #0F5AA8 0%, #0D7FE8 100%)",
    color: "#fff",
    borderBottomRightRadius: "4px",
    "& h2": { borderBottomColor: "rgba(255,255,255,0.2)" },
    "& th": { background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)" },
    "& td": { border: "1px solid rgba(255,255,255,0.15)" },
    "& a": { color: "#C8E6FF" },
    "& pre": { background: "rgba(0,0,0,0.25)", borderRadius: "6px", padding: "8px 10px" },
    "& code:not(pre code)": { background: "rgba(0,0,0,0.2)", padding: "1px 5px", borderRadius: "3px" },
  },
  bubbleAssistant: {
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomLeftRadius: "4px",
    "& pre": {
      background: tokens.colorNeutralBackground3,
      padding: "10px 12px",
      borderRadius: "6px",
      overflowX: "auto",
      margin: "8px 0",
      fontSize: "13px",
    },
    "& code:not(pre code)": {
      background: tokens.colorNeutralBackground3,
      padding: "1px 5px",
      borderRadius: "3px",
      fontSize: "0.88em",
    },
  },
  cursor: {
    display: "inline-block",
    width: "2px",
    height: "1em",
    background: tokens.colorNeutralForeground1,
    marginLeft: "2px",
    verticalAlign: "text-bottom",
    animationName: {
      "0%, 100%": { opacity: "1" },
      "50%": { opacity: "0" },
    },
    animationDuration: "0.9s",
    animationTimingFunction: "step-end",
    animationIterationCount: "infinite",
  },
  copyRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: "-2px",
  },
  citations: { maxWidth: "100%", width: "100%" },
});

interface Props { message: ChatMessageType; onFork?: () => void; onContinueIn?: (mode: Mode, seed: string) => void; }

export default function ChatMessage({ message, onFork, onContinueIn }: Props) {
  const styles = useStyles();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  function copyContent() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function exportDocx() {
    setExporting(true);
    exportMessageToDocx(message.content).finally(() => setExporting(false));
  }

  // Suppress the text bubble when a structured result replaces it.
  // Keep any short summary text (≤ 400 chars) that may follow the tool call.
  const structuredKind = message.structuredResult?.kind;
  const structuredReplacesModes = new Set([
    "service_comparison", "compliance_result", "migration_assessment",
    "dr_strategy", "monitoring_config", "tco_report",
    "network_topology", "landing_zone_design", "rbac_model",
    "threat_register", "pipeline_design", "slo_framework", "sku_recommendation",
    "region_comparison", "practice_exam_pack", "stakeholder_plan", "decision_card",
    "terraform_files", "arm_files", "cicd_files",
    "cost_alerts", "security_posture", "multicloud_comparison",
  ]);
  const suppressTextContent =
    !!structuredKind &&
    structuredReplacesModes.has(structuredKind) &&
    message.content.includes("|"); // only suppress if content has a markdown table

  const bubble = (
    <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
      {!suppressTextContent && <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
      {message.isStreaming && <span className={styles.cursor} />}
    </div>
  );

  if (isUser) {
    return (
      <div className={styles.rowUser}>
        <div className={styles.contentUser}>{bubble}</div>
        <div className={`${styles.avatar} ${styles.avatarUser}`}><PersonRegular /></div>
      </div>
    );
  }

  return (
    <div className={styles.rowAssistant}>
      <div className={`${styles.avatar} ${styles.avatarBot}`}><BotRegular /></div>
      <div className={styles.contentAssistant}>
        {bubble}

        {!message.isStreaming && message.content.length > 60 && (
          <div className={styles.copyRow}>
            {onFork && (
              <Button appearance="subtle" size="small" icon={<BranchRegular />} onClick={onFork} title="Fork conversation from here">
                Fork
              </Button>
            )}
            <Button appearance="subtle" size="small" icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={copyContent}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button appearance="subtle" size="small" icon={<DocumentRegular />} onClick={exportDocx} disabled={exporting} title="Export to Word document">
              {exporting ? "Exporting…" : "Export"}
            </Button>
          </div>
        )}

        {message.structuredResult && <StructuredResultCard result={message.structuredResult} onContinueIn={onContinueIn} />}

        {message.citations && message.citations.length > 0 && (
          <Accordion collapsible className={styles.citations}>
            <AccordionItem value="cites">
              <AccordionHeader size="small">
                <Badge appearance="tint" color="informative" size="small">
                  {message.citations.length} source{message.citations.length !== 1 ? "s" : ""}
                </Badge>
              </AccordionHeader>
              <AccordionPanel>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {message.citations.map((c, i) => (
                    <li key={i} style={{ marginBottom: "6px" }}>
                      <Link href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</Link>
                      {c.description && (
                        <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: "2px" }}>
                          {c.description.slice(0, 120)}{c.description.length > 120 ? "…" : ""}
                        </Text>
                      )}
                    </li>
                  ))}
                </ul>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </div>
  );
}
