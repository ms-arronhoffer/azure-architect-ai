import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  TabList,
  Tab,
  Switch,
  Checkbox,
  SearchBox,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Input,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@fluentui/react-components";
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
  LockShieldRegular,
  CheckmarkCircleRegular,
  ArrowClockwiseRegular,
  DocumentRegular,
  ChatRegular,
  ArrowDownloadRegular,
  SaveRegular,
  DeleteRegular,
  ColumnDoubleCompareRegular,
} from "@fluentui/react-icons";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import type { WafPillarResult, ChatMessage, BundledDesign, Mode, BicepPreview } from "../types";
import { apiFetch } from "../config/api";
import {
  listSavedDesigns,
  saveDesign,
  deleteDesign,
  getSavedDesign,
  type SavedDesign,
} from "../utils/bundledDesignStore";
import {
  loadState,
  saveState,
  clearState,
  newState,
  hashRequest,
  type PipelinePhase,
  type PipelineState,
} from "../utils/pipelineState";
import { bundleAndSpecToMarkdown, bundleToMarkdown } from "../utils/markdownExport";
import { track } from "../utils/telemetry";
import DesignCompareView from "./DesignCompareView";
import BicepPreviewCard from "./BicepPreviewCard";

interface JobStatus {
  status: "idle" | "running" | "done" | "error";
  events: unknown[];
}

type JobKey = "architecture" | "waf" | "security";
type TabKey = JobKey | "bundled" | "drift";

interface RefMatch {
  slug: string;
  title: string;
  summary?: string;
  learn_url?: string;
  source?: string;
  score: number;
  signals?: Record<string, string[]>;
}

interface CostDelta {
  service?: string;
  sku?: string;
  monthly?: number;
  quantity?: number;
}

const PIPELINE_ORDER: JobKey[] = ["architecture", "security", "waf"];

const JOB_META: Record<JobKey, { label: string; icon: JSX.Element }> = {
  architecture: { label: "Architecture Design", icon: <BuildingRegular /> },
  waf: { label: "WAF Assessment", icon: <ShieldCheckmarkRegular /> },
  security: { label: "Security & Identity", icon: <LockShieldRegular /> },
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  header: {
    padding: "20px 28px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "6px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  progressGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  progressCard: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "16px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  progressCardRunning: {
    border: "1px solid #0078D4",
  },
  progressCardDone: {
    border: `1px solid ${tokens.colorStatusSuccessBorder1}`,
  },
  progressIcon: {
    fontSize: "20px",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    flexShrink: 0,
  },
  progressIconRunning: {
    color: "#0078D4",
  },
  progressIconDone: {
    color: tokens.colorStatusSuccessForeground1,
  },
  progressLabel: {
    fontWeight: 600,
    fontSize: "13px",
    flex: 1,
  },
  resultsArea: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    overflow: "hidden",
  },
  tabContent: {
    padding: "16px",
    overflowY: "auto",
    maxHeight: "60vh",
  },
  mdContent: {
    fontSize: "13px",
    lineHeight: 1.6,
    "& h1, & h2, & h3": { marginTop: "12px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, borderRadius: "6px", padding: "10px", overflowX: "auto" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px", textAlign: "left" },
  },
  pillarRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  pillarScore: {
    fontSize: "18px",
    fontWeight: 700,
    minWidth: "32px",
    textAlign: "right",
  },
  recList: {
    listStyle: "disc",
    paddingLeft: "18px",
    margin: "6px 0 0",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  recItem: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.45,
  },
  recCitation: {
    color: tokens.colorBrandForeground1,
    textDecoration: "none",
    fontSize: tokens.fontSizeBase100,
    marginLeft: "6px",
    whiteSpace: "nowrap",
  },
  footer: {
    padding: "16px 28px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexShrink: 0,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px",
    gap: "16px",
    color: tokens.colorNeutralForeground3,
  },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: tokens.colorBrandBackground,
    marginLeft: "5px",
    verticalAlign: "middle",
  },
  refMatchBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 14px",
    margin: "8px 8px 0",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke2}`,
    fontSize: tokens.fontSizeBase200,
    flexWrap: "wrap",
  },
  refMatchLabel: {
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
  },
  refMatchTitle: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  refMatchScore: {
    color: tokens.colorNeutralForeground3,
  },
  refMatchLink: {
    color: tokens.colorBrandForeground1,
    textDecoration: "none",
    fontSize: tokens.fontSizeBase200,
  },
  costBanner: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 14px",
    margin: "8px 8px 0",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorPaletteGreenBackground2,
    border: `1px solid ${tokens.colorPaletteGreenBorderActive}`,
    fontSize: tokens.fontSizeBase200,
    flexWrap: "wrap",
  },
  costTotal: {
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
  },
  costDelta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  savedRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
});

const SCORE_COLOR = (score: number): "success" | "warning" | "danger" =>
  score >= 4 ? "success" : score >= 3 ? "warning" : "danger";

interface DriftReport {
  subscription_id: string;
  design: { name: string; expected_types: string[] };
  summary: { total_resources: number; public_ips: number };
  findings: {
    service_coverage: { present: string[]; missing: string[]; expected_count?: number; present_count?: number; missing_count?: number };
    tag_violations: Array<{ name: string; type: string; missing_tags: string[] }>;
    public_exposure: Array<{ name: string; ip: string; resourceGroup?: string }>;
    open_management_ports: Array<{ name: string; ruleName: string; port: string; protocol: string; resourceGroup?: string }>;
  };
}

function fmtElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export default function AnalysisPanel({
  onRefine,
  onContinueIn,
  autoStart,
  onAutoStartConsumed,
}: {
  onRefine?: (context: ChatMessage[]) => void;
  onContinueIn?: (mode: Mode, seed: string) => void;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
}) {
  const styles = useStyles();
  const { spec } = useWorkloadSpec();
  const [jobs, setJobs] = useState<Record<JobKey, JobStatus>>({
    architecture: { status: "idle", events: [] },
    waf: { status: "idle", events: [] },
    security: { status: "idle", events: [] },
  });
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("architecture");
  const [architectureText, setArchitectureText] = useState("");
  const [wafPillars, setWafPillars] = useState<WafPillarResult[]>([]);
  const [securityText, setSecurityText] = useState("");
  const [allDone, setAllDone] = useState(false);
  const [pipelineMode, setPipelineMode] = useState(false);
  const [bundledDesign, setBundledDesign] = useState<BundledDesign | null>(null);
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [phaseStart, setPhaseStart] = useState<Partial<Record<JobKey, number>>>({});
  const [phaseDurations, setPhaseDurations] = useState<Partial<Record<JobKey, number>>>({});
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [resumable, setResumable] = useState<PipelineState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [compareKeys, setCompareKeys] = useState<[string, string] | null>(null);
  const [driftSubscription, setDriftSubscription] = useState("");
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [refMatches, setRefMatches] = useState<RefMatch[]>([]);
  const [seededSlug, setSeededSlug] = useState<string | null>(null);
  const [costRunningTotal, setCostRunningTotal] = useState<number | null>(null);
  const [costLastDelta, setCostLastDelta] = useState<CostDelta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track text/artifacts for the current pipeline run so we can persist on each phase boundary.
  const pipelineStateRef = useRef<PipelineState | null>(null);
  const phaseTextsRef = useRef<Partial<Record<PipelinePhase, string>>>({});
  const phaseArtifactsRef = useRef<Partial<Record<PipelinePhase, { runbook?: string; bicep?: string; bicep_preview?: BicepPreview; waf_pillars?: WafPillarResult[] }>>>({});
  const autoStartFiredRef = useRef(false);

  useEffect(() => {
    setSavedDesigns(listSavedDesigns());
  }, []);

  // Resume check on mount and whenever spec changes.
  useEffect(() => {
    const state = loadState();
    if (!state) {
      setResumable(null);
      return;
    }
    const requirements = toSpecPromptPrefix(spec) || spec.additionalNotes || "General Azure workload analysis.";
    const currentHash = hashRequest({
      requirements,
      constraints: spec.regulatoryNotes,
      region: spec.primaryRegion,
      compliance: spec.complianceFrameworks,
      budget_usd: spec.monthlyBudgetUsd,
    });
    setResumable(state.request_hash === currentHash ? state : null);
  }, [spec]);

  // Tick clock once a second while a phase is running so elapsed updates live.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // Auto-start the pipeline when invoked from IntakePanel. Resume always wins.
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartFiredRef.current) return;
    if (isRunning || resumable) return;
    if (!spec.name && !spec.additionalNotes) return;
    autoStartFiredRef.current = true;
    onAutoStartConsumed?.();
    setPipelineMode(true);
    void handleRun();
  }, [autoStart, spec, isRunning, resumable]);

  function persistPipeline() {
    if (!pipelineStateRef.current) return;
    const s = pipelineStateRef.current;
    s.phase_texts = { ...phaseTextsRef.current };
    s.phase_artifacts = { ...phaseArtifactsRef.current };
    saveState(s);
  }

  function resetPipelineTracking(hash: string) {
    pipelineStateRef.current = newState(hash);
    phaseTextsRef.current = {};
    phaseArtifactsRef.current = {};
    setPhaseStart({});
    setPhaseDurations({});
  }

  function handleResume() {
    if (!resumable) return;
    // Replay accumulated text into UI; do not POST to backend.
    setArchitectureText(resumable.phase_texts.architecture || "");
    setSecurityText(resumable.phase_texts.security || "");
    const wafArt = resumable.phase_artifacts.waf;
    setWafPillars(wafArt?.waf_pillars || []);
    const next: Record<JobKey, JobStatus> = {
      architecture: { status: "idle", events: [] },
      waf: { status: "idle", events: [] },
      security: { status: "idle", events: [] },
    };
    for (const p of resumable.completed_phases) {
      next[p] = { status: "done", events: [] };
    }
    setJobs(next);
    setPipelineMode(true);

    if (resumable.completed_phases.length === PIPELINE_ORDER.length) {
      // Reassemble bundled_design locally
      const bundle: BundledDesign = {
        workload_name: spec.name || "Workload",
        generated_at: resumable.started_at,
        architecture: {
          text: resumable.phase_texts.architecture || "",
          runbook: resumable.phase_artifacts.architecture?.runbook,
          bicep: resumable.phase_artifacts.architecture?.bicep,
          bicep_preview: resumable.phase_artifacts.architecture?.bicep_preview,
        },
        sizing: { text: "" },
        security: { text: resumable.phase_texts.security || "" },
        waf: { pillars: resumable.phase_artifacts.waf?.waf_pillars || [] },
      };
      setBundledDesign(bundle);
      setActiveTab("bundled");
      setAllDone(true);
    }
    setResumable(null);
    showToast("Resumed previous run from cache");
  }

  function handleDiscardResume() {
    clearState();
    setResumable(null);
  }

  async function handleRun() {
    setIsRunning(true);
    setAllDone(false);
    setArchitectureText("");
    setWafPillars([]);
    setSecurityText("");
    setRefMatches([]);
    setSeededSlug(null);
    setCostRunningTotal(null);
    setCostLastDelta(null);
    setJobs({
      architecture: { status: "running", events: [] },
      waf: { status: "running", events: [] },
      security: { status: "running", events: [] },
    });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const requirements = toSpecPromptPrefix(spec) || spec.additionalNotes || "General Azure workload analysis.";
    const endpoint = pipelineMode ? "/api/analyze/pipeline" : "/api/analyze";

    track({ kind: "run_started", mode: pipelineMode ? "pipeline" : "quick" });

    const reqBody = {
      requirements,
      constraints: spec.regulatoryNotes,
      region: spec.primaryRegion,
      compliance: spec.complianceFrameworks,
      budget_usd: spec.monthlyBudgetUsd,
    };

    if (pipelineMode) {
      const hash = hashRequest(reqBody);
      resetPipelineTracking(hash);
      saveState(pipelineStateRef.current!);
    } else {
      pipelineStateRef.current = null;
    }

    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            const job = obj._job as JobKey | undefined;

            if (obj.type === "analyze_status") {
              const j = obj.job as JobKey;
              setJobs((prev) => ({
                ...prev,
                [j]: { ...prev[j], status: obj.status },
              }));
              if (obj.status === "running") {
                setPhaseStart((prev) => ({ ...prev, [j]: Date.now() }));
              } else if (obj.status === "done") {
                setPhaseStart((prev) => {
                  const start = prev[j];
                  if (start) {
                    setPhaseDurations((d) => ({ ...d, [j]: Date.now() - start }));
                  }
                  return prev;
                });
                if (pipelineMode && pipelineStateRef.current) {
                  if (!pipelineStateRef.current.completed_phases.includes(j as PipelinePhase)) {
                    pipelineStateRef.current.completed_phases.push(j as PipelinePhase);
                  }
                  persistPipeline();
                }
              }
            } else if (obj.type === "done") {
              setAllDone(true);
              setIsRunning(false);
            } else if (obj.type === "reference_match") {
              setRefMatches((obj.matches as RefMatch[]) || []);
              setSeededSlug((obj.seeded_slug as string | null) ?? null);
            } else if (obj.type === "cost_update") {
              setCostRunningTotal(typeof obj.running_total_usd === "number" ? obj.running_total_usd : null);
              setCostLastDelta(obj.delta as CostDelta | null);
            } else if (obj.type === "bundled_design") {
              const bundle: BundledDesign = {
                workload_name: obj.workload_name,
                generated_at: obj.generated_at,
                architecture: obj.architecture,
                sizing: obj.sizing,
                security: obj.security,
                waf: obj.waf,
              };
              setBundledDesign(bundle);
              setActiveTab("bundled");
              track({ kind: "pipeline_completed" });
              clearState();
              pipelineStateRef.current = null;
            } else if (job === "architecture") {
              if (obj.type === "token") {
                setArchitectureText((p) => p + obj.content);
                if (pipelineMode) phaseTextsRef.current.architecture = (phaseTextsRef.current.architecture || "") + obj.content;
              } else if (obj.type === "runbook") {
                setArchitectureText((p) => p + "\n\n### Runbook\n" + obj.markdown);
                phaseArtifactsRef.current.architecture = { ...(phaseArtifactsRef.current.architecture || {}), runbook: obj.markdown };
              } else if (obj.type === "bicep") {
                phaseArtifactsRef.current.architecture = { ...(phaseArtifactsRef.current.architecture || {}), bicep: obj.code };
              } else if (obj.type === "bicep_preview") {
                phaseArtifactsRef.current.architecture = { ...(phaseArtifactsRef.current.architecture || {}), bicep_preview: obj.preview };
              }
            } else if (job === "waf") {
              if (obj.type === "waf_pillar") {
                setWafPillars((p) => [...p, obj.pillar]);
                const cur = phaseArtifactsRef.current.waf?.waf_pillars || [];
                phaseArtifactsRef.current.waf = { waf_pillars: [...cur, obj.pillar] };
              }
            } else if (job === "security") {
              if (obj.type === "token") {
                setSecurityText((p) => p + obj.content);
                if (pipelineMode) phaseTextsRef.current.security = (phaseTextsRef.current.security || "") + obj.content;
              }
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch {
      setIsRunning(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setIsRunning(false);
    if (pipelineMode) {
      track({ kind: "pipeline_cancelled" });
    }
  }

  async function handleScanDrift() {
    if (!bundledDesign?.architecture.bicep) {
      setDriftError("No Bicep available for drift scan.");
      return;
    }
    setDriftLoading(true);
    setDriftError(null);
    setDriftReport(null);
    try {
      const res = await apiFetch("/api/scan/drift/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          design_name: bundledDesign.workload_name,
          bicep: bundledDesign.architecture.bicep,
          subscription_id: driftSubscription || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Scan failed (${res.status})`);
      }
      const data: DriftReport = await res.json();
      setDriftReport(data);
    } catch (err) {
      setDriftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDriftLoading(false);
    }
  }

  function handleRefine() {
    if (!onRefine) return;
    const parts: string[] = [];
    if (architectureText) parts.push(`## Architecture Design\n\n${architectureText}`);
    if (wafPillars.length > 0) {
      const wafSummary = wafPillars.map((p) => {
        const recTexts = p.recommendations.slice(0, 2).map((r) => typeof r === "string" ? r : r.text);
        return `- **${p.pillar}**: ${p.score}/5 — ${recTexts.join(", ")}`;
      }).join("\n");
      parts.push(`## WAF Assessment\n\n${wafSummary}`);
    }
    if (securityText) parts.push(`## Security & Identity\n\n${securityText}`);
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: parts.join("\n\n") }]);
  }

  function handleRefineBundled() {
    if (!bundledDesign || !onContinueIn) return;
    const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
    const seed = [
      `I just generated a full design for ${bundledDesign.workload_name}. Here is the bundled output. Please review and suggest improvements.`,
      "",
      "## Architecture",
      trunc(bundledDesign.architecture.text || "", 2000),
      "",
      "## Security",
      trunc(bundledDesign.security.text || "", 1500),
      "",
      "## WAF",
      (bundledDesign.waf.pillars || [])
        .map((p) => `- ${p.pillar}: ${p.score}/5`)
        .join("\n"),
    ].join("\n");
    onContinueIn("qa", seed);
  }

  async function handleExportBrief() {
    const res = await apiFetch("/api/export/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workload_spec: {
          name: spec.name, type: spec.type, criticality: spec.criticality,
          primaryRegion: spec.primaryRegion, availabilitySla: spec.availabilitySla,
          rtoHours: spec.rtoHours, rpoHours: spec.rpoHours,
          complianceFrameworks: spec.complianceFrameworks,
          dataClassification: spec.dataClassification,
          monthlyBudgetUsd: spec.monthlyBudgetUsd, teamSize: spec.teamSize,
        },
        architecture_text: architectureText,
        waf_pillars: wafPillars,
        security_text: securityText,
      }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name || "workload"}_architecture_brief.html`;
    a.click();
    URL.revokeObjectURL(url);
    track({ kind: "design_exported" });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function handleDownloadJson() {
    if (!bundledDesign) return;
    const blob = new Blob([JSON.stringify(bundledDesign, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bundledDesign.workload_name || "workload"}_bundled_design.json`;
    a.click();
    URL.revokeObjectURL(url);
    track({ kind: "design_exported" });
  }

  function handleDownloadFullMarkdown() {
    if (!bundledDesign) return;
    const key = `${(bundledDesign.workload_name || "workload").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 64)}-${bundledDesign.generated_at}`;
    const saved = getSavedDesign(key);
    const md = saved ? bundleToMarkdown(saved) : bundleAndSpecToMarkdown(bundledDesign, spec);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bundledDesign.workload_name || "workload"}_full_design.md`;
    a.click();
    URL.revokeObjectURL(url);
    track({ kind: "design_exported" });
  }

  function handleSaveDesign() {
    if (!bundledDesign) return;
    saveDesign(bundledDesign, spec);
    setSavedDesigns(listSavedDesigns());
    showToast("Saved to library");
    track({ kind: "design_saved" });
  }

  function handleLoadDesign(key: string) {
    const saved = getSavedDesign(key);
    if (!saved) return;
    setBundledDesign(saved.bundle);
    setActiveTab("bundled");
  }

  function handleDeleteDesign(key: string) {
    deleteDesign(key);
    setSavedDesigns(listSavedDesigns());
    setSelectedKeys((prev) => prev.filter((k) => k !== key));
    showToast("Deleted from library");
  }

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // limit to 2 — drop the oldest
      const next = [...prev, key];
      return next.slice(-2);
    });
  }

  function handleCompare() {
    if (selectedKeys.length !== 2) return;
    const a = getSavedDesign(selectedKeys[0]);
    const b = getSavedDesign(selectedKeys[1]);
    if (!a || !b) return;
    if (a.spec_hash !== b.spec_hash) {
      showToast("Compare requires same workload spec");
      return;
    }
    setCompareKeys([selectedKeys[0], selectedKeys[1]]);
    track({ kind: "design_compared" });
  }

  function handleSwapCompare() {
    setCompareKeys((prev) => (prev ? [prev[1], prev[0]] : prev));
  }

  // Group saved designs by spec_hash, filter by search query.
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = savedDesigns.filter((d) => {
      if (!q) return true;
      return (
        d.bundle.workload_name.toLowerCase().includes(q) ||
        d.bundle.generated_at.toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, SavedDesign[]>();
    for (const d of filtered) {
      const key = d.spec_hash || "__unlinked__";
      const arr = groups.get(key) || [];
      arr.push(d);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([hash, items]) => ({
      hash,
      label: hash === "__unlinked__" ? "Unlinked (no spec)" : (items[0].spec_snapshot?.name || items[0].bundle.workload_name),
      items,
    }));
  }, [savedDesigns, searchQuery]);

  const compareEnabled = useMemo(() => {
    if (selectedKeys.length !== 2) return false;
    const a = savedDesigns.find((d) => d.key === selectedKeys[0]);
    const b = savedDesigns.find((d) => d.key === selectedKeys[1]);
    if (!a || !b) return false;
    return a.spec_hash !== null && a.spec_hash === b.spec_hash;
  }, [selectedKeys, savedDesigns]);

  const anyStarted = Object.values(jobs).some((j) => j.status !== "idle");

  const completedCount = (Object.values(jobs) as JobStatus[]).filter((j) => j.status === "done").length;
  const remainingCount = PIPELINE_ORDER.length - completedCount;
  const completedDurations = PIPELINE_ORDER
    .map((p) => phaseDurations[p])
    .filter((d): d is number => typeof d === "number");
  const meanDuration = completedDurations.length ? completedDurations.reduce((s, n) => s + n, 0) / completedDurations.length : 0;
  const etaMs = completedDurations.length > 0 && remainingCount > 0 ? Math.round(meanDuration * remainingCount) : 0;

  const compareDesigns = compareKeys
    ? { left: getSavedDesign(compareKeys[0]), right: getSavedDesign(compareKeys[1]) }
    : null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <Text className={styles.title}>Workload Analysis</Text>
          {allDone && <Badge appearance="filled" color="success" size="small">Complete</Badge>}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
            <Switch
              label="Full Design Pipeline (sequential, deeper)"
              checked={pipelineMode}
              onChange={(_, d) => setPipelineMode(!!d.checked)}
              disabled={isRunning}
            />
          </div>
        </div>
        <Text className={styles.subtitle}>
          {spec.name
            ? `Analyzing: ${spec.name} — ${pipelineMode ? "sequential pipeline (Architecture → Security → WAF)" : "runs Architecture, WAF, and Security in parallel"}.`
            : "Fill out Requirements Studio first to get the most precise analysis."}
        </Text>
      </div>

      <div className={styles.body}>
        {resumable && (
          <MessageBar intent="warning">
            <MessageBarBody>
              Resume previous pipeline run? {resumable.completed_phases.length} of {PIPELINE_ORDER.length} phases complete.
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" appearance="primary" onClick={handleResume}>Resume</Button>
              <Button size="small" appearance="subtle" onClick={handleDiscardResume}>Discard</Button>
            </MessageBarActions>
          </MessageBar>
        )}

        {anyStarted && pipelineMode && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "4px 0" }}>
            {PIPELINE_ORDER.map((job, idx) => {
              const status = jobs[job].status;
              const meta = JOB_META[job];
              const color =
                status === "done" ? tokens.colorStatusSuccessForeground1 :
                status === "running" ? "#0078D4" :
                tokens.colorNeutralForeground3;
              const dur = phaseDurations[job];
              const liveStart = phaseStart[job];
              const liveLabel = status === "done" && dur ? fmtElapsed(dur)
                : status === "running" && liveStart ? fmtElapsed(nowTs - liveStart)
                : null;
              return (
                <div key={job} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "4px 10px", borderRadius: "16px",
                    border: `1px solid ${color}`, color,
                    background: status === "running" ? "rgba(0,120,212,0.08)" : "transparent",
                    fontSize: "12px", fontWeight: 600,
                  }}>
                    <span>{idx + 1}</span>
                    {status === "running" ? <Spinner size="tiny" /> : status === "done" ? <CheckmarkCircleRegular /> : null}
                    <span>{meta.label}</span>
                    {liveLabel && (
                      <span style={{ fontFamily: tokens.fontFamilyMonospace, fontSize: "11px", opacity: 0.8 }}>{liveLabel}</span>
                    )}
                  </div>
                  {idx < PIPELINE_ORDER.length - 1 && (
                    <span style={{ color: tokens.colorNeutralForeground3, fontSize: "14px" }}>→</span>
                  )}
                </div>
              );
            })}
            {etaMs > 0 && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: tokens.colorNeutralForeground3 }}>
                ETA ~{fmtElapsed(etaMs)} remaining
              </span>
            )}
          </div>
        )}

        {anyStarted && !pipelineMode && (
          <div className={styles.progressGrid}>
            {(Object.keys(JOB_META) as JobKey[]).map((job) => {
              const meta = JOB_META[job];
              const status = jobs[job].status;
              return (
                <div
                  key={job}
                  className={`${styles.progressCard} ${status === "running" ? styles.progressCardRunning : ""} ${status === "done" ? styles.progressCardDone : ""}`}
                >
                  <span className={`${styles.progressIcon} ${status === "running" ? styles.progressIconRunning : ""} ${status === "done" ? styles.progressIconDone : ""}`}>
                    {status === "running" ? <Spinner size="tiny" /> : status === "done" ? <CheckmarkCircleRegular /> : meta.icon}
                  </span>
                  <Text className={styles.progressLabel}>{meta.label}</Text>
                  <Badge appearance="tint" color={status === "done" ? "success" : status === "running" ? "brand" : "subtle"} size="small">
                    {status === "done" ? "Done" : status === "running" ? "Running" : "Idle"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {compareDesigns?.left && compareDesigns.right && (
          <div className={styles.resultsArea}>
            <DesignCompareView
              left={compareDesigns.left}
              right={compareDesigns.right}
              onClose={() => setCompareKeys(null)}
              onSwap={handleSwapCompare}
            />
          </div>
        )}

        {!compareKeys && (anyStarted || bundledDesign) && (
          <div className={styles.resultsArea}>
            {refMatches.length > 0 && (() => {
              const primary = refMatches.find((m) => m.slug === seededSlug) ?? refMatches[0];
              const others = refMatches.filter((m) => m.slug !== primary.slug);
              const pct = Math.round((primary.score || 0) * 100);
              const seeded = !!seededSlug && primary.slug === seededSlug;
              return (
                <div className={styles.refMatchBar}>
                  <span className={styles.refMatchLabel}>
                    {seeded ? "Starting from:" : "Closest reference:"}
                  </span>
                  <span className={styles.refMatchTitle}>{primary.title}</span>
                  <span className={styles.refMatchScore}>({pct}% match)</span>
                  {primary.learn_url && (
                    <a
                      href={primary.learn_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.refMatchLink}
                      title="Open on Microsoft Learn"
                    >
                      Microsoft Learn ↗
                    </a>
                  )}
                  {others.length > 0 && (
                    <span
                      className={styles.refMatchScore}
                      title={others.map((o) => `${o.title} (${Math.round((o.score || 0) * 100)}%)`).join("\n")}
                    >
                      +{others.length} alt{others.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              );
            })()}
            {costRunningTotal !== null && (
              <div className={styles.costBanner}>
                <span className={styles.refMatchLabel}>Running cost:</span>
                <span className={styles.costTotal}>
                  ${costRunningTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                </span>
                {costLastDelta && (
                  <span className={styles.costDelta}>
                    +{costLastDelta.service || "component"}
                    {costLastDelta.sku ? ` (${costLastDelta.sku})` : ""}
                    {typeof costLastDelta.monthly === "number"
                      ? ` · +$${costLastDelta.monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`
                      : ""}
                  </span>
                )}
              </div>
            )}
            <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as TabKey)} style={{ padding: "8px 8px 0" }}>
              <Tab value="architecture">Architecture{jobs.architecture.status === "done" && <span className={styles.tabDot} />}</Tab>
              <Tab value="waf">WAF Assessment{jobs.waf.status === "done" && <span className={styles.tabDot} />}</Tab>
              <Tab value="security">Security{jobs.security.status === "done" && <span className={styles.tabDot} />}</Tab>
              {bundledDesign && <Tab value="bundled">Bundled Design<span className={styles.tabDot} /></Tab>}
              {bundledDesign?.architecture.bicep && <Tab value="drift">Drift</Tab>}
            </TabList>

            <div className={styles.tabContent}>
              {activeTab === "architecture" && (
                architectureText ? (
                  <div className={styles.mdContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{architectureText}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.architecture.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.architecture.status === "running" ? "Generating architecture design…" : "Architecture analysis not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "waf" && (
                wafPillars.length > 0 ? (
                  <div>
                    {wafPillars.map((p, i) => {
                      const recItems = p.recommendations.map((r) =>
                        typeof r === "string" ? { text: r } : r
                      );
                      return (
                        <div key={i} className={styles.pillarRow}>
                          <span className={styles.pillarScore} style={{ color: p.score >= 4 ? tokens.colorStatusSuccessForeground1 : p.score >= 3 ? tokens.colorStatusWarningForeground1 : tokens.colorStatusDangerForeground1 }}>
                            {p.score}/5
                          </span>
                          <div style={{ flex: 1 }}>
                            <Text weight="semibold" size={300}>{p.pillar}</Text>
                            <ul className={styles.recList}>
                              {recItems.slice(0, 5).map((r, j) => (
                                <li key={j} className={styles.recItem}>
                                  <span>{r.text}</span>
                                  {r.learn_url && (
                                    <a
                                      href={r.learn_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={styles.recCitation}
                                      title="Open on Microsoft Learn"
                                    >
                                      [Microsoft Docs ↗]
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.waf.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.waf.status === "running" ? "Running WAF assessment…" : "WAF assessment not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "security" && (
                securityText ? (
                  <div className={styles.mdContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{securityText}</ReactMarkdown>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px" }}>
                    {jobs.security.status === "running" && <Spinner size="small" />}
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      {jobs.security.status === "running" ? "Analyzing security posture…" : "Security analysis not started."}
                    </Text>
                  </div>
                )
              )}
              {activeTab === "bundled" && bundledDesign && (
                <div>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <Button appearance="primary" icon={<SaveRegular />} onClick={handleSaveDesign}>
                      Save to Library
                    </Button>
                    <Button appearance="subtle" icon={<ArrowDownloadRegular />} onClick={handleDownloadJson}>
                      Download JSON
                    </Button>
                    <Button appearance="subtle" icon={<ArrowDownloadRegular />} onClick={handleDownloadFullMarkdown}>
                      Download Full Markdown
                    </Button>
                    {onContinueIn && (
                      <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefineBundled}>
                        Refine in Chat
                      </Button>
                    )}
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginLeft: "auto", alignSelf: "center" }}>
                      {bundledDesign.workload_name} • {new Date(bundledDesign.generated_at).toLocaleString()}
                    </Text>
                  </div>
                  <Accordion multiple collapsible defaultOpenItems={["architecture"]}>
                    <AccordionItem value="architecture">
                      <AccordionHeader>Architecture</AccordionHeader>
                      <AccordionPanel>
                        <div className={styles.mdContent}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{bundledDesign.architecture.text || "_empty_"}</ReactMarkdown>
                          {bundledDesign.architecture.runbook && (
                            <>
                              <h3>Runbook</h3>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bundledDesign.architecture.runbook}</ReactMarkdown>
                            </>
                          )}
                          {bundledDesign.architecture.bicep && (
                            <>
                              <h3>Bicep</h3>
                              <pre><code>{bundledDesign.architecture.bicep}</code></pre>
                              <BicepPreviewCard preview={bundledDesign.architecture.bicep_preview} />
                            </>
                          )}
                        </div>
                      </AccordionPanel>
                    </AccordionItem>
                    <AccordionItem value="security">
                      <AccordionHeader>Security</AccordionHeader>
                      <AccordionPanel>
                        <div className={styles.mdContent}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{bundledDesign.security.text || "_empty_"}</ReactMarkdown>
                        </div>
                      </AccordionPanel>
                    </AccordionItem>
                    <AccordionItem value="waf">
                      <AccordionHeader>WAF Assessment ({bundledDesign.waf.pillars.length} pillars)</AccordionHeader>
                      <AccordionPanel>
                        {bundledDesign.waf.pillars.length === 0 ? (
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No WAF pillars captured.</Text>
                        ) : (
                          bundledDesign.waf.pillars.map((p, i) => (
                            <div key={i} className={styles.pillarRow}>
                              <span className={styles.pillarScore} style={{ color: p.score >= 4 ? tokens.colorStatusSuccessForeground1 : p.score >= 3 ? tokens.colorStatusWarningForeground1 : tokens.colorStatusDangerForeground1 }}>
                                {p.score}/5
                              </span>
                              <div style={{ flex: 1 }}>
                                <Text weight="semibold" size={300}>{p.pillar}</Text>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                                  {p.recommendations.slice(0, 3).map((r, j) => {
                                    const text = typeof r === "string" ? r : r.text;
                                    return (
                                      <Badge key={j} appearance="tint" color={SCORE_COLOR(p.score)} size="small">{text}</Badge>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </AccordionPanel>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
              {activeTab === "drift" && bundledDesign?.architecture.bicep && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                    Scan a live subscription for drift against the Bicep in this design.
                  </Text>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <Input
                      placeholder="Azure subscription ID (blank = server default)"
                      value={driftSubscription}
                      onChange={(_, d) => setDriftSubscription(d.value || "")}
                      style={{ minWidth: "320px" }}
                    />
                    <Button appearance="primary" onClick={handleScanDrift} disabled={driftLoading}>
                      {driftLoading ? <Spinner size="tiny" /> : "Scan subscription"}
                    </Button>
                  </div>
                  {driftError && (
                    <MessageBar intent="error">
                      <MessageBarBody>{driftError}</MessageBarBody>
                    </MessageBar>
                  )}
                  {driftReport && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <Card style={{ padding: "12px" }}>
                        <Text weight="semibold" size={400}>Service coverage</Text>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {driftReport.findings.service_coverage.present.length} present ·{" "}
                          {driftReport.findings.service_coverage.missing.length} missing ·{" "}
                          {driftReport.design.expected_types.length} expected
                        </Text>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
                          {driftReport.findings.service_coverage.present.map((t) => (
                            <Badge key={`p-${t}`} color="success" appearance="tint" size="small">{t}</Badge>
                          ))}
                          {driftReport.findings.service_coverage.missing.map((t) => (
                            <Badge key={`m-${t}`} color="warning" appearance="tint" size="small">{t} (missing)</Badge>
                          ))}
                        </div>
                      </Card>
                      <Card style={{ padding: "12px" }}>
                        <Text weight="semibold" size={400}>Tag compliance ({driftReport.findings.tag_violations.length})</Text>
                        {driftReport.findings.tag_violations.length === 0 ? (
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>All scanned resources have required tags.</Text>
                        ) : (
                          <Table size="small">
                            <TableHeader>
                              <TableRow>
                                <TableHeaderCell>Resource</TableHeaderCell>
                                <TableHeaderCell>Type</TableHeaderCell>
                                <TableHeaderCell>Missing tags</TableHeaderCell>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {driftReport.findings.tag_violations.map((v, i) => (
                                <TableRow key={i}>
                                  <TableCell>{v.name}</TableCell>
                                  <TableCell>{v.type}</TableCell>
                                  <TableCell>{v.missing_tags.join(", ")}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Card>
                      <Card style={{ padding: "12px" }}>
                        <Text weight="semibold" size={400}>Public exposure ({driftReport.findings.public_exposure.length})</Text>
                        {driftReport.findings.public_exposure.length === 0 ? (
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No public IPs detected.</Text>
                        ) : (
                          <Table size="small">
                            <TableHeader>
                              <TableRow>
                                <TableHeaderCell>Name</TableHeaderCell>
                                <TableHeaderCell>IP</TableHeaderCell>
                                <TableHeaderCell>Resource group</TableHeaderCell>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {driftReport.findings.public_exposure.map((p, i) => (
                                <TableRow key={i}>
                                  <TableCell>{p.name}</TableCell>
                                  <TableCell>{p.ip}</TableCell>
                                  <TableCell>{p.resourceGroup ?? "—"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Card>
                      <Card style={{ padding: "12px" }}>
                        <Text weight="semibold" size={400}>Open management ports ({driftReport.findings.open_management_ports.length})</Text>
                        {driftReport.findings.open_management_ports.length === 0 ? (
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>No exposed management ports.</Text>
                        ) : (
                          <Table size="small">
                            <TableHeader>
                              <TableRow>
                                <TableHeaderCell>NSG</TableHeaderCell>
                                <TableHeaderCell>Rule</TableHeaderCell>
                                <TableHeaderCell>Port</TableHeaderCell>
                                <TableHeaderCell>Protocol</TableHeaderCell>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {driftReport.findings.open_management_ports.map((r, i) => (
                                <TableRow key={i}>
                                  <TableCell>{r.name}</TableCell>
                                  <TableCell>{r.ruleName}</TableCell>
                                  <TableCell>{r.port}</TableCell>
                                  <TableCell>{r.protocol}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {savedDesigns.length > 0 && (
          <div className={styles.resultsArea} style={{ padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
              <Text weight="semibold">Saved Designs ({savedDesigns.length})</Text>
              <SearchBox
                placeholder="Search by workload or date…"
                value={searchQuery}
                onChange={(_, d) => setSearchQuery(d.value || "")}
                style={{ minWidth: "240px" }}
              />
              <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
                {selectedKeys.length > 0 && (
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {selectedKeys.length} selected
                  </Text>
                )}
                <Button
                  appearance="primary"
                  size="small"
                  icon={<ColumnDoubleCompareRegular />}
                  disabled={!compareEnabled}
                  onClick={handleCompare}
                >
                  Compare
                </Button>
              </div>
            </div>
            <Accordion multiple collapsible defaultOpenItems={grouped.map((g) => g.hash)}>
              {grouped.map((g) => (
                <AccordionItem key={g.hash} value={g.hash}>
                  <AccordionHeader>
                    {g.label} <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginLeft: 6 }}>({g.items.length} run{g.items.length === 1 ? "" : "s"})</Text>
                  </AccordionHeader>
                  <AccordionPanel>
                    {g.items.map((d) => (
                      <div key={d.key} className={styles.savedRow}>
                        <Checkbox
                          checked={selectedKeys.includes(d.key)}
                          onChange={() => toggleSelected(d.key)}
                        />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                          <Text size={300} weight="semibold">{d.bundle.workload_name}</Text>
                          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                            {new Date(d.bundle.generated_at).toLocaleString()}
                          </Text>
                        </div>
                        <Button appearance="subtle" size="small" onClick={() => handleLoadDesign(d.key)}>Open</Button>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<DeleteRegular />}
                          onClick={() => handleDeleteDesign(d.key)}
                          aria-label={`Delete ${d.bundle.workload_name}`}
                        />
                      </div>
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}

        {!anyStarted && !bundledDesign && savedDesigns.length === 0 && (
          <div className={styles.emptyState}>
            <BuildingRegular style={{ fontSize: "48px", opacity: 0.3 }} />
            <Text size={400} weight="semibold">Ready to analyze your workload</Text>
            <Text size={300}>Click "Run Analysis" to generate architecture design, WAF assessment, and security posture simultaneously.</Text>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {isRunning ? (
          <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={handleCancel}>Cancel</Button>
        ) : (
          <Button appearance="primary" icon={<BuildingRegular />} onClick={handleRun} disabled={!spec.name && !spec.additionalNotes}>
            Run Analysis
          </Button>
        )}
        {isRunning && <Spinner size="small" label={pipelineMode ? "Running sequential pipeline…" : "Analyzing in parallel…"} />}
        {toast && (
          <Badge appearance="tint" color="success" size="small">{toast}</Badge>
        )}
        {allDone && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            {onRefine && (
              <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
                Refine in Chat
              </Button>
            )}
            <Button appearance="subtle" icon={<DocumentRegular />} onClick={handleExportBrief}>
              Export Brief
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
