import { useCallback, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Badge,
  ProgressBar,
} from "@fluentui/react-components";
import {
  CompassNorthwestRegular,
  FormRegular,
  ChartMultipleRegular,
  TargetRegular,
  CheckmarkCircleFilled,
  ArrowRightRegular,
  ArrowResetRegular,
} from "@fluentui/react-icons";
import type { Mode, WorkloadSpec } from "../types";

// The four Plan-category tools, reframed as one guided method for developing a
// plan: Discover → Capture → Analyze → Strategize. Each step launches the
// existing specialist tool but the user follows a single, ordered journey and
// the shared workload spec is carried forward automatically.
interface PlanStep {
  key: string;
  mode: Mode;
  n: number;
  title: string;
  tool: string;
  icon: JSX.Element;
  why: string;
  how: string;
}

const PLAN_STEPS: PlanStep[] = [
  {
    key: "discover",
    mode: "intakechat",
    n: 1,
    title: "Discover",
    tool: "Guided Discovery",
    icon: <CompassNorthwestRegular />,
    why: "Start broad. A conversational interview probes the gaps in your requirements so nothing important is missed before you commit to a design.",
    how: "Answer the assistant's questions about users, data, latency, regions, and compliance. It stops asking once it has enough confidence.",
  },
  {
    key: "capture",
    mode: "intake",
    n: 2,
    title: "Capture",
    tool: "Requirements Studio",
    icon: <FormRegular />,
    why: "Formalize what you learned into a structured workload spec. This spec is injected into every other tool, so you only describe the workload once.",
    how: "Fill in (or refine) the workload fields — criticality, SLA, RTO/RPO, budget, data classification. Saved automatically and shared everywhere.",
  },
  {
    key: "analyze",
    mode: "analyze",
    n: 3,
    title: "Analyze",
    tool: "Workload Analysis",
    icon: <ChartMultipleRegular />,
    why: "Turn the spec into a first architecture. One click produces a design plus a Well-Architected and security read so you see trade-offs early.",
    how: "Run the analysis; review the proposed architecture, WAF pillar scores, and security findings. Refine in chat or loop back to Capture.",
  },
  {
    key: "strategize",
    mode: "strategy",
    n: 4,
    title: "Strategize",
    tool: "Strategy Builder",
    icon: <TargetRegular />,
    why: "Wrap the analysis into a shareable narrative — the Azure strategy document your stakeholders actually read and approve.",
    how: "Generate the strategy document; edit sections, then export or continue into cost, design, or assessment tools with the plan intact.",
  },
];

const WORKLOAD_SPEC_KEY = "azure_workload_spec";
const JOURNEY_KEY = "azure_plan_journey";

function loadWorkloadName(): string {
  try {
    const raw = localStorage.getItem(WORKLOAD_SPEC_KEY);
    if (raw) {
      const spec = JSON.parse(raw) as Partial<WorkloadSpec>;
      return (spec.name ?? "").trim();
    }
  } catch {
    // ignore
  }
  return "";
}

function loadVisited(): Set<string> {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

function saveVisited(visited: Set<string>) {
  try {
    localStorage.setItem(JOURNEY_KEY, JSON.stringify([...visited]));
  } catch {
    // ignore
  }
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  scroll: { flex: 1, overflowY: "auto", padding: "24px 28px 40px" },
  header: { maxWidth: "820px", margin: "0 auto 20px", display: "flex", flexDirection: "column", gap: "8px" },
  title: { fontSize: "22px", fontWeight: 700, color: tokens.colorNeutralForeground1 },
  subtitle: { fontSize: "14px", lineHeight: 1.5, color: tokens.colorNeutralForeground2 },
  progressWrap: {
    maxWidth: "820px", margin: "0 auto 24px", display: "flex", flexDirection: "column", gap: "8px",
    padding: "14px 16px", background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "10px",
  },
  progressRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  progressMeta: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  steps: { maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" },
  card: {
    display: "flex", gap: "16px", padding: "18px 20px",
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "12px",
  },
  cardCurrent: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  cardDone: { background: tokens.colorNeutralBackground2 },
  rail: { display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: "40px", gap: "6px" },
  numberBadge: {
    width: "34px", height: "34px", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: "15px",
    background: tokens.colorNeutralBackground4, color: tokens.colorNeutralForeground2,
  },
  numberBadgeCurrent: { background: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand },
  doneIcon: { fontSize: "34px", color: tokens.colorPaletteGreenForeground1 },
  body: { flex: 1, display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  cardHead: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  stepTitle: { fontSize: "16px", fontWeight: 700, color: tokens.colorNeutralForeground1, display: "flex", alignItems: "center", gap: "8px" },
  tool: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  why: { fontSize: "13px", lineHeight: 1.55, color: tokens.colorNeutralForeground1 },
  how: { fontSize: "12.5px", lineHeight: 1.5, color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" },
  footer: {
    maxWidth: "820px", margin: "24px auto 0", display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "12px",
    paddingTop: "16px", borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  footerNote: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
});

interface PlanStudioPanelProps {
  onNavigate: (mode: Mode) => void;
}

export default function PlanStudioPanel({ onNavigate }: PlanStudioPanelProps) {
  const styles = useStyles();
  const [visited, setVisited] = useState<Set<string>>(loadVisited);
  const workloadName = useMemo(loadWorkloadName, []);

  // A step is "complete" when it has a reliable signal (Capture → the workload
  // spec has a name; Discover feeds that same spec) or the user has visited it.
  const isComplete = useCallback(
    (step: PlanStep): boolean => {
      if (step.key === "capture" || step.key === "discover") {
        if (workloadName) return true;
      }
      return visited.has(step.key);
    },
    [visited, workloadName],
  );

  const completedCount = PLAN_STEPS.filter(isComplete).length;
  // The current step is the first one that isn't complete yet.
  const currentKey = PLAN_STEPS.find((s) => !isComplete(s))?.key ?? null;

  const go = useCallback(
    (step: PlanStep) => {
      const next = new Set(visited);
      next.add(step.key);
      setVisited(next);
      saveVisited(next);
      onNavigate(step.mode);
    },
    [visited, onNavigate],
  );

  const resetJourney = useCallback(() => {
    setVisited(new Set());
    saveVisited(new Set());
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <div className={styles.header}>
          <Text className={styles.title}>Plan Studio</Text>
          <Text className={styles.subtitle}>
            Develop your Azure plan in four guided steps. Each step opens the right specialist tool,
            and your workload details are captured once and carried through the whole journey — so the
            pieces work together instead of standing alone.
          </Text>
        </div>

        <div className={styles.progressWrap}>
          <div className={styles.progressRow}>
            <Text weight="semibold">
              {completedCount === PLAN_STEPS.length
                ? "Plan complete — all four steps done"
                : `Step ${Math.min(completedCount + 1, PLAN_STEPS.length)} of ${PLAN_STEPS.length}`}
            </Text>
            {workloadName ? (
              <Badge appearance="tint" color="brand">{workloadName}</Badge>
            ) : (
              <span className={styles.progressMeta}>No workload named yet</span>
            )}
          </div>
          <ProgressBar value={completedCount / PLAN_STEPS.length} thickness="large" />
        </div>

        <div className={styles.steps}>
          {PLAN_STEPS.map((step) => {
            const done = isComplete(step);
            const current = step.key === currentKey;
            return (
              <div
                key={step.key}
                className={`${styles.card} ${current ? styles.cardCurrent : ""} ${done && !current ? styles.cardDone : ""}`}
              >
                <div className={styles.rail}>
                  {done && !current ? (
                    <CheckmarkCircleFilled className={styles.doneIcon} />
                  ) : (
                    <div className={`${styles.numberBadge} ${current ? styles.numberBadgeCurrent : ""}`}>
                      {step.n}
                    </div>
                  )}
                </div>
                <div className={styles.body}>
                  <div className={styles.cardHead}>
                    <span className={styles.stepTitle}>
                      {step.icon}
                      {step.title}
                    </span>
                    <span className={styles.tool}>· {step.tool}</span>
                    {current && <Badge appearance="filled" color="brand" size="small">You are here</Badge>}
                    {done && !current && <Badge appearance="tint" color="success" size="small">Done</Badge>}
                  </div>
                  <Text className={styles.why}>{step.why}</Text>
                  <Text className={styles.how}>{step.how}</Text>
                  <div className={styles.actions}>
                    <Button
                      appearance={current ? "primary" : "secondary"}
                      icon={<ArrowRightRegular />}
                      iconPosition="after"
                      onClick={() => go(step)}
                    >
                      {done ? "Revisit" : current ? "Start" : "Open"} {step.tool}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerNote}>
            Progress is tracked from your saved workload spec and the steps you open. Tools remain
            available individually — this just gives them a recommended order.
          </span>
          <Button appearance="subtle" icon={<ArrowResetRegular />} onClick={resetJourney}>
            Reset journey
          </Button>
        </div>
      </div>
    </div>
  );
}
