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
  Badge,
} from "@fluentui/react-components";
import {
  TableRegular,
  ArrowDownloadRegular,
  CopyRegular,
} from "@fluentui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MedallionSchemaDesign, MedallionLayer, MedallionTable } from "../types";
import { useSSE } from "../hooks/useSSE";

const SOURCE_SYSTEMS = [
  "Azure SQL Database",
  "SQL Server (On-premises)",
  "Oracle EBS",
  "SAP S/4HANA",
  "SAP BW",
  "Dynamics 365",
  "Salesforce",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "REST API",
  "Flat files (CSV/Parquet)",
  "Other",
];

const COMPLIANCE_OPTIONS = [
  "None",
  "GDPR",
  "HIPAA",
  "PCI-DSS",
  "SOC 2",
  "ISO 27001",
  "FedRAMP",
];

const LAYER_COLORS: Record<string, string> = {
  Bronze: "#8B5E00",
  Silver: "#605e5c",
  Gold: "#986f0b",
};

const LAYER_BG: Record<string, string> = {
  Bronze: "rgba(139,94,0,0.08)",
  Silver: "rgba(96,94,92,0.08)",
  Gold: "rgba(152,111,11,0.08)",
};

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
    display: "flex",
    flexDirection: "column",
    gap: "12px",
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
  tableCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    overflow: "hidden",
  },
  tableCardHeader: {
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tableName: {
    fontWeight: 600,
    fontSize: "13px",
    flex: 1,
  },
  ucPath: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    fontFamily: "Consolas, monospace",
  },
  codeBlock: {
    fontFamily: "Consolas, 'Cascadia Code', monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    background: tokens.colorNeutralBackground3,
    padding: "12px",
    overflow: "auto",
    whiteSpace: "pre",
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  deltaConfig: {
    padding: "8px 14px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    fontFamily: "Consolas, monospace",
  },
  govNotes: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  govNote: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    lineHeight: "1.5",
  },
  layerDesc: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "4px",
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
});

function TableCard({ table, layerColor }: { table: MedallionTable; layerColor: string }) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(table.ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableCardHeader} style={{ background: `${layerColor}10` }}>
        <Text className={styles.tableName}>{table.name}</Text>
        {table.unity_catalog_path && (
          <Text className={styles.ucPath}>{table.unity_catalog_path}</Text>
        )}
        <Button size="small" appearance="subtle" icon={<CopyRegular />} onClick={handleCopy} title="Copy DDL">
          {copied ? "Copied!" : ""}
        </Button>
        <Button size="small" appearance="subtle" onClick={() => setExpanded(!expanded)}>
          {expanded ? "−" : "+"}
        </Button>
      </div>
      {expanded && (
        <>
          <pre className={styles.codeBlock}>{table.ddl}</pre>
          {table.delta_config && (
            <div className={styles.deltaConfig}>⚙ {table.delta_config}</div>
          )}
        </>
      )}
    </div>
  );
}

function LayerView({ layer }: { layer: MedallionLayer }) {
  const styles = useStyles();
  const color = LAYER_COLORS[layer.layer];
  const bg = LAYER_BG[layer.layer];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <Badge appearance="filled" style={{ background: bg, color, border: `1px solid ${color}40` }}>
          {layer.layer}
        </Badge>
        <Text className={styles.layerDesc}>{layer.description}</Text>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {layer.tables.map((t) => (
          <TableCard key={t.name} table={t} layerColor={color} />
        ))}
      </div>
    </div>
  );
}

function buildExportSQL(design: MedallionSchemaDesign): string {
  const parts: string[] = [`-- Medallion Schema: ${design.source_system}`, ""];
  for (const layer of design.layers) {
    parts.push(`-- ====== ${layer.layer.toUpperCase()} LAYER ======`);
    parts.push(`-- ${layer.description}`);
    parts.push("");
    for (const table of layer.tables) {
      parts.push(table.ddl);
      if (table.delta_config) parts.push(`-- ${table.delta_config}`);
      parts.push("");
    }
  }
  if (design.governance_notes.length > 0) {
    parts.push("-- ====== GOVERNANCE NOTES ======");
    design.governance_notes.forEach((n) => parts.push(`-- ${n}`));
  }
  return parts.join("\n");
}

export default function MedallionDesignerPanel() {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [sourceSystem, setSourceSystem] = useState("Azure SQL Database");
  const [sourceDDL, setSourceDDL] = useState("");
  const [compliance, setCompliance] = useState("None");

  const [streamText, setStreamText] = useState("");
  const [design, setDesign] = useState<MedallionSchemaDesign | null>(null);
  const [activeTab, setActiveTab] = useState<string>("Bronze");
  const [error, setError] = useState<string | null>(null);

  const layers: MedallionLayer[] = design
    ? (["Bronze", "Silver", "Gold"] as const)
        .map((l) => design.layers.find((x) => x.layer === l))
        .filter(Boolean) as MedallionLayer[]
    : [];

  function buildPrompt(): string {
    const ddlSection = sourceDDL.trim()
      ? `\n\nSource DDL / Schema:\n\`\`\`sql\n${sourceDDL.trim()}\n\`\`\``
      : "";
    const complianceSection = compliance !== "None" ? `\n- Compliance requirements: ${compliance}` : "";
    return `Design a medallion architecture schema for:
- Source system: ${sourceSystem}${complianceSection}${ddlSection}

Call design_medallion_schema with complete Bronze, Silver, and Gold layer DDL including Unity Catalog paths, partition columns, Delta Lake table properties, Z-ORDER hints, and governance notes.`;
  }

  async function handleGenerate() {
    setStreamText("");
    setDesign(null);
    setError(null);
    setActiveTab("Bronze");
    await stream(
      "/api/chat",
      { mode: "medalliondesigner", messages: [{ role: "user", content: buildPrompt() }] },
      (event) => {
        if (event.type === "token") setStreamText((t) => t + event.content);
        else if (event.type === "medallion_schema") {
          setDesign(event.design);
          setActiveTab(event.design.layers[0]?.layer ?? "Bronze");
        }
        else if (event.type === "error") setError(event.message);
      }
    );
  }

  function handleExport() {
    if (!design) return;
    const sql = buildExportSQL(design);
    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medallion-${design.source_system.toLowerCase().replace(/\s+/g, "-")}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.root}>
      <div className={styles.formPane}>
        <div className={styles.formHeader}>
          <TableRegular style={{ fontSize: "18px", color: "#0078D4" }} />
          <Text className={styles.formTitle}>Source Schema</Text>
        </div>
        <div className={styles.formScroll}>
          <Field label="Source system">
            <Select value={sourceSystem} onChange={(_, d) => setSourceSystem(d.value)}>
              {SOURCE_SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Compliance requirements">
            <Select value={compliance} onChange={(_, d) => setCompliance(d.value)}>
              {COMPLIANCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field
            label="Source DDL (optional)"
            hint="Paste CREATE TABLE statements — the more detail, the better the output"
          >
            <Textarea
              placeholder={`CREATE TABLE dbo.Orders (\n  OrderId INT PRIMARY KEY,\n  CustomerId INT,\n  OrderDate DATETIME2,\n  Amount DECIMAL(18,2)\n);`}
              value={sourceDDL}
              onChange={(_, d) => setSourceDDL(d.value)}
              rows={10}
              style={{ fontFamily: "Consolas, monospace", fontSize: "12px" }}
            />
          </Field>
        </div>
        <div className={styles.formActions}>
          {isStreaming ? (
            <Button appearance="secondary" onClick={cancel} style={{ width: "100%" }}>Cancel</Button>
          ) : (
            <Button appearance="primary" onClick={handleGenerate} style={{ width: "100%" }}>
              Design Schema
            </Button>
          )}
        </div>
      </div>

      <div className={styles.results}>
        {design ? (
          <>
            <div className={styles.tabBar}>
              <TabList
                selectedValue={activeTab}
                onTabSelect={(_, d) => setActiveTab(d.value as string)}
                size="small"
              >
                {layers.map((l) => (
                  <Tab key={l.layer} value={l.layer}
                    style={{ color: activeTab === l.layer ? LAYER_COLORS[l.layer] : undefined }}
                  >
                    {l.layer} ({l.tables.length})
                  </Tab>
                ))}
                {design.governance_notes.length > 0 && <Tab value="governance">Governance</Tab>}
                {streamText && <Tab value="explanation">Explanation</Tab>}
              </TabList>
            </div>
            <div className={styles.tabContent}>
              {layers.map((l) =>
                activeTab === l.layer ? <LayerView key={l.layer} layer={l} /> : null
              )}
              {activeTab === "governance" && (
                <div className={styles.govNotes}>
                  {design.governance_notes.map((n, i) => (
                    <Text key={i} className={styles.govNote}>
                      <span style={{ color: "#0078D4", flexShrink: 0 }}>→</span>
                      {n}
                    </Text>
                  ))}
                </div>
              )}
              {activeTab === "explanation" && streamText && (
                <div className={styles.streamText}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                </div>
              )}
            </div>
            <div className={styles.actionBar}>
              <Button appearance="subtle" size="small" icon={<ArrowDownloadRegular />} onClick={handleExport}>
                Export SQL
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.tabContent}>
            {!streamText && !isStreaming && !error && (
              <div className={styles.placeholder}>
                <TableRegular className={styles.placeholderIcon} />
                <Text size={400} weight="semibold">Medallion Schema Designer</Text>
                <Text>Select your source system, optionally paste source DDL, and click Design Schema to generate complete Bronze, Silver, and Gold Delta Lake table definitions.</Text>
              </div>
            )}
            {error && <Text className={styles.errorText}>{error}</Text>}
            {isStreaming && (
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <Spinner size="tiny" />
                <Text style={{ fontSize: "13px", color: tokens.colorNeutralForeground3 }}>Designing schema…</Text>
              </div>
            )}
            {streamText && !isStreaming && !design && (
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
