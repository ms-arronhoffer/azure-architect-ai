import { useState, useRef } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Textarea,
  Input,
  Spinner,
  Card,
  Badge,
} from "@fluentui/react-components";
import {
  FormRegular,
  ChartMultipleRegular,
  ArrowRightRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import type { Mode, ConfidenceItem } from "../types";
import { apiFetch } from "../config/api";

interface IntakeChatPanelProps {
  onContinueIn: (mode: Mode, seed: string) => void;
}

interface QuestionAnswer {
  dimension: string;
  question: string;
  rationale?: string;
  answer: string;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    padding: "16px 24px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  stepCard: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  stepLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: 600,
    color: tokens.colorBrandForeground1,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  textarea: {
    width: "100%",
    minHeight: "120px",
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  questionGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  questionCard: {
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  questionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  questionText: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: 500,
  },
  rationale: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  scorePill: {
    fontSize: tokens.fontSizeBase100,
    padding: "2px 8px",
    borderRadius: "10px",
    background: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground2,
    fontWeight: 600,
  },
  doneBanner: {
    padding: "12px 16px",
    background: tokens.colorPaletteGreenBackground2,
    border: `1px solid ${tokens.colorPaletteGreenBorderActive}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  errorBox: {
    padding: "10px 12px",
    background: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground2,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
  },
});

const LOW_CONFIDENCE_THRESHOLD = 2;
const MAX_QUESTIONS = 3;

export default function IntakeChatPanel({ onContinueIn }: IntakeChatPanelProps) {
  const styles = useStyles();
  const { spec, setSpec } = useWorkloadSpec();
  const [paragraph, setParagraph] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionAnswer[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runAnalysis() {
    if (!paragraph.trim()) {
      setError("Describe your workload first.");
      return;
    }
    setLoading(true);
    setError(null);
    setQuestions([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements: paragraph,
          constraints: "",
          region: spec.primaryRegion || "",
          compliance: spec.complianceFrameworks || [],
          budget_usd: spec.monthlyBudgetUsd || 0,
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`Analysis failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const confidence: ConfidenceItem[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const block of lines) {
          if (!block.startsWith("data: ")) continue;
          const raw = block.slice(6).trim();
          if (!raw) continue;
          try {
            const obj = JSON.parse(raw);
            if (obj.type === "confidence" && Array.isArray(obj.items)) {
              for (const item of obj.items as ConfidenceItem[]) {
                confidence.push(item);
              }
            }
          } catch {
            // skip malformed
          }
        }
      }

      const lowConfidence = confidence
        .filter((c) => typeof c.score === "number" && c.score <= LOW_CONFIDENCE_THRESHOLD && c.suggested_question)
        .sort((a, b) => a.score - b.score)
        .slice(0, MAX_QUESTIONS)
        .map<QuestionAnswer>((c) => ({
          dimension: c.dimension,
          question: c.suggested_question || c.dimension,
          rationale: c.rationale,
          answer: "",
        }));

      setQuestions(lowConfidence);
      setAnalyzed(true);
      if (!spec.additionalNotes) {
        setSpec({ additionalNotes: paragraph });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Analysis failed");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function updateAnswer(idx: number, answer: string) {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, answer } : q)));
  }

  function handDone() {
    const answeredNotes = questions
      .filter((q) => q.answer.trim())
      .map((q) => `- **${q.question}** ${q.answer.trim()}`)
      .join("\n");
    const mergedNotes = [paragraph.trim(), answeredNotes].filter(Boolean).join("\n\n");
    setSpec({ additionalNotes: mergedNotes });

    const seed = [
      toSpecPromptPrefix({ ...spec, additionalNotes: mergedNotes }),
      paragraph.trim(),
      answeredNotes ? `\n## Follow-up answers\n${answeredNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    onContinueIn("analyze", seed);
  }

  const allAnswered = questions.length > 0 && questions.every((q) => q.answer.trim().length > 0);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text className={styles.title}>
          <FormRegular /> Guided Discovery
        </Text>
        <Text className={styles.subtitle}>
          Describe your workload in plain English. The system will ask only about what it can't infer.
        </Text>
      </div>

      <div className={styles.body}>
        <Card className={styles.stepCard}>
          <Text className={styles.stepLabel}>Step 1 — Describe your workload</Text>
          <Textarea
            className={styles.textarea}
            value={paragraph}
            onChange={(_, data) => setParagraph(data.value)}
            placeholder="e.g. A regulated patient-portal web app for a US health plan, 50k MAU, HIPAA, hosted in East US with DR. Reads from existing on-prem EHR via Service Bus."
            disabled={loading}
          />
          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={loading ? <Spinner size="tiny" /> : <ChartMultipleRegular />}
              onClick={runAnalysis}
              disabled={loading || !paragraph.trim()}
            >
              {loading ? "Analyzing…" : analyzed ? "Re-analyze" : "Analyze"}
            </Button>
            {analyzed && (
              <Badge appearance="tint" color="success">
                {questions.length} follow-up{questions.length === 1 ? "" : "s"} found
              </Badge>
            )}
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}
        </Card>

        {analyzed && questions.length === 0 && (
          <div className={styles.doneBanner}>
            <CheckmarkCircleRegular />
            <Text>No major gaps detected — you're ready for Workload Analysis.</Text>
          </div>
        )}

        {questions.length > 0 && (
          <Card className={styles.stepCard}>
            <Text className={styles.stepLabel}>Step 2 — Answer the gaps</Text>
            <div className={styles.questionGrid}>
              {questions.map((q, idx) => (
                <Card key={q.dimension + idx} className={styles.questionCard}>
                  <div className={styles.questionHeader}>
                    <span className={styles.scorePill}>Low confidence</span>
                    <Text className={styles.questionText}>{q.question}</Text>
                  </div>
                  {q.rationale && <Text className={styles.rationale}>{q.rationale}</Text>}
                  <Input
                    value={q.answer}
                    onChange={(_, data) => updateAnswer(idx, data.value)}
                    placeholder="Type your answer…"
                  />
                </Card>
              ))}
            </div>
          </Card>
        )}

        {analyzed && (
          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={<ArrowRightRegular />}
              onClick={handDone}
              disabled={questions.length > 0 && !allAnswered}
            >
              {questions.length === 0 ? "Continue to Workload Analysis" : "I'm done — run full analysis"}
            </Button>
            {questions.length > 0 && !allAnswered && (
              <Text className={styles.subtitle}>Answer all questions, or skip to full analysis.</Text>
            )}
            {questions.length > 0 && (
              <Button appearance="subtle" onClick={handDone}>
                Skip remaining
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
