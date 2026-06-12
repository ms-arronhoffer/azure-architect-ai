import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  Card,
  Tab,
  TabList,
  Badge,
  Field,
  Combobox,
  Option,
  Input,
  Divider,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from "@fluentui/react-components";
import { ArrowSwapRegular, CalculatorRegular, DocumentTableRegular, ArrowUploadRegular } from "@fluentui/react-icons";
import { apiFetch } from "../config/api";

interface Replacement {
  model: string;
  score: number;
  risk_level: "low" | "medium" | "high";
  quality_score: number;
  drift_pct: number;
  latency_delta_pct: number;
  cost_delta_pct: number;
  prompt_change_effort: string;
  capacity_status: string;
  scenario: string;
}

interface FeasibilityResult {
  source: string;
  target: string;
  score: number;
  risk_level: "low" | "medium" | "high";
  quality_score: number;
  drift_pct: number;
  latency_delta_pct: number;
  cost_delta_pct: number;
  prompt_change_effort: string;
  capacity_status: string;
}

interface PtuResult {
  model: string;
  recommended_ptus: number;
  minimum_ptus: number;
  effective_tpm_per_ptu: number;
  total_tpm_needed: number;
  input_tpm_needed: number;
  output_tpm_needed: number;
  cost_comparison?: {
    paygo_monthly: number;
    ptu_monthly: number;
    savings_pct: number;
    recommendation: string;
    breakeven_utilization_pct: number;
    hours_per_week: number;
    hours_per_month: number;
    requests_per_month: number;
  };
}

interface ReportDeployment {
  subscription_id: string;
  subscription_name: string;
  model: string;
  normalized_model: string;
  version: string;
  retirement_date: string;
  days_until_retirement: number | null;
  urgency: "critical" | "high" | "medium" | "low" | "unknown";
  peak_usage: string;
  peak_usage_score: number;
  upgrade_option: string;
  unified: string;
  regions: string[];
  region_count: number;
  migration_options: Replacement[];
  recommendation: string;
}

interface ReportCustomer {
  tpid: string;
  tp_name: string;
  csam: string;
  priority: "critical" | "high" | "medium" | "low" | "unknown";
  deployments: ReportDeployment[];
}

interface ReportModelSummary {
  model: string;
  normalized_id: string;
  retirement_date: string;
  days_until_retirement: number | null;
  urgency: string;
  row_count: number;
  customer_count: number;
  migration_options: Replacement[];
}

interface ReportResult {
  summary: {
    analysis_date: string;
    total_rows: number;
    unique_customers: number;
    unique_models: number;
    unique_deployments: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    high_usage_urgent: number;
  };
  customers: ReportCustomer[];
  model_summary: ReportModelSummary[];
}

const RISK_COLORS: Record<string, string> = {
  low: tokens.colorPaletteGreenForeground1,
  medium: tokens.colorPaletteYellowForeground1,
  high: tokens.colorStatusDangerForeground1,
};

const URGENCY_COLORS: Record<string, string> = {
  critical: tokens.colorStatusDangerForeground1,
  high: tokens.colorPaletteRedForeground1,
  medium: tokens.colorPaletteYellowForeground1,
  low: tokens.colorPaletteGreenForeground1,
  unknown: tokens.colorNeutralForeground3,
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    padding: "20px 24px 0",
    flexShrink: 0,
  },
  tabs: {
    padding: "0 24px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  formRow: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  field: {
    flex: "1 1 200px",
    minWidth: "160px",
  },
  scoreCard: {
    padding: "20px 24px",
    display: "flex",
    gap: "32px",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  bigScore: {
    fontSize: "52px",
    fontWeight: 700,
    lineHeight: 1,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "16px",
  },
  metricCard: {
    padding: "14px 16px",
  },
  metricValue: {
    fontSize: "20px",
    fontWeight: 600,
    color: tokens.colorBrandForeground1,
  },
  metricLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    fontWeight: 600,
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    verticalAlign: "middle",
  },
  ptuGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px",
  },
  ptuCard: {
    padding: "16px 20px",
  },
  ptuValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: tokens.colorBrandForeground1,
    lineHeight: 1.1,
  },
  ptuLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  recommendation: {
    padding: "14px 16px",
    borderRadius: "6px",
    background: tokens.colorNeutralBackground3,
    fontSize: "14px",
  },
});

function deltaLabel(val: number, unit = "%"): string {
  return `${val > 0 ? "+" : ""}${val}${unit}`;
}

function deltaColor(val: number, invertGood = false): string {
  const good = invertGood ? val > 0 : val < 0;
  if (val === 0) return tokens.colorNeutralForeground1;
  return good ? tokens.colorPaletteGreenForeground1 : tokens.colorStatusDangerForeground1;
}

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const color = level === "low" ? "success" : level === "medium" ? "warning" : "danger";
  return <Badge color={color} appearance="filled">{level.toUpperCase()}</Badge>;
}

export default function ModelMigrationPanel() {
  const styles = useStyles();
  const [tab, setTab] = useState<"scorer" | "ptu" | "report">("scorer");

  // ── Report Analyzer ──────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reportText, setReportText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [reportFileName, setReportFileName] = useState<string | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setReportText(ev.target?.result as string ?? "");
    reader.readAsText(file);
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!reportText.trim()) return;
    setAnalyzing(true);
    setReportError(null);
    setReportResult(null);
    try {
      const r = await apiFetch("/api/model-migration/analyze-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: reportText }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status}: ${t}`);
      }
      setReportResult(await r.json() as ReportResult);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [reportText]);

  // ── Migration Scorer ─────────────────────────────────────────────────────────
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [feasibility, setFeasibility] = useState<FeasibilityResult | null>(null);
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);

  // ── model catalog ────────────────────────────────────────────────────────────
  const [models, setModels] = useState<string[]>([]);
  const [targetModels, setTargetModels] = useState<string[]>([]);
  const [ptuModels, setPtuModels] = useState<string[]>([]);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/model-migration/source-models")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.text().catch(() => r.statusText);
          throw new Error(`${r.status}: ${body}`);
        }
        return r.json() as Promise<string[]>;
      })
      .then(setModels)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
    apiFetch("/api/model-migration/ptu-models")
      .then((r) => r.json() as Promise<string[]>)
      .then(setPtuModels)
      .catch(() => {});
    apiFetch("/api/model-migration/live-models")
      .then((r) => r.ok ? r.json() as Promise<string[]> : Promise.resolve([]))
      .then(setLiveModels)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!source) { setTargetModels([]); return; }
    apiFetch(`/api/model-migration/target-models/${encodeURIComponent(source)}`)
      .then((r) => r.json() as Promise<string[]>)
      .then(setTargetModels)
      .catch(() => setTargetModels([]));
    setTarget("");
  }, [source]);

  const scoreDisabled = !source || !target || source === target || scoring;

  const runScore = useCallback(async () => {
    setScoring(true);
    setScoreError(null);
    setFeasibility(null);
    try {
      const r = await apiFetch("/api/model-migration/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status}: ${t}`);
      }
      const data = await r.json() as FeasibilityResult;
      setFeasibility(data);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoring(false);
    }
  }, [source, target]);

  useEffect(() => {
    if (!source) { setReplacements([]); return; }
    setLoadingRec(true);
    apiFetch(`/api/model-migration/recommend/${encodeURIComponent(source)}`)
      .then((r) => r.json() as Promise<{ replacements: Replacement[] }>)
      .then((d) => setReplacements(d.replacements))
      .catch(() => setReplacements([]))
      .finally(() => setLoadingRec(false));
  }, [source]);

  // ── PTU Planner ──────────────────────────────────────────────────────────────
  const [ptuModel, setPtuModel] = useState("");
  const [avgInput, setAvgInput] = useState("500");
  const [avgOutput, setAvgOutput] = useState("200");
  const [peakRpm, setPeakRpm] = useState("60");
  const [hoursPerWeek, setHoursPerWeek] = useState("168");
  const [ptuMonthlyPrice, setPtuMonthlyPrice] = useState("");
  const [paygoInput, setPaygoInput] = useState("");
  const [paygoOutput, setPaygoOutput] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [ptuError, setPtuError] = useState<string | null>(null);
  const [ptuResult, setPtuResult] = useState<PtuResult | null>(null);

  const ptuDisabled = !ptuModel || !avgInput || !avgOutput || !peakRpm || estimating;

  const runPtu = useCallback(async () => {
    setEstimating(true);
    setPtuError(null);
    setPtuResult(null);
    try {
      const body: Record<string, unknown> = {
        model: ptuModel,
        avg_input_tokens: parseInt(avgInput),
        avg_output_tokens: parseInt(avgOutput),
        peak_rpm: parseInt(peakRpm),
        hours_per_week: parseFloat(hoursPerWeek) || 168,
        ptu_monthly_price: parseFloat(ptuMonthlyPrice) || 0,
      };
      if (paygoInput && paygoOutput) {
        body.paygo_input_price = parseFloat(paygoInput);
        body.paygo_output_price = parseFloat(paygoOutput);
      }
      const r = await apiFetch("/api/model-migration/ptu-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status}: ${t}`);
      }
      const data = await r.json() as PtuResult;
      setPtuResult(data);
    } catch (e) {
      setPtuError(e instanceof Error ? e.message : String(e));
    } finally {
      setEstimating(false);
    }
  }, [ptuModel, avgInput, avgOutput, peakRpm, hoursPerWeek, ptuMonthlyPrice, paygoInput, paygoOutput]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">Migration Advisor</Text>
        <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3, marginTop: "4px" }}>
          Score model migrations and plan PTU capacity using model-iq evaluation data
        </Text>
      </div>

      <div className={styles.tabs}>
        <TabList
          selectedValue={tab}
          onTabSelect={(_, d) => setTab(d.value as "scorer" | "ptu" | "report")}
        >
          <Tab value="scorer" icon={<ArrowSwapRegular />}>Migration Scorer</Tab>
          <Tab value="ptu" icon={<CalculatorRegular />}>PTU Planner</Tab>
          <Tab value="report" icon={<DocumentTableRegular />}>Report Analyzer</Tab>
        </TabList>
      </div>

      <div className={styles.body}>
        {tab === "scorer" && (
          <>
            {loadError && (
              <MessageBar intent="error">
                <MessageBarBody>Failed to load models: {loadError}</MessageBarBody>
              </MessageBar>
            )}
            <Card>
              <div className={styles.scoreCard} style={{ flexDirection: "column", gap: "16px" }}>
                <Text weight="semibold">Score a Migration</Text>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <Field label="Source Model">
                      <Combobox
                        placeholder="Select source model…"
                        value={source}
                        onOptionSelect={(_, d) => setSource(d.optionValue ?? "")}
                        onInput={(e) => setSource((e.target as HTMLInputElement).value)}
                      >
                        {models.map((m) => <Option key={m} value={m}>{m}</Option>)}
                      </Combobox>
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="Target Model">
                      <Combobox
                        placeholder={source ? "Select target model…" : "Select source first…"}
                        value={target}
                        disabled={!source}
                        onOptionSelect={(_, d) => setTarget(d.optionValue ?? "")}
                        onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
                      >
                        {targetModels.map((m) => <Option key={m} value={m}>{m}</Option>)}
                      </Combobox>
                    </Field>
                  </div>
                  <Button
                    appearance="primary"
                    icon={scoring ? <Spinner size="tiny" /> : <ArrowSwapRegular />}
                    disabled={scoreDisabled}
                    onClick={runScore}
                  >
                    Score Migration
                  </Button>
                </div>
              </div>
            </Card>

            {scoreError && (
              <MessageBar intent="error">
                <MessageBarBody>{scoreError}</MessageBarBody>
              </MessageBar>
            )}

            {feasibility && (
              <Card>
                <div className={styles.scoreCard}>
                  <div>
                    <div
                      className={styles.bigScore}
                      style={{ color: RISK_COLORS[feasibility.risk_level] }}
                    >
                      {feasibility.score}
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <RiskBadge level={feasibility.risk_level} />
                    </div>
                    <div style={{ fontSize: "12px", color: tokens.colorNeutralForeground3, marginTop: "6px" }}>
                      Feasibility Score / 100
                    </div>
                  </div>
                  <div className={styles.metricGrid} style={{ flex: 1 }}>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue}>{feasibility.quality_score}</div>
                      <div className={styles.metricLabel}>Quality Score</div>
                    </Card>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue} style={{ color: deltaColor(feasibility.cost_delta_pct) }}>
                        {deltaLabel(feasibility.cost_delta_pct)}
                      </div>
                      <div className={styles.metricLabel}>Cost Delta</div>
                    </Card>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue} style={{ color: deltaColor(feasibility.latency_delta_pct) }}>
                        {deltaLabel(feasibility.latency_delta_pct)}
                      </div>
                      <div className={styles.metricLabel}>Latency Delta</div>
                    </Card>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue}>{feasibility.drift_pct}%</div>
                      <div className={styles.metricLabel}>Output Drift</div>
                    </Card>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue}>{feasibility.prompt_change_effort}</div>
                      <div className={styles.metricLabel}>Prompt Change Effort</div>
                    </Card>
                    <Card className={styles.metricCard}>
                      <div className={styles.metricValue}>{feasibility.capacity_status}</div>
                      <div className={styles.metricLabel}>Capacity Status</div>
                    </Card>
                  </div>
                </div>
              </Card>
            )}

            {source && (
              <>
                <Divider />
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Text weight="semibold">Ranked Replacements for {source}</Text>
                  {loadingRec && <Spinner size="tiny" />}
                </div>
                {replacements.length === 0 && !loadingRec && (
                  <Text style={{ color: tokens.colorNeutralForeground3 }}>No evaluation data for this source model.</Text>
                )}
                {replacements.length > 0 && (
                  <Card style={{ padding: 0 }}>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Model</th>
                            <th className={styles.th}>Score</th>
                            <th className={styles.th}>Risk</th>
                            <th className={styles.th}>Quality</th>
                            <th className={styles.th}>Cost Δ</th>
                            <th className={styles.th}>Latency Δ</th>
                            <th className={styles.th}>Effort</th>
                            <th className={styles.th}>Capacity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {replacements.map((r) => (
                            <tr key={r.model}>
                              <td className={styles.td}>
                                <Text style={{ fontFamily: "monospace", fontSize: "12px" }}>{r.model}</Text>
                              </td>
                              <td className={styles.td}>
                                <Text weight="semibold" style={{ color: RISK_COLORS[r.risk_level] }}>{r.score}</Text>
                              </td>
                              <td className={styles.td}><RiskBadge level={r.risk_level} /></td>
                              <td className={styles.td}>{r.quality_score}</td>
                              <td className={styles.td} style={{ color: deltaColor(r.cost_delta_pct) }}>
                                {deltaLabel(r.cost_delta_pct)}
                              </td>
                              <td className={styles.td} style={{ color: deltaColor(r.latency_delta_pct) }}>
                                {deltaLabel(r.latency_delta_pct)}
                              </td>
                              <td className={styles.td}>{r.prompt_change_effort}</td>
                              <td className={styles.td}>{r.capacity_status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {tab === "ptu" && (
          <>
            <Card>
              <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: "16px" }}>
                <Text weight="semibold">PTU Sizing Inputs</Text>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <Field label="Model">
                      <Combobox
                        placeholder="Select model…"
                        value={ptuModel}
                        onOptionSelect={(_, d) => setPtuModel(d.optionValue ?? "")}
                        onInput={(e) => setPtuModel((e.target as HTMLInputElement).value)}
                      >
                        {Array.from(new Set([...ptuModels, ...liveModels])).sort().map((m) => {
                          const label = ptuModels.includes(m) ? m : `${m} (no PTU rates)`;
                          return <Option key={m} value={m} text={label}>{label}</Option>;
                        })}
                      </Combobox>
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="Peak Requests / Min">
                      <Input type="number" value={peakRpm} onChange={(_, d) => setPeakRpm(d.value)} />
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="Avg Input Tokens">
                      <Input type="number" value={avgInput} onChange={(_, d) => setAvgInput(d.value)} />
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="Avg Output Tokens">
                      <Input type="number" value={avgOutput} onChange={(_, d) => setAvgOutput(d.value)} />
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="Hours / Week (utilization)">
                      <Input type="number" value={hoursPerWeek} onChange={(_, d) => setHoursPerWeek(d.value)} />
                    </Field>
                  </div>
                </div>
                <Divider>Optional — Cost Comparison</Divider>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <Field label="PTU Monthly Price ($ / PTU)">
                      <Input type="number" placeholder="e.g. 1.75" value={ptuMonthlyPrice} onChange={(_, d) => setPtuMonthlyPrice(d.value)} />
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="PAYGO Input Price ($ / 1K tokens)">
                      <Input type="number" placeholder="e.g. 0.005" value={paygoInput} onChange={(_, d) => setPaygoInput(d.value)} />
                    </Field>
                  </div>
                  <div className={styles.field}>
                    <Field label="PAYGO Output Price ($ / 1K tokens)">
                      <Input type="number" placeholder="e.g. 0.015" value={paygoOutput} onChange={(_, d) => setPaygoOutput(d.value)} />
                    </Field>
                  </div>
                  <Button
                    appearance="primary"
                    icon={estimating ? <Spinner size="tiny" /> : <CalculatorRegular />}
                    disabled={ptuDisabled}
                    onClick={runPtu}
                  >
                    Estimate PTUs
                  </Button>
                </div>
              </div>
            </Card>

            {ptuError && (
              <MessageBar intent="error">
                <MessageBarBody>{ptuError}</MessageBarBody>
              </MessageBar>
            )}

            {ptuResult && (
              <>
                <div className={styles.ptuGrid}>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.recommended_ptus}</div>
                    <div className={styles.ptuLabel}>Recommended PTUs</div>
                  </Card>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.minimum_ptus}</div>
                    <div className={styles.ptuLabel}>Minimum PTUs (unit size)</div>
                  </Card>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.total_tpm_needed.toLocaleString()}</div>
                    <div className={styles.ptuLabel}>Total TPM Needed</div>
                  </Card>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.effective_tpm_per_ptu.toLocaleString()}</div>
                    <div className={styles.ptuLabel}>Effective TPM / PTU</div>
                  </Card>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.input_tpm_needed.toLocaleString()}</div>
                    <div className={styles.ptuLabel}>Input TPM Needed</div>
                  </Card>
                  <Card className={styles.ptuCard}>
                    <div className={styles.ptuValue}>{ptuResult.output_tpm_needed.toLocaleString()}</div>
                    <div className={styles.ptuLabel}>Output TPM Needed</div>
                  </Card>
                </div>

                {ptuResult.cost_comparison && (
                  <>
                    <Text weight="semibold">Cost Comparison</Text>
                    <div className={styles.ptuGrid}>
                      <Card className={styles.ptuCard}>
                        <div className={styles.ptuValue}>${ptuResult.cost_comparison.paygo_monthly.toLocaleString()}</div>
                        <div className={styles.ptuLabel}>PAYGO Monthly (est.)</div>
                      </Card>
                      <Card className={styles.ptuCard}>
                        <div className={styles.ptuValue}>${ptuResult.cost_comparison.ptu_monthly.toLocaleString()}</div>
                        <div className={styles.ptuLabel}>PTU Monthly</div>
                      </Card>
                      <Card className={styles.ptuCard}>
                        <div
                          className={styles.ptuValue}
                          style={{ color: ptuResult.cost_comparison.savings_pct > 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorStatusDangerForeground1 }}
                        >
                          {ptuResult.cost_comparison.savings_pct > 0 ? "+" : ""}{ptuResult.cost_comparison.savings_pct}%
                        </div>
                        <div className={styles.ptuLabel}>Savings vs PAYGO</div>
                      </Card>
                      <Card className={styles.ptuCard}>
                        <div className={styles.ptuValue}>{ptuResult.cost_comparison.breakeven_utilization_pct}%</div>
                        <div className={styles.ptuLabel}>Breakeven Utilization</div>
                      </Card>
                      <Card className={styles.ptuCard}>
                        <div className={styles.ptuValue}>{ptuResult.cost_comparison.requests_per_month.toLocaleString()}</div>
                        <div className={styles.ptuLabel}>Requests / Month</div>
                      </Card>
                    </div>
                    <div className={styles.recommendation}>
                      {ptuResult.cost_comparison.recommendation}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === "report" && (
          <>
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "4px 0" }}>
                <Text weight="semibold">Upload Retirement Report</Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  Upload a CSV or TSV Azure OpenAI model retirement report.
                </Text>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    style={{ display: "none" }}
                    onChange={handleFileSelect}
                  />
                  <Button
                    icon={<ArrowUploadRegular />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {reportFileName ?? "Choose file…"}
                  </Button>
                  <Button
                    appearance="primary"
                    icon={analyzing ? <Spinner size="tiny" /> : <DocumentTableRegular />}
                    disabled={!reportText.trim() || analyzing}
                    onClick={runAnalysis}
                  >
                    Analyze Report
                  </Button>
                  {reportText && !reportResult && (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {reportText.trim().split("\n").length} lines loaded
                    </Text>
                  )}
                </div>
              </div>
            </Card>

            {reportError && (
              <MessageBar intent="error">
                <MessageBarBody>{reportError}</MessageBarBody>
              </MessageBar>
            )}

            {reportResult && (
              <>
                {/* Summary row */}
                <div className={styles.ptuGrid}>
                  {[
                    { label: "Customers", value: reportResult.summary.unique_customers },
                    { label: "Deployments", value: reportResult.summary.unique_deployments },
                    { label: "Models at Risk", value: reportResult.summary.unique_models },
                    { label: "Already Retired", value: reportResult.summary.critical, color: URGENCY_COLORS.critical },
                    { label: "Retire ≤30 Days", value: reportResult.summary.high, color: URGENCY_COLORS.high },
                    { label: "Retire ≤90 Days", value: reportResult.summary.medium, color: URGENCY_COLORS.medium },
                    { label: "High-Usage Urgent", value: reportResult.summary.high_usage_urgent, color: URGENCY_COLORS.critical },
                  ].map(({ label, value, color }) => (
                    <Card className={styles.ptuCard} key={label}>
                      <div className={styles.ptuValue} style={color ? { color } : undefined}>{value}</div>
                      <div className={styles.ptuLabel}>{label}</div>
                    </Card>
                  ))}
                </div>

                <Divider>Model Summary</Divider>
                <Card style={{ padding: 0 }}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}>Model</th>
                          <th className={styles.th}>Urgency</th>
                          <th className={styles.th}>Retires</th>
                          <th className={styles.th}>Days</th>
                          <th className={styles.th}>Customers</th>
                          <th className={styles.th}>Rows</th>
                          <th className={styles.th}>Top Migration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportResult.model_summary.map((m) => (
                          <tr key={m.model}>
                            <td className={styles.td}>
                              <Text style={{ fontFamily: "monospace", fontSize: "12px" }}>{m.model}</Text>
                            </td>
                            <td className={styles.td}>
                              <Badge
                                color={m.urgency === "critical" || m.urgency === "high" ? "danger" : m.urgency === "medium" ? "warning" : "success"}
                                appearance="filled"
                              >
                                {m.urgency.toUpperCase()}
                              </Badge>
                            </td>
                            <td className={styles.td}>{m.retirement_date}</td>
                            <td className={styles.td} style={{ color: URGENCY_COLORS[m.urgency] }}>
                              {m.days_until_retirement !== null ? m.days_until_retirement : "—"}
                            </td>
                            <td className={styles.td}>{m.customer_count}</td>
                            <td className={styles.td}>{m.row_count}</td>
                            <td className={styles.td}>
                              {m.migration_options[0]
                                ? <Text style={{ fontFamily: "monospace", fontSize: "11px" }}>
                                    {m.migration_options[0].model} ({m.migration_options[0].score})
                                  </Text>
                                : <Text style={{ color: tokens.colorNeutralForeground3, fontSize: "11px" }}>None found</Text>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Divider>Customer Recommendations</Divider>
                <Accordion multiple collapsible>
                  {reportResult.customers.map((c) => (
                    <AccordionItem key={c.tpid} value={c.tpid}>
                      <AccordionHeader>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                          <Badge
                            color={c.priority === "critical" || c.priority === "high" ? "danger" : c.priority === "medium" ? "warning" : "success"}
                            appearance="filled"
                          >
                            {c.priority.toUpperCase()}
                          </Badge>
                          <Text weight="semibold">{c.tp_name}</Text>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            TPID {c.tpid} · {c.deployments.length} deployment{c.deployments.length !== 1 ? "s" : ""}
                            {c.csam ? ` · CSAM: ${c.csam}` : ""}
                          </Text>
                        </div>
                      </AccordionHeader>
                      <AccordionPanel>
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingBottom: "8px" }}>
                          {c.deployments.map((d, i) => (
                            <Card key={`${d.subscription_id}-${d.model}-${i}`} style={{ borderLeft: `3px solid ${URGENCY_COLORS[d.urgency]}` }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                  <Badge
                                    color={d.urgency === "critical" || d.urgency === "high" ? "danger" : d.urgency === "medium" ? "warning" : "success"}
                                    appearance="tint"
                                  >
                                    {d.urgency.toUpperCase()}
                                  </Badge>
                                  <Text weight="semibold" style={{ fontFamily: "monospace" }}>{d.model}</Text>
                                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                    {d.subscription_name} · retires {d.retirement_date}
                                    {d.days_until_retirement !== null
                                      ? ` (${d.days_until_retirement < 0 ? "PAST" : `${d.days_until_retirement}d`})`
                                      : ""}
                                  </Text>
                                </div>
                                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                                  <Text size={200}><strong>Usage:</strong> {d.peak_usage}</Text>
                                  <Text size={200}><strong>Regions:</strong> {d.regions.join(", ")}</Text>
                                  <Text size={200}><strong>Upgrade:</strong> {d.upgrade_option || "—"}</Text>
                                  <Text size={200}><strong>Unified:</strong> {d.unified}</Text>
                                </div>
                                {d.migration_options.length > 0 && (
                                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    {d.migration_options.map((m) => (
                                      <Badge key={m.model} appearance="outline" color={m.risk_level === "low" ? "success" : m.risk_level === "medium" ? "warning" : "danger"}>
                                        {m.model} · {m.score}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2, lineHeight: "1.5" }}>
                                  {d.recommendation}
                                </Text>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </AccordionPanel>
                    </AccordionItem>
                  ))}
                </Accordion>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
