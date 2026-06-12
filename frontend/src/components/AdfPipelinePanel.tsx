import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Field,
  Select,
  Textarea,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  PlugConnectedRegular,
  ArrowDownloadRegular,
  CopyRegular,
} from "@fluentui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AdfPipelineResult } from "../types";
import { useSSE } from "../hooks/useSSE";

const SOURCE_TYPES = [
  "Azure SQL Database",
  "SQL Server (On-premises)",
  "Oracle",
  "SAP ERP (RFC)",
  "SAP BW",
  "REST API",
  "Azure Blob Storage",
  "SFTP",
  "PostgreSQL",
  "MySQL",
  "Salesforce",
];

const DESTINATIONS = [
  "ADLS Gen2 (Parquet)",
  "ADLS Gen2 (Delta)",
  "Azure Synapse Analytics",
  "Microsoft Fabric Lakehouse",
  "Azure SQL Database",
  "Azure Cosmos DB",
];

const PATTERNS = [
  { value: "incremental_watermark", label: "Incremental (Watermark)" },
  { value: "full_load", label: "Full Load (Truncate & Load)" },
  { value: "cdc_change_tracking", label: "CDC (Change Tracking)" },
  { value: "api_to_lake", label: "API to Data Lake (Paginated)" },
  { value: "sap_extract", label: "SAP Extract (Partitioned)" },
];

const useStyles = makeStyles({
  root: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
  },
  formPane: {
    width: "300px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  formHeader: {
    padding: "16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  formTitle: { fontWeight: 600, fontSize: "14px" },
  formScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  formActions: {
    padding: "12px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  results: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  tabBar: {
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  tabContent: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: "12px",
    color: tokens.colorNeutralForeground4,
    textAlign: "center",
    padding: "40px",
  },
  placeholderIcon: { fontSize: "48px", opacity: 0.3 },
  codeBlock: {
    fontFamily: "Consolas, 'Cascadia Code', monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    background: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    padding: "16px",
    overflow: "auto",
    whiteSpace: "pre",
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    maxHeight: "calc(100vh - 200px)",
  },
  notesList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 0",
  },
  noteItem: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    lineHeight: "1.5",
  },
  streamText: {
    fontSize: "13px",
    lineHeight: "1.6",
    "& p": { margin: "0 0 8px 0" },
  },
  actionBar: {
    padding: "10px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  errorText: { color: tokens.colorStatusDangerForeground1, fontSize: "13px" },
  metaBadge: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    paddingBottom: "12px",
  },
});

export default function AdfPipelinePanel() {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [sourceType, setSourceType] = useState("Azure SQL Database");
  const [destination, setDestination] = useState("ADLS Gen2 (Parquet)");
  const [pattern, setPattern] = useState("incremental_watermark");
  const [scenario, setScenario] = useState("");

  const [streamText, setStreamText] = useState("");
  const [pipelineResult, setPipelineResult] = useState<AdfPipelineResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>("template");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const patternLabel = PATTERNS.find((p) => p.value === pattern)?.label ?? pattern;

  function buildPrompt(): string {
    const scenarioText = scenario.trim() ? `\n\nAdditional details: ${scenario.trim()}` : "";
    return `Generate an Azure Data Factory pipeline for the following scenario:

- Source: ${sourceType}
- Destination: ${destination}
- Pattern: ${patternLabel}${scenarioText}

Generate a complete, deployable ADF ARM template. Call generate_adf_pipeline with the full ARM JSON and deployment notes.`;
  }

  async function handleGenerate() {
    setStreamText("");
    setPipelineResult(null);
    setError(null);
    setActiveTab("template");
    await stream(
      "/api/chat",
      { mode: "adfpipeline", messages: [{ role: "user", content: buildPrompt() }] },
      (event) => {
        if (event.type === "token") setStreamText((t) => t + event.content);
        else if (event.type === "adf_pipeline") setPipelineResult(event.pipeline);
        else if (event.type === "error") setError(event.message);
      }
    );
  }

  function handleDownload() {
    if (!pipelineResult) return;
    const blob = new Blob([pipelineResult.arm_template], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pipelineResult.pipeline_name.toLowerCase().replace(/\s+/g, "-")}-adf.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (!pipelineResult) return;
    navigator.clipboard.writeText(pipelineResult.arm_template);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.root}>
      <div className={styles.formPane}>
        <div className={styles.formHeader}>
          <PlugConnectedRegular style={{ fontSize: "18px", color: "#0078D4" }} />
          <Text className={styles.formTitle}>Pipeline Configuration</Text>
        </div>
        <div className={styles.formScroll}>
          <Field label="Source system">
            <Select value={sourceType} onChange={(_, d) => setSourceType(d.value)}>
              {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Destination">
            <Select value={destination} onChange={(_, d) => setDestination(d.value)}>
              {DESTINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Ingestion pattern">
            <Select value={pattern} onChange={(_, d) => setPattern(d.value)}>
              {PATTERNS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Scenario details (optional)" hint="Table name, watermark column, filter conditions, etc.">
            <Textarea
              placeholder="e.g. Incremental copy from dbo.Orders using ModifiedDate column, load to /bronze/orders/"
              value={scenario}
              onChange={(_, d) => setScenario(d.value)}
              rows={5}
            />
          </Field>
        </div>
        <div className={styles.formActions}>
          {isStreaming ? (
            <Button appearance="secondary" onClick={cancel} style={{ width: "100%" }}>Cancel</Button>
          ) : (
            <Button appearance="primary" onClick={handleGenerate} style={{ width: "100%" }}>
              Generate Pipeline
            </Button>
          )}
        </div>
      </div>

      <div className={styles.results}>
        {pipelineResult ? (
          <>
            <div className={styles.tabBar}>
              <TabList
                selectedValue={activeTab}
                onTabSelect={(_, d) => setActiveTab(d.value as string)}
                size="small"
              >
                <Tab value="template">ARM Template</Tab>
                <Tab value="notes">Notes</Tab>
                {streamText && <Tab value="explanation">Explanation</Tab>}
              </TabList>
            </div>
            <div className={styles.tabContent}>
              {activeTab === "template" && (
                <>
                  <Text className={styles.metaBadge}>
                    {pipelineResult.pipeline_name} · {patternLabel}
                  </Text>
                  <pre className={styles.codeBlock}>{pipelineResult.arm_template}</pre>
                </>
              )}
              {activeTab === "notes" && (
                <div className={styles.notesList}>
                  {pipelineResult.notes.map((note, i) => (
                    <Text key={i} className={styles.noteItem}>
                      <span style={{ color: "#0078D4", flexShrink: 0 }}>→</span>
                      {note}
                    </Text>
                  ))}
                </div>
              )}
              {activeTab === "explanation" && (
                <div className={styles.streamText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                </div>
              )}
            </div>
            <div className={styles.actionBar}>
              <Button appearance="subtle" size="small" icon={<CopyRegular />} onClick={handleCopy}>
                {copied ? "Copied!" : "Copy JSON"}
              </Button>
              <Button appearance="subtle" size="small" icon={<ArrowDownloadRegular />} onClick={handleDownload}>
                Download ARM
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.tabContent}>
            {!streamText && !isStreaming && !error && (
              <div className={styles.placeholder}>
                <PlugConnectedRegular className={styles.placeholderIcon} />
                <Text size={400} weight="semibold">ADF Pipeline Generator</Text>
                <Text>Select a source, destination, and ingestion pattern then click Generate Pipeline to produce a deployable ADF ARM template.</Text>
              </div>
            )}
            {error && <Text className={styles.errorText}>{error}</Text>}
            {isStreaming && (
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <Spinner size="tiny" />
                <Text style={{ fontSize: "13px", color: tokens.colorNeutralForeground3 }}>Generating pipeline…</Text>
              </div>
            )}
            {streamText && !isStreaming && (
              <div className={styles.streamText}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
