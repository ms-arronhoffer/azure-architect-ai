import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
} from "@fluentui/react-components";
import { ArrowSwapRegular, CalculatorRegular, DocumentTableRegular, ArrowUploadRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
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

const RISK_COLORS: Record<string, string> = {
  low: tokens.colorPaletteGreenForeground1,
  medium: tokens.colorPaletteYellowForeground1,
  high: tokens.colorStatusDangerForeground1,
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

  // ── Model IQ Report ──────────────────────────────────────────────────────────
  const mlInputRef = useRef<HTMLInputElement>(null);
  const acrInputRef = useRef<HTMLInputElement>(null);
  const ouInputRef = useRef<HTMLInputElement>(null);
  const [mlFile, setMlFile] = useState<File | null>(null);
  const [acrFile, setAcrFile] = useState<File | null>(null);
  const [ouFile, setOuFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [orgReportError, setOrgReportError] = useState<string | null>(null);
  const [orgReportMarkdown, setOrgReportMarkdown] = useState<string | null>(null);
  const [orgRecsMarkdown, setOrgRecsMarkdown] = useState<string | null>(null);
  const [orgReportGenerated, setOrgReportGenerated] = useState<string | null>(null);

  const runOrgReport = useCallback(async () => {
    if (!mlFile || !acrFile || !ouFile) return;
    setGenerating(true);
    setOrgReportError(null);
    setOrgReportMarkdown(null);
    setOrgRecsMarkdown(null);
    try {
      const form = new FormData();
      form.append("manager_list", mlFile, mlFile.name);
      form.append("acr_data", acrFile, acrFile.name);
      form.append("ou_data", ouFile, ouFile.name);
      const r = await apiFetch("/api/report-analyzer/generate", { method: "POST", body: form });
      if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status}: ${t}`);
      }
      const data = await r.json() as { markdown: string; recommendations_markdown: string; generated: string };
      setOrgReportMarkdown(data.markdown);
      setOrgRecsMarkdown(data.recommendations_markdown || null);
      setOrgReportGenerated(data.generated);
    } catch (e) {
      setOrgReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [mlFile, acrFile, ouFile]);

  const downloadOrgReport = useCallback(async () => {
    if (!mlFile || !acrFile || !ouFile) return;
    try {
      const form = new FormData();
      form.append("manager_list", mlFile, mlFile.name);
      form.append("acr_data", acrFile, acrFile.name);
      form.append("ou_data", ouFile, ouFile.name);
      const r = await apiFetch("/api/report-analyzer/generate/download", { method: "POST", body: form });
      if (!r.ok) throw new Error(`${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `hls-csa-org-tracker-${today}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setOrgReportError(e instanceof Error ? e.message : String(e));
    }
  }, [mlFile, acrFile, ouFile]);

  const downloadOrgRecommendations = useCallback(() => {
    if (!orgRecsMarkdown) return;
    const blob = new Blob([orgRecsMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `hls-csa-model-iq-recommendations-${today}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [orgRecsMarkdown]);

  const downloadOrgPdf = useCallback(async () => {
    if (!orgReportMarkdown) return;
    try {
      const r = await apiFetch("/api/report-analyzer/markdown-to-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: orgReportMarkdown, generated: orgReportGenerated ?? "" }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => r.statusText);
        throw new Error(`${r.status}: ${t}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `hls-csa-org-tracker-${today}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setOrgReportError(e instanceof Error ? e.message : String(e));
    }
  }, [orgReportMarkdown, orgReportGenerated]);

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
          <Tab value="report" icon={<DocumentTableRegular />}>Model IQ Report</Tab>
        </TabList>
      </div>

      {tab !== "report" && <div className={styles.body}>
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

      </div>}

      {tab === "report" && (
        <>
          <div style={{ flexShrink: 0, padding: "12px 24px 0" }}>
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0" }}>
                <div>
                  <Text weight="semibold">Generate HLS CSA Org Tracker Report</Text>
                  <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3, marginTop: "4px" }}>
                    Upload three source files (xlsx or csv) to generate the full 9-section org tracker report.
                  </Text>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                  {/* Manager List */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                      1. Manager List
                    </Text>
                    <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                      TPID · Account Name · Azure CSA M
                    </Text>
                    <input
                      ref={mlInputRef}
                      type="file"
                      accept=".csv,.xlsx"
                      style={{ display: "none" }}
                      onChange={(e) => setMlFile(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      icon={<ArrowUploadRegular />}
                      appearance={mlFile ? "subtle" : "secondary"}
                      style={mlFile ? { color: tokens.colorPaletteGreenForeground1 } : undefined}
                      onClick={() => mlInputRef.current?.click()}
                    >
                      {mlFile ? mlFile.name : "Choose file…"}
                    </Button>
                  </div>

                  {/* ACR Data */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                      2. ACR Data
                    </Text>
                    <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                      Power BI multi-month export (FY26-Jul…FY26-Jun)
                    </Text>
                    <input
                      ref={acrInputRef}
                      type="file"
                      accept=".csv,.xlsx"
                      style={{ display: "none" }}
                      onChange={(e) => setAcrFile(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      icon={<ArrowUploadRegular />}
                      appearance={acrFile ? "subtle" : "secondary"}
                      style={acrFile ? { color: tokens.colorPaletteGreenForeground1 } : undefined}
                      onClick={() => acrInputRef.current?.click()}
                    >
                      {acrFile ? acrFile.name : "Choose file…"}
                    </Button>
                  </div>

                  {/* OU Data */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                      3. OU Deployments
                    </Text>
                    <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                      Customer deployment inventory (us_hls.csv)
                    </Text>
                    <input
                      ref={ouInputRef}
                      type="file"
                      accept=".csv,.xlsx"
                      style={{ display: "none" }}
                      onChange={(e) => setOuFile(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      icon={<ArrowUploadRegular />}
                      appearance={ouFile ? "subtle" : "secondary"}
                      style={ouFile ? { color: tokens.colorPaletteGreenForeground1 } : undefined}
                      onClick={() => ouInputRef.current?.click()}
                    >
                      {ouFile ? ouFile.name : "Choose file…"}
                    </Button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", paddingTop: "4px" }}>
                  <Button
                    appearance="primary"
                    icon={generating ? <Spinner size="tiny" /> : <DocumentTableRegular />}
                    disabled={!mlFile || !acrFile || !ouFile || generating}
                    onClick={runOrgReport}
                  >
                    {generating ? "Generating…" : "Generate Report"}
                  </Button>
                  {orgReportMarkdown && (
                    <>
                      <Button
                        appearance="subtle"
                        icon={<ArrowDownloadRegular />}
                        onClick={downloadOrgReport}
                      >
                        Download .md
                      </Button>
                      <Button
                        appearance="subtle"
                        icon={<ArrowDownloadRegular />}
                        onClick={downloadOrgPdf}
                      >
                        Download PDF
                      </Button>
                      {orgRecsMarkdown && (
                        <Button
                          appearance="subtle"
                          icon={<ArrowDownloadRegular />}
                          onClick={downloadOrgRecommendations}
                        >
                          Download Recommendations
                        </Button>
                      )}
                    </>
                  )}
                  {orgReportGenerated && (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Generated {new Date(orgReportGenerated).toLocaleString()}
                    </Text>
                  )}
                </div>
              </div>
            </Card>

            {orgReportError && (
              <MessageBar intent="error" style={{ marginTop: "12px" }}>
                <MessageBarBody>{orgReportError}</MessageBarBody>
              </MessageBar>
            )}
          </div>

          {orgReportMarkdown && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 24px 24px" }}>
              <Card style={{ padding: "24px 32px" }}>
                <div style={{
                  fontSize: "13px",
                  lineHeight: "1.6",
                  fontFamily: "inherit",
                }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ children }) => (
                        <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                          <table style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: "12px",
                          }}>{children}</table>
                        </div>
                      ),
                      th: ({ children }) => (
                        <th style={{
                          textAlign: "left",
                          padding: "6px 10px",
                          fontWeight: 600,
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: tokens.colorNeutralForeground3,
                          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                          whiteSpace: "nowrap",
                          background: tokens.colorNeutralBackground2,
                        }}>{children}</th>
                      ),
                      td: ({ children }) => (
                        <td style={{
                          padding: "7px 10px",
                          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                          verticalAlign: "middle",
                        }}>{children}</td>
                      ),
                      h1: ({ children }) => (
                        <h1 style={{ fontSize: "18px", fontWeight: 700, margin: "24px 0 12px", color: tokens.colorNeutralForeground1 }}>{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "20px 0 10px", color: tokens.colorNeutralForeground1 }}>{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 style={{ fontSize: "13px", fontWeight: 600, margin: "14px 0 6px", color: tokens.colorNeutralForeground2 }}>{children}</h3>
                      ),
                      code: ({ children }) => (
                        <code style={{
                          fontFamily: "monospace",
                          fontSize: "11px",
                          background: tokens.colorNeutralBackground3,
                          padding: "1px 4px",
                          borderRadius: "3px",
                        }}>{children}</code>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote style={{
                          margin: "12px 0",
                          padding: "10px 14px",
                          borderLeft: `3px solid ${tokens.colorBrandForeground1}`,
                          background: tokens.colorNeutralBackground2,
                          borderRadius: "0 4px 4px 0",
                          fontStyle: "normal",
                        }}>{children}</blockquote>
                      ),
                      strong: ({ children }) => (
                        <strong style={{ fontWeight: 600, color: tokens.colorNeutralForeground1 }}>{children}</strong>
                      ),
                      p: ({ children }) => (
                        <p style={{ margin: "6px 0" }}>{children}</p>
                      ),
                    }}
                  >
                    {orgReportMarkdown}
                  </ReactMarkdown>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
