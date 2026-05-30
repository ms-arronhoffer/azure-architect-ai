import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Select,
  Spinner,
  Badge,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  SendRegular,
  PersonRegular,
  ClockRegular,
  CheckmarkCircleRegular,
  LightbulbRegular,
  DocumentBulletListRegular,
  BeakerRegular,
  ArrowResetRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { downloadLearningPlan } from "../utils/learningPlanDocx";
import type { LearningPlan, LearningModule } from "../types";

const DURATION_OPTIONS: { label: string; value: number }[] = [
  { label: "Half Day (3.5 hrs)", value: 0.5 },
  { label: "1 Day", value: 1 },
  { label: "1.5 Days", value: 1.5 },
  { label: "2 Days", value: 2 },
  { label: "2.5 Days", value: 2.5 },
  { label: "3 Days", value: 3 },
];

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    padding: "20px 24px 0",
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    paddingBottom: "16px",
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "16px",
    color: tokens.colorNeutralForeground1,
    fontSize: "16px",
    fontWeight: 600,
  },
  form: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  formFull: {
    gridColumn: "1 / -1",
  },
  label: {
    display: "block",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground3,
    marginBottom: "4px",
  },
  input: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "7px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "7px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    resize: "vertical",
    minHeight: "72px",
    boxSizing: "border-box",
  },
  formActions: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "4px",
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
  },
  loadingState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "60px 0",
    color: tokens.colorNeutralForeground3,
  },
  // Plan output
  planHeader: {
    background: "linear-gradient(135deg, rgba(0,120,212,0.12) 0%, rgba(0,90,158,0.06) 100%)",
    border: `1px solid rgba(0,120,212,0.2)`,
    borderRadius: "10px",
    padding: "20px 24px",
    marginBottom: "20px",
  },
  planTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    marginBottom: "8px",
  },
  planOverview: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.6",
    marginBottom: "14px",
  },
  planMeta: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },
  metaBadge: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginBottom: "24px",
  },
  infoCard: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "16px",
  },
  infoCardTitle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "10px",
  },
  prereqTitle: {
    color: "#d97706",
  },
  outcomeTitle: {
    color: "#059669",
  },
  infoList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  infoItem: {
    display: "flex",
    gap: "8px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.5",
  },
  bullet: {
    flexShrink: 0,
    marginTop: "2px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
  },
  // Day group
  dayGroup: {
    marginBottom: "24px",
  },
  dayLabel: {
    fontSize: "12px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    marginBottom: "10px",
    paddingLeft: "2px",
  },
  modulesRow: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "1fr",
  },
  moduleCard: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "10px",
    padding: "18px 20px",
    borderLeft: `3px solid rgba(0,120,212,0.4)`,
  },
  moduleCardAfternoon: {
    borderLeft: `3px solid rgba(103,58,183,0.4)`,
  },
  moduleCardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "8px",
    gap: "12px",
  },
  moduleSessionLabel: {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: tokens.colorNeutralForeground4,
  },
  moduleTitle: {
    fontSize: "15px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    marginBottom: "6px",
  },
  moduleDescription: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.55",
    marginBottom: "14px",
  },
  moduleSection: {
    marginBottom: "12px",
  },
  moduleSectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground4,
    marginBottom: "6px",
  },
  topicsList: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  topicItem: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    display: "flex",
    gap: "8px",
    "&::before": {
      content: "'›'",
      color: tokens.colorNeutralForeground4,
      flexShrink: 0,
    },
  },
  skillTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
  },
  activityList: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  activityItem: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    fontStyle: "italic",
    display: "flex",
    gap: "8px",
  },
});

function groupModulesByDay(modules: LearningModule[]): Map<string, LearningModule[]> {
  const groups = new Map<string, LearningModule[]>();
  for (const m of modules) {
    const day = m.session_label.split("–")[0].trim();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(m);
  }
  return groups;
}

function isAfternoon(label: string) {
  return label.toLowerCase().includes("afternoon");
}

interface ModuleCardProps {
  module: LearningModule;
  styles: ReturnType<typeof useStyles>;
}

function ModuleCard({ module, styles }: ModuleCardProps) {
  const afternoon = isAfternoon(module.session_label);
  return (
    <div className={`${styles.moduleCard} ${afternoon ? styles.moduleCardAfternoon : ""}`}>
      <div className={styles.moduleCardHeader}>
        <div>
          <div className={styles.moduleSessionLabel}>{module.session_label}</div>
          <div className={styles.moduleTitle}>{module.title}</div>
        </div>
        {module.duration_hours && (
          <Badge appearance="tint" color="informative" size="small">
            {module.duration_hours}h
          </Badge>
        )}
      </div>
      <div className={styles.moduleDescription}>{module.description}</div>

      {module.topics.length > 0 && (
        <div className={styles.moduleSection}>
          <div className={styles.moduleSectionTitle}>
            <DocumentBulletListRegular fontSize={13} />
            Topics
          </div>
          <ul className={styles.topicsList}>
            {module.topics.map((t, i) => (
              <li key={i} className={styles.topicItem}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {module.skills_taught.length > 0 && (
        <div className={styles.moduleSection}>
          <div className={styles.moduleSectionTitle}>
            <LightbulbRegular fontSize={13} />
            Skills Taught
          </div>
          <div className={styles.skillTags}>
            {module.skills_taught.map((s, i) => (
              <Badge key={i} appearance="tint" color="success" size="small">{s}</Badge>
            ))}
          </div>
        </div>
      )}

      {module.activities && module.activities.length > 0 && (
        <div className={styles.moduleSection}>
          <div className={styles.moduleSectionTitle}>
            <BeakerRegular fontSize={13} />
            Activities
          </div>
          <ul className={styles.activityList}>
            {module.activities.map((a, i) => (
              <li key={i} className={styles.activityItem}>› {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface PlanViewProps {
  plan: LearningPlan;
  styles: ReturnType<typeof useStyles>;
}

function PlanView({ plan, styles }: PlanViewProps) {
  const groups = groupModulesByDay(plan.modules);
  const durationLabel = plan.duration_days === 0.5
    ? "Half Day"
    : `${plan.duration_days} Day${plan.duration_days !== 1 ? "s" : ""}`;

  return (
    <>
      <div className={styles.planHeader}>
        <div className={styles.planTitle}>{plan.title}</div>
        <div className={styles.planOverview}>{plan.overview}</div>
        <div className={styles.planMeta}>
          <span className={styles.metaBadge}>
            <PersonRegular fontSize={14} /> {plan.target_audience}
          </span>
          <span className={styles.metaBadge}>
            <ClockRegular fontSize={14} /> {durationLabel}
          </span>
          <span className={styles.metaBadge}>
            <BookOpenRegular fontSize={14} /> {plan.modules.length} sessions
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className={styles.infoCard}>
          <div className={`${styles.infoCardTitle} ${styles.prereqTitle}`}>
            <CheckmarkCircleRegular fontSize={14} /> Prerequisite Skills
          </div>
          <ul className={styles.infoList}>
            {plan.prerequisites.length === 0
              ? <li className={styles.infoItem}><span>None specified</span></li>
              : plan.prerequisites.map((p, i) => (
                  <li key={i} className={styles.infoItem}>
                    <span className={styles.bullet}>›</span>
                    <span>{p}</span>
                  </li>
                ))}
          </ul>
        </div>
        <div className={styles.infoCard}>
          <div className={`${styles.infoCardTitle} ${styles.outcomeTitle}`}>
            <LightbulbRegular fontSize={14} /> Learning Outcomes
          </div>
          <ul className={styles.infoList}>
            {plan.learning_outcomes.map((o, i) => (
              <li key={i} className={styles.infoItem}>
                <span className={styles.bullet}>›</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {Array.from(groups.entries()).map(([day, mods]) => (
        <div key={day} className={styles.dayGroup}>
          <div className={styles.dayLabel}>{day}</div>
          <div className={styles.modulesRow}>
            {mods.map((m, i) => (
              <ModuleCard key={i} module={m} styles={styles} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function LearningPlanPanel() {
  const styles = useStyles();
  const [topic, setTopic] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [audience, setAudience] = useState("");
  const [duration, setDuration] = useState(1);
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { stream, isStreaming } = useSSE();

  async function handleGenerate() {
    if (!topic.trim()) return;
    setPlan(null);
    setError(null);

    const durationLabel = DURATION_OPTIONS.find(d => d.value === duration)?.label ?? `${duration} days`;
    const content =
      `Create a ${durationLabel} learning plan on: ${topic.trim()}.` +
      (audience ? ` Target audience: ${audience.trim()}.` : "") +
      (outcomes ? ` Desired outcomes: ${outcomes.trim()}.` : "");

    await stream(
      "/api/chat",
      {
        mode: "learningplan",
        messages: [{ role: "user", content }],
        llm_config: null,
      },
      (event) => {
        if (event.type === "learning_plan") {
          setPlan(event.plan);
        }
        if (event.type === "error") {
          setError(event.message);
        }
      }
    );
  }

  function handleReset() {
    setPlan(null);
    setError(null);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <BookOpenRegular fontSize={18} />
          <span>Learning Plan Builder</span>
        </div>
        <div className={styles.form}>
          <div className={styles.formFull}>
            <label className={styles.label}>Topic / Subject</label>
            <input
              className={styles.input}
              placeholder="e.g. Azure networking fundamentals, AKS for developers..."
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={isStreaming}
            />
          </div>
          <div className={styles.formFull}>
            <label className={styles.label}>Desired Outcomes</label>
            <textarea
              className={styles.textarea}
              placeholder="What should learners be able to do after completing this plan?"
              value={outcomes}
              onChange={e => setOutcomes(e.target.value)}
              disabled={isStreaming}
              rows={2}
            />
          </div>
          <div>
            <label className={styles.label}>Audience</label>
            <input
              className={styles.input}
              placeholder="e.g. Cloud architects, junior developers..."
              value={audience}
              onChange={e => setAudience(e.target.value)}
              disabled={isStreaming}
            />
          </div>
          <div>
            <label className={styles.label}>Duration</label>
            <Select
              size="medium"
              value={String(duration)}
              onChange={(_, d) => setDuration(Number(d.value))}
              disabled={isStreaming}
            >
              {DURATION_OPTIONS.map(o => (
                <option key={o.value} value={String(o.value)}>{o.label}</option>
              ))}
            </Select>
          </div>
          <div className={styles.formActions}>
            {plan && (
              <>
                <Button
                  appearance="subtle"
                  icon={<ArrowDownloadRegular />}
                  onClick={() => downloadLearningPlan(plan)}
                  disabled={isStreaming}
                >
                  Download .docx
                </Button>
                <Button
                  appearance="subtle"
                  icon={<ArrowResetRegular />}
                  onClick={handleReset}
                  disabled={isStreaming}
                >
                  Reset
                </Button>
              </>
            )}
            <Button
              appearance="primary"
              icon={isStreaming ? <Spinner size="tiny" /> : <SendRegular />}
              onClick={handleGenerate}
              disabled={isStreaming || !topic.trim()}
            >
              {isStreaming ? "Generating..." : "Generate Plan"}
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {isStreaming && !plan && (
          <div className={styles.loadingState}>
            <Spinner size="medium" />
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              Designing your learning plan...
            </Text>
          </div>
        )}
        {error && (
          <Text style={{ color: tokens.colorStatusDangerForeground1 }}>
            Error: {error}
          </Text>
        )}
        {plan && <PlanView plan={plan} styles={styles} />}
      </div>
    </div>
  );
}
