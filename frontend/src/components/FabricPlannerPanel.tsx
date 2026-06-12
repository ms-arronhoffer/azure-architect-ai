import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  Field,
  Input,
  Select,
} from "@fluentui/react-components";
import {
  ScalesRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FabricCapacityPlan } from "../types";
import { useSSE } from "../hooks/useSSE";

const AZURE_REGIONS = [
  "East US", "East US 2", "West US", "West US 2", "West US 3",
  "North Europe", "West Europe", "UK South", "UK West",
  "Australia East", "Southeast Asia", "East Asia",
  "Canada Central", "Brazil South", "Japan East",
];

const useStyles = makeStyles({
  root: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
    gap: 0,
  },
  formPane: {
    width: "280px",
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
  formTitle: {
    fontWeight: 600,
    fontSize: "14px",
  },
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
  resultsScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
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
  placeholderIcon: {
    fontSize: "48px",
    opacity: 0.3,
  },
  streamText: {
    fontSize: "13px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
    "& p": { margin: "0 0 8px 0" },
    "& ul": { margin: "0 0 8px 0", paddingLeft: "20px" },
    "& li": { marginBottom: "4px" },
  },
  recommendedCard: {
    background: "rgba(0,120,212,0.08)",
    border: "2px solid #0078D4",
    borderRadius: "8px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  skuLabel: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#0078D4",
  },
  skuMeta: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  },
  metaStat: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  metaValue: {
    fontSize: "18px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  metaLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  sectionTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: "6px",
    marginBottom: "4px",
  },
  comparisonTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    "& th": {
      textAlign: "left",
      padding: "6px 10px",
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground3,
      fontSize: "11px",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    "& td": {
      padding: "8px 10px",
      borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
      color: tokens.colorNeutralForeground1,
    },
  },
  rowRecommended: {
    background: "rgba(0,120,212,0.06)",
  },
  util: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  utilBar: {
    width: "80px",
    height: "6px",
    borderRadius: "3px",
    background: tokens.colorNeutralStroke2,
    overflow: "hidden",
  },
  utilFill: {
    height: "100%",
    borderRadius: "3px",
  },
  riskList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  riskItem: {
    fontSize: "13px",
    color: tokens.colorStatusWarningForeground1,
    display: "flex",
    gap: "6px",
    alignItems: "flex-start",
    "&::before": { content: '"⚠"', flexShrink: 0 },
  },
  payg: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground2,
    borderRadius: "6px",
    padding: "12px",
    lineHeight: "1.6",
  },
  rationaleText: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.6",
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

function utilizationColor(pct: number): string {
  if (pct > 85) return "#C50F1F";
  if (pct > 70) return "#A37F00";
  return "#107C10";
}

function statusBadgeColor(status: string): "danger" | "warning" | "success" {
  if (status === "under") return "danger";
  if (status === "over") return "warning";
  return "success";
}

function buildExportText(plan: FabricCapacityPlan): string {
  const lines = [
    `# Fabric Capacity Plan — ${plan.recommended_sku}`,
    "",
    `## Recommended SKU: ${plan.recommended_sku}`,
    `- Monthly Cost: $${plan.monthly_cost_usd.toFixed(0)}/month`,
    `- Peak Utilisation: ${plan.utilization_estimate.toFixed(0)}%`,
    "",
    `## Sizing Rationale`,
    plan.sizing_rationale,
    "",
    `## Workload Summary`,
    plan.workload_summary,
    "",
    `## SKU Comparison`,
    "| SKU | CU | Monthly Cost | Utilisation | Status |",
    "|---|---|---|---|---|",
    ...plan.sku_options.map(o =>
      `| ${o.sku} | ${o.cu_capacity} | $${o.monthly_cost_usd.toFixed(0)} | ${o.utilization_estimate.toFixed(0)}% | ${o.status} |`
    ),
    "",
    `## Risks`,
    ...plan.risks.map(r => `- ${r}`),
    "",
    `## Pay-as-you-go Comparison`,
    plan.pay_as_you_go_comparison,
  ];
  return lines.join("\n");
}

export default function FabricPlannerPanel() {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [notebookUsers, setNotebookUsers] = useState("10");
  const [pipelineRuns, setPipelineRuns] = useState("200");
  const [warehouseQPS, setWarehouseQPS] = useState("50");
  const [reportUsers, setReportUsers] = useState("50");
  const [dataVolumeTB, setDataVolumeTB] = useState("2");
  const [region, setRegion] = useState("East US");

  const [streamText, setStreamText] = useState("");
  const [plan, setPlan] = useState<FabricCapacityPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildPrompt(): string {
    return `Plan Microsoft Fabric capacity for the following workload:

- Concurrent notebook/Spark users: ${notebookUsers}
- Pipeline runs per day: ${pipelineRuns}
- Warehouse concurrent query slots (peak): ${warehouseQPS}
- Power BI report users (concurrent): ${reportUsers}
- Total data volume: ${dataVolumeTB} TB
- Deployment region: ${region}

Provide a complete F-SKU recommendation with utilisation estimates, cost breakdown, and a comparison table across relevant SKU tiers. Call plan_fabric_capacity with the structured result.`;
  }

  async function handleGenerate() {
    setStreamText("");
    setPlan(null);
    setError(null);
    await stream(
      "/api/chat",
      { mode: "fabricplanner", messages: [{ role: "user", content: buildPrompt() }] },
      (event) => {
        if (event.type === "token") setStreamText((t) => t + event.content);
        else if (event.type === "fabric_capacity_plan") setPlan(event.plan);
        else if (event.type === "error") setError(event.message);
      }
    );
  }

  function handleExport() {
    if (!plan) return;
    const blob = new Blob([buildExportText(plan)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fabric-capacity-${plan.recommended_sku.toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.root}>
      <div className={styles.formPane}>
        <div className={styles.formHeader}>
          <ScalesRegular style={{ fontSize: "18px", color: "#0078D4" }} />
          <Text className={styles.formTitle}>Workload Profile</Text>
        </div>
        <div className={styles.formScroll}>
          <Field label="Concurrent notebook / Spark users">
            <Input type="number" min="1" value={notebookUsers} onChange={(_, d) => setNotebookUsers(d.value)} />
          </Field>
          <Field label="Pipeline runs per day">
            <Input type="number" min="0" value={pipelineRuns} onChange={(_, d) => setPipelineRuns(d.value)} />
          </Field>
          <Field label="Warehouse concurrent query slots (peak)">
            <Input type="number" min="0" value={warehouseQPS} onChange={(_, d) => setWarehouseQPS(d.value)} />
          </Field>
          <Field label="Power BI concurrent report users">
            <Input type="number" min="0" value={reportUsers} onChange={(_, d) => setReportUsers(d.value)} />
          </Field>
          <Field label="Total data volume (TB)">
            <Input type="number" min="0" step="0.5" value={dataVolumeTB} onChange={(_, d) => setDataVolumeTB(d.value)} />
          </Field>
          <Field label="Region">
            <Select value={region} onChange={(_, d) => setRegion(d.value)}>
              {AZURE_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        <div className={styles.formActions}>
          {isStreaming ? (
            <Button appearance="secondary" onClick={cancel} style={{ width: "100%" }}>Cancel</Button>
          ) : (
            <Button appearance="primary" onClick={handleGenerate} style={{ width: "100%" }}>
              Calculate Capacity
            </Button>
          )}
        </div>
      </div>

      <div className={styles.results}>
        <div className={styles.resultsScroll}>
          {!plan && !streamText && !isStreaming && !error && (
            <div className={styles.placeholder}>
              <ScalesRegular className={styles.placeholderIcon} />
              <Text size={400} weight="semibold">Fabric Capacity Planner</Text>
              <Text>Enter your workload profile and click Calculate Capacity to get an F-SKU recommendation with cost and utilisation estimates.</Text>
            </div>
          )}
          {error && <Text className={styles.errorText}>{error}</Text>}
          {isStreaming && !plan && (
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <Spinner size="tiny" />
              <Text style={{ fontSize: "13px", color: tokens.colorNeutralForeground3 }}>Calculating capacity…</Text>
            </div>
          )}
          {streamText && !plan && (
            <div className={styles.streamText}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
            </div>
          )}
          {plan && (
            <>
              <div className={styles.recommendedCard}>
                <Text style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#0078D4", fontWeight: 600 }}>
                  Recommended SKU
                </Text>
                <Text className={styles.skuLabel}>{plan.recommended_sku}</Text>
                <div className={styles.skuMeta}>
                  <div className={styles.metaStat}>
                    <Text className={styles.metaValue}>${plan.monthly_cost_usd.toFixed(0)}/mo</Text>
                    <Text className={styles.metaLabel}>Estimated Cost</Text>
                  </div>
                  <div className={styles.metaStat}>
                    <Text className={styles.metaValue} style={{ color: utilizationColor(plan.utilization_estimate) }}>
                      {plan.utilization_estimate.toFixed(0)}%
                    </Text>
                    <Text className={styles.metaLabel}>Peak Utilisation</Text>
                  </div>
                </div>
                <Text className={styles.rationaleText}>{plan.sizing_rationale}</Text>
              </div>

              <div>
                <Text className={styles.sectionTitle}>SKU Comparison</Text>
                <table className={styles.comparisonTable}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>CU</th>
                      <th>Cost/Month</th>
                      <th>Utilisation</th>
                      <th>Fit</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.sku_options.map((opt) => (
                      <tr key={opt.sku} className={opt.status === "recommended" ? styles.rowRecommended : ""}>
                        <td>
                          <Text weight={opt.status === "recommended" ? "semibold" : "regular"}>{opt.sku}</Text>
                          {opt.status === "recommended" && (
                            <Badge appearance="tint" color="brand" size="small" style={{ marginLeft: "6px" }}>Recommended</Badge>
                          )}
                        </td>
                        <td>{opt.cu_capacity}</td>
                        <td>${opt.monthly_cost_usd.toFixed(0)}</td>
                        <td>
                          <div className={styles.util}>
                            <div className={styles.utilBar}>
                              <div
                                className={styles.utilFill}
                                style={{
                                  width: `${Math.min(opt.utilization_estimate, 100)}%`,
                                  background: utilizationColor(opt.utilization_estimate),
                                }}
                              />
                            </div>
                            <Text style={{ fontSize: "12px" }}>{opt.utilization_estimate.toFixed(0)}%</Text>
                          </div>
                        </td>
                        <td>
                          <Badge
                            appearance="tint"
                            color={statusBadgeColor(opt.status)}
                            size="small"
                          >
                            {opt.status}
                          </Badge>
                        </td>
                        <td style={{ fontSize: "12px", color: tokens.colorNeutralForeground3 }}>{opt.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {plan.risks.length > 0 && (
                <div>
                  <Text className={styles.sectionTitle}>Risks & Considerations</Text>
                  <div className={styles.riskList}>
                    {plan.risks.map((r, i) => (
                      <Text key={i} className={styles.riskItem}>{r}</Text>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Text className={styles.sectionTitle}>Pay-as-you-go Comparison</Text>
                <Text className={styles.payg}>{plan.pay_as_you_go_comparison}</Text>
              </div>

              {streamText && (
                <div>
                  <Text className={styles.sectionTitle}>Analysis</Text>
                  <div className={styles.streamText}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {plan && (
          <div className={styles.actionBar}>
            <Button appearance="subtle" size="small" icon={<ArrowDownloadRegular />} onClick={handleExport}>
              Export Markdown
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
