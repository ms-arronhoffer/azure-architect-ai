import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Label,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowRightRegular,
  CheckmarkRegular,
  DismissRegular,
  EditRegular,
  SparkleRegular,
} from "@fluentui/react-icons";

import type { DeckOutline, DeckRecommendation } from "../types";
import ChatPanel from "./ChatPanel";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  tabBar: {
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  chatWrap: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  coachBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 16px",
    backgroundColor: tokens.colorBrandBackground2,
    borderBottom: `1px solid ${tokens.colorBrandStroke2}`,
    flexShrink: 0,
    flexWrap: "wrap",
  },
  coachBannerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  topicRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 16px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  chatInner: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  builder: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    maxWidth: "820px",
    width: "100%",
    marginLeft: "auto",
    marginRight: "auto",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "10px",
    padding: "20px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  fieldWrap: { display: "flex", flexDirection: "column", gap: "5px" },
  textareaBox: {
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
    "&:focus-within": {
      border: `1px solid ${tokens.colorBrandStroke1}`,
    },
  },
  textarea: {
    display: "block",
    width: "100%",
    minHeight: "80px",
    padding: "10px 12px",
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground1,
    boxSizing: "border-box",
  },
  rowInputs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  statusBox: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "14px 18px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  assessmentCard: {
    padding: "16px 18px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  recCard: {
    padding: "14px 16px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  recHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  actionRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  editJson: {
    display: "block",
    width: "100%",
    minHeight: "300px",
    padding: "12px",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    outline: "none",
    resize: "vertical",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground1,
    boxSizing: "border-box",
  },
  successCard: {
    padding: "20px 22px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    alignItems: "flex-start",
  },
  outlinePreview: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  slideChip: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
});

type Phase = "idle" | "generating" | "review" | "editing" | "building" | "done";

const SEVERITY_COLOR: Record<string, "danger" | "warning" | "informative"> = {
  high: "danger",
  medium: "warning",
  low: "informative",
};

const TYPE_LABEL: Record<string, string> = {
  structure: "Structure",
  content: "Content",
  narrative: "Narrative",
  audience_fit: "Audience Fit",
};

const LAYOUT_LABEL: Record<string, string> = {
  title: "Title Slide",
  agenda: "Agenda",
  section_divider: "Section Divider",
  content: "Content",
  two_column: "Two Column",
  quote_stat: "Quote / Stat",
  summary: "Summary",
  references: "References",
};

export default function PresentationPanel() {
  const styles = useStyles();
  const [activeTab, setActiveTab] = useState<"coach" | "build">("coach");

  // Form state
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [objectives, setObjectives] = useState("");
  const [numSlides, setNumSlides] = useState("10");
  const [conversationContext, setConversationContext] = useState("");

  // Pipeline state
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [originalOutline, setOriginalOutline] = useState<DeckOutline | null>(null);
  const [improvedOutline, setImprovedOutline] = useState<DeckOutline | null>(null);
  const [recommendations, setRecommendations] = useState<DeckRecommendation[]>([]);
  const [overallAssessment, setOverallAssessment] = useState("");
  const [editableJson, setEditableJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function handleBuildFromConversation(conversationText: string) {
    // Extract first user message as topic seed
    const firstUserLine = conversationText.split("\n").find((l) => l.startsWith("User:"));
    const seedTopic = firstUserLine ? firstUserLine.replace(/^User:\s*/, "").slice(0, 200) : "";
    setTopic((t) => t || seedTopic);
    setConversationContext(conversationText);
    setActiveTab("build");
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setPhase("generating");
    setStatusMsg("Generating deck outline…");
    setOriginalOutline(null);
    setImprovedOutline(null);
    setRecommendations([]);
    setOverallAssessment("");

    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/presentation/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          audience,
          objectives,
          num_slides: parseInt(numSlides, 10) || 10,
          conversation_context: conversationContext,
        }),
        signal: abortRef.current.signal,
      });

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6));

          if (evt.type === "outline") {
            setOriginalOutline(evt.outline);
            setStatusMsg("Reviewing outline with AI…");
          } else if (evt.type === "review") {
            setImprovedOutline(evt.improved_outline);
            setRecommendations(evt.recommendations);
            setOverallAssessment(evt.overall_assessment);
            setPhase("review");
          } else if (evt.type === "done") {
            // handled by "review" event
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setPhase("idle");
        setStatusMsg("Error generating outline. Please try again.");
      }
    }
  }

  function applyRecommendations() {
    if (improvedOutline) handleBuild(improvedOutline);
  }

  function useOriginal() {
    if (originalOutline) handleBuild(originalOutline);
  }

  function startEditing() {
    const outline = improvedOutline ?? originalOutline;
    setEditableJson(JSON.stringify(outline, null, 2));
    setJsonError("");
    setPhase("editing");
  }

  function buildEdited() {
    try {
      const parsed = JSON.parse(editableJson);
      setJsonError("");
      handleBuild(parsed);
    } catch {
      setJsonError("Invalid JSON. Please fix the syntax before building.");
    }
  }

  async function handleBuild(outline: DeckOutline) {
    setPhase("building");
    setStatusMsg("Building presentation…");
    try {
      const res = await fetch("/api/presentation/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline }),
      });
      if (!res.ok) throw new Error("Build failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "presentation.pptx";
      a.click();
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch {
      setPhase("review");
      setStatusMsg("Build failed. Please try again.");
    }
  }

  function reset() {
    setPhase("idle");
    setTopic("");
    setAudience("");
    setObjectives("");
    setNumSlides("10");
    setOriginalOutline(null);
    setImprovedOutline(null);
    setRecommendations([]);
    setOverallAssessment("");
    setEditableJson("");
    setStatusMsg("");
    setConversationContext("");
  }

  const displayOutline = improvedOutline ?? originalOutline;

  return (
    <div className={styles.root}>
      <div className={styles.tabBar}>
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, d) => setActiveTab(d.value as "coach" | "build")}
          size="medium"
        >
          <Tab value="coach">Presentation Coach</Tab>
          <Tab value="build">Build Deck</Tab>
        </TabList>
      </div>

      {activeTab === "coach" && (
        <div className={styles.chatWrap}>
          {/* Banner: always visible, invites user to build */}
          <div className={styles.coachBanner}>
            <div className={styles.coachBannerLeft}>
              <Text size={300} weight="semibold">Presentation Coach</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                Ask for structure, narrative advice, or talking points — then build your deck.
              </Text>
            </div>
            <Button
              appearance="primary"
              icon={<ArrowRightRegular />}
              iconPosition="after"
              onClick={() => setActiveTab("build")}
            >
              Build Deck
            </Button>
          </div>

          {/* Shared topic bar: what the user types here pre-fills the Build Deck form */}
          <div className={styles.topicRow}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" }}>
              Topic:
            </Text>
            <Input
              style={{ flex: 1 }}
              placeholder="e.g. Migrating to Azure Kubernetes Service"
              value={topic}
              onChange={(_, d) => setTopic(d.value)}
              size="small"
            />
            <Button
              size="small"
              appearance="secondary"
              icon={<SparkleRegular />}
              onClick={() => setActiveTab("build")}
              disabled={!topic.trim()}
            >
              Build Deck from this
            </Button>
          </div>

          <div className={styles.chatInner}>
            <ChatPanel mode="presentation" onBuildDeck={handleBuildFromConversation} />
          </div>
        </div>
      )}

      {activeTab === "build" && (
        <div className={styles.builder}>
          {/* ── Input form (always visible when idle) ─────────────── */}
          {phase === "idle" && (
            <div className={styles.form}>
              <Text size={500} weight="semibold">Build a Presentation</Text>
              {conversationContext ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Badge appearance="filled" color="brand" size="medium">
                    Using conversation context
                  </Badge>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DismissRegular />}
                    onClick={() => setConversationContext("")}
                    title="Clear conversation context"
                  />
                </div>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  Describe your topic and the AI will generate a polished deck outline,
                  review it for quality, then build the PPTX for you.
                </Text>
              )}

              <div className={styles.fieldWrap}>
                <Label required>Topic / Title</Label>
                <div className={styles.textareaBox}>
                  <textarea
                    className={styles.textarea}
                    placeholder="e.g. Migrating to Azure Kubernetes Service from on-premises Docker Swarm"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    style={{ boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div className={styles.rowInputs}>
                <div className={styles.fieldWrap}>
                  <Label>Target Audience</Label>
                  <Input
                    placeholder="e.g. C-suite executives"
                    value={audience}
                    onChange={(_, d) => setAudience(d.value)}
                  />
                </div>
                <div className={styles.fieldWrap}>
                  <Label>Number of Slides</Label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={numSlides}
                    onChange={(_, d) => setNumSlides(d.value)}
                    min={6}
                    max={25}
                  />
                </div>
              </div>

              <div className={styles.fieldWrap}>
                <Label>Key Objectives</Label>
                <Input
                  placeholder="e.g. Secure executive buy-in for cloud migration programme"
                  value={objectives}
                  onChange={(_, d) => setObjectives(d.value)}
                />
              </div>

              <div>
                <Button
                  appearance="primary"
                  icon={<SparkleRegular />}
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                >
                  Generate Deck
                </Button>
              </div>
            </div>
          )}

          {/* ── Generating progress ───────────────────────────────── */}
          {phase === "generating" && (
            <div className={styles.statusBox}>
              <Spinner size="small" />
              <Text>{statusMsg}</Text>
            </div>
          )}

          {/* ── Review phase ──────────────────────────────────────── */}
          {phase === "review" && (
            <>
              {/* Overall assessment */}
              <div className={styles.assessmentCard}>
                <Text size={400} weight="semibold" block style={{ marginBottom: "8px" }}>
                  AI Review
                </Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  {overallAssessment}
                </Text>
              </div>

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <Text size={300} weight="semibold">Recommendations</Text>
                  {recommendations.map((rec, i) => (
                    <div key={i} className={styles.recCard}>
                      <div className={styles.recHeader}>
                        <Badge
                          appearance="filled"
                          color={SEVERITY_COLOR[rec.severity] ?? "informative"}
                          size="small"
                        >
                          {rec.severity.toUpperCase()}
                        </Badge>
                        <Badge appearance="outline" size="small">
                          {TYPE_LABEL[rec.type] ?? rec.type}
                        </Badge>
                      </div>
                      <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground1 }}>
                        {rec.issue}
                      </Text>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                        {rec.suggestion}
                      </Text>
                    </div>
                  ))}
                </div>
              )}

              {/* Outline preview */}
              {displayOutline && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <Text size={300} weight="semibold">
                    Improved Outline — {displayOutline.slides.length} slides
                  </Text>
                  <div className={styles.outlinePreview}>
                    {displayOutline.slides.map((sl) => (
                      <div key={sl.slide_number} className={styles.slideChip}>
                        <Text size={100} style={{ color: tokens.colorBrandForeground1, minWidth: "22px" }}>
                          {sl.slide_number}
                        </Text>
                        <Badge appearance="tint" size="small" style={{ minWidth: "96px" }}>
                          {LAYOUT_LABEL[sl.layout] ?? sl.layout}
                        </Badge>
                        <Text size={100} style={{ color: tokens.colorNeutralForeground2 }}>
                          {sl.title}
                        </Text>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className={styles.actionRow}>
                <Button
                  appearance="primary"
                  icon={<CheckmarkRegular />}
                  onClick={applyRecommendations}
                >
                  Apply Recommendations &amp; Build
                </Button>
                <Button
                  appearance="secondary"
                  icon={<EditRegular />}
                  onClick={startEditing}
                >
                  Edit &amp; Customize
                </Button>
                <Button
                  appearance="subtle"
                  icon={<DismissRegular />}
                  onClick={useOriginal}
                >
                  Use Original
                </Button>
              </div>
            </>
          )}

          {/* ── Editing phase ─────────────────────────────────────── */}
          {phase === "editing" && (
            <>
              <Text size={300} weight="semibold">Edit Outline JSON</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                Modify the outline structure, slide content, or speaker notes below, then build.
              </Text>
              <textarea
                className={styles.editJson}
                value={editableJson}
                onChange={(e) => { setEditableJson(e.target.value); setJsonError(""); }}
                spellCheck={false}
                style={{ boxSizing: "border-box" }}
              />
              {jsonError && (
                <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                  {jsonError}
                </Text>
              )}
              <div className={styles.actionRow}>
                <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={buildEdited}>
                  Build This Deck
                </Button>
                <Button appearance="subtle" onClick={() => setPhase("review")}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {/* ── Building progress ─────────────────────────────────── */}
          {phase === "building" && (
            <div className={styles.statusBox}>
              <Spinner size="small" />
              <Text>Building presentation…</Text>
            </div>
          )}

          {/* ── Done ─────────────────────────────────────────────── */}
          {phase === "done" && (
            <div className={styles.successCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckmarkRegular style={{ color: tokens.colorPaletteGreenForeground1, fontSize: "20px" }} />
                <Text size={400} weight="semibold">Presentation ready!</Text>
              </div>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                Your PPTX has been downloaded. Open it in PowerPoint to review speaker notes and
                make any final edits.
              </Text>
              <div className={styles.actionRow}>
                <Button
                  appearance="primary"
                  icon={<ArrowDownloadRegular />}
                  onClick={() => displayOutline && handleBuild(displayOutline)}
                >
                  Download Again
                </Button>
                <Button appearance="subtle" onClick={reset}>
                  Start Over
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
