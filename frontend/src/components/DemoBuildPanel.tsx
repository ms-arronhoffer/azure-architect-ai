import { useState, useEffect, useMemo } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  Input,
  Field,
  Card,
  Dropdown,
  Option,
  Tab,
  TabList,
  Switch,
  Tooltip,
  Textarea,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import {
  PlayRegular,
  StopRegular,
  RocketRegular,
  ArrowDownloadRegular,
  DocumentRegular,
  CloudRegular,
  CheckmarkCircleFilled,
  DismissCircleRegular,
} from "@fluentui/react-icons";
import type { DemoFileManifestEntry } from "../types";
import { useWorkloadSpec } from "../hooks/useWorkloadSpec";
import { useSettings } from "../hooks/useSettings";
import { useDemoBuild } from "../contexts/DemoBuildContext";
import type {
  DemoPhase,
  DemoPhaseEvent,
  DemoPipelineRequestShape,
} from "../utils/demoPipelineState";

const PHASE_ORDER: DemoPhase[] = [
  "intake_normalize",
  "recommendations",
  "architecture_design",
  "build",
  "verify",
  "publish",
];

const BUILD_LANES: DemoPhase[] = ["build.code", "build.infra", "build.docs"];

const PHASE_LABELS: Record<DemoPhase, string> = {
  intake_normalize: "Intake & Normalize",
  recommendations: "Recommendations",
  architecture_design: "Architecture Design",
  build: "Build (parallel)",
  "build.code": "Code lane",
  "build.infra": "Infra lane",
  "build.docs": "Docs lane",
  verify: "Verify (az bicep build)",
  publish: "Publish",
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  header: {
    flexShrink: 0,
    padding: "20px 28px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "20px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr",
    gap: "12px",
  },
  formGrid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  controls: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "360px",
    overflowY: "auto",
    paddingRight: "4px",
  },
  phaseRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 12px",
    borderRadius: "4px",
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  phaseRowChild: {
    marginLeft: "24px",
    background: tokens.colorNeutralBackground2,
  },
  servicesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "10px",
  },
  serviceCard: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
  },
  serviceHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  serviceRole: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  fileLayout: {
    display: "grid",
    gridTemplateColumns: "260px 1fr",
    gap: "12px",
    minHeight: "320px",
  },
  fileTree: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "4px",
    background: tokens.colorNeutralBackground1,
    overflow: "auto",
    maxHeight: "520px",
  },
  fileGroup: {
    padding: "6px 10px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground3,
    background: tokens.colorNeutralBackground2,
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "Consolas, monospace",
    "&:hover": { background: tokens.colorNeutralBackground1Hover },
  },
  fileRowActive: {
    background: "rgba(0, 120, 212, 0.12)",
    borderLeft: "2px solid #0078D4",
  },
  viewer: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "4px",
    background: tokens.colorNeutralBackground1,
    padding: "12px",
    overflow: "auto",
    maxHeight: "520px",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    whiteSpace: "pre-wrap",
  },
  prose: {
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    margin: 0,
  },
  diagramBlock: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "4px",
    background: tokens.colorNeutralBackground1,
    padding: "12px",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    whiteSpace: "pre-wrap",
    overflow: "auto",
  },
});

type PhaseStatus = "pending" | "started" | "complete" | "skipped" | "failed" | "progress";

function statusBadge(status: PhaseStatus, reason?: string, error?: string, degraded?: boolean) {
  switch (status) {
    case "complete":
      return (
        <Badge appearance="filled" color={degraded ? "warning" : "success"}>
          {degraded ? "complete (fallback)" : "complete"}
        </Badge>
      );
    case "skipped":
      return <Badge appearance="tint" color="warning">skipped{reason ? ` · ${reason}` : ""}</Badge>;
    case "failed":
      return <Badge appearance="tint" color="danger">failed{error ? ` · ${error}` : ""}</Badge>;
    case "started":
    case "progress":
      return <Badge appearance="tint" color="brand">running</Badge>;
    default:
      return <Badge appearance="outline">pending</Badge>;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Furthest "behind the scenes" stage the Azure services have reached, derived
// from the pipeline events. Drives the live provisioning view.
type ServiceStage = "pending" | "planning" | "designed" | "provisioned" | "verified";

function deriveServiceStage(events: DemoPhaseEvent[]): ServiceStage {
  const has = (phase: DemoPhase, type: DemoPhaseEvent["type"]) =>
    events.some((e) => e.phase === phase && e.type === type);
  const verifyOk = events.some(
    (e) => e.phase === "verify" && e.type === "complete",
  );
  if (verifyOk) return "verified";
  if (has("build.infra", "complete")) return "provisioned";
  if (has("architecture_design", "complete")) return "designed";
  if (has("recommendations", "started") || has("architecture_design", "started"))
    return "planning";
  return "pending";
}

const STAGE_LABEL: Record<ServiceStage, string> = {
  pending: "Pending",
  planning: "Planning",
  designed: "Designed",
  provisioned: "Provisioned (Bicep)",
  verified: "Verified",
};

const STAGE_COLOR: Record<ServiceStage, "informative" | "brand" | "success"> = {
  pending: "informative",
  planning: "brand",
  designed: "brand",
  provisioned: "success",
  verified: "success",
};

export default function DemoBuildPanel() {
  const styles = useStyles();
  const { spec } = useWorkloadSpec();
  const { githubTokenConfigured } = useSettings();
  const {
    status,
    events,
    result,
    azureServices,
    isRunning,
    downloadError,
    start,
    stop,
    reset,
    downloadZip,
  } = useDemoBuild();

  const initialSlug = useMemo(() => slugify(spec.name || "my-azure-demo"), [spec.name]);

  const [demoSlug, setDemoSlug] = useState(initialSlug);
  const [demoTitle, setDemoTitle] = useState(spec.name || "My Azure Demo");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"customer" | "internal" | "partner">("customer");
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [targetPersona, setTargetPersona] = useState("platform engineer");
  const [keyFeaturesText, setKeyFeaturesText] = useState("streaming, managed identity");
  const [azureServicesText, setAzureServicesText] = useState("Azure OpenAI, App Service");
  const [publish, setPublish] = useState(false);
  const [publishTouched, setPublishTouched] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"talk" | "readme" | "files" | "diagrams" | "verify">("talk");

  // Default the Publish switch ON once we know a PAT is configured, but never
  // override an explicit user toggle (publishTouched).
  useEffect(() => {
    if (!publishTouched && githubTokenConfigured) setPublish(true);
  }, [githubTokenConfigured, publishTouched]);

  useEffect(() => {
    if (result && result.manifest.length > 0 && !selectedFile) {
      setSelectedFile(result.manifest[0].path);
    }
  }, [result, selectedFile]);

  const keyFeatures = useMemo(
    () => keyFeaturesText.split(",").map((s) => s.trim()).filter(Boolean),
    [keyFeaturesText],
  );
  const azureServicesInput = useMemo(
    () => azureServicesText.split(",").map((s) => s.trim()).filter(Boolean),
    [azureServicesText],
  );

  function phaseStatus(phase: DemoPhase): {
    status: PhaseStatus;
    reason?: string;
    error?: string;
    degraded?: boolean;
  } {
    let current: PhaseStatus = "pending";
    let reason: string | undefined;
    let error: string | undefined;
    let degraded: boolean | undefined;
    for (const ev of events) {
      if (ev.phase !== phase) continue;
      if (ev.type === "progress" && current !== "pending") continue;
      current = ev.type;
      reason = ev.reason;
      error = ev.error;
      degraded = ev.degraded;
    }
    return { status: current, reason, error, degraded };
  }

  async function handleRun() {
    if (!demoSlug || !demoTitle) return;
    setSelectedFile(null);
    const requestShape: DemoPipelineRequestShape = {
      demo_slug: demoSlug,
      demo_title: demoTitle,
      description,
      audience,
      duration_minutes: durationMinutes,
      target_persona: targetPersona,
      key_features: keyFeatures,
      azure_services: azureServicesInput,
    };
    await start({
      body: { ...requestShape, spec, publish },
      requestShape,
      publish,
    });
  }

  const stage = deriveServiceStage(events);
  const serviceList = azureServices.length > 0 ? azureServices : azureServicesInput;
  const behindTheScenes = result?.behind_the_scenes ?? [];
  const roleFor = (svc: string) =>
    behindTheScenes.find((b) => b.service.toLowerCase() === svc.toLowerCase())?.role;

  const filesByKind = useMemo(() => {
    const groups: Record<string, DemoFileManifestEntry[]> = { code: [], infra: [], docs: [], config: [] };
    if (result) {
      for (const entry of result.manifest) {
        (groups[entry.kind] ?? groups.code).push(entry);
      }
    }
    return groups;
  }, [result]);

  const selectedIsDoc = selectedFile?.endsWith(".md");

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">Demo Builder</Text>
        <Text size={200}>
          6-phase pipeline: intake → recommendations → architecture design → parallel build (code / infra / docs) → verify → publish. Produces a clone-and-run Azure demo.
        </Text>
        <MessageBar intent="info">
          <MessageBarBody>
            Builds run in the background — you can switch tools or close this page. A toast will let you know when the demo is ready to download{publish ? " and pushed to GitHub" : ""}.
          </MessageBarBody>
        </MessageBar>
        <div className={styles.formGrid}>
          <Field label="Slug">
            <Input value={demoSlug} onChange={(_, d) => setDemoSlug(slugify(d.value))} placeholder="my-azure-demo" />
          </Field>
          <Field label="Title">
            <Input value={demoTitle} onChange={(_, d) => setDemoTitle(d.value)} placeholder="My Azure Demo" />
          </Field>
          <Field label="Audience">
            <Dropdown
              value={audience}
              selectedOptions={[audience]}
              onOptionSelect={(_, d) => d.optionValue && setAudience(d.optionValue as typeof audience)}
            >
              <Option value="customer">customer</Option>
              <Option value="internal">internal</Option>
              <Option value="partner">partner</Option>
            </Dropdown>
          </Field>
          <Field label="Duration (min)">
            <Dropdown
              value={String(durationMinutes)}
              selectedOptions={[String(durationMinutes)]}
              onOptionSelect={(_, d) => d.optionValue && setDurationMinutes(Number(d.optionValue))}
            >
              <Option value="5">5</Option>
              <Option value="15">15</Option>
              <Option value="30">30</Option>
            </Dropdown>
          </Field>
        </div>
        <Field label="What should this demo do? (outcome, key features to showcase, wow moment)">
          <Textarea
            value={description}
            onChange={(_, d) => setDescription(d.value)}
            rows={3}
            placeholder="e.g. End-to-end RAG over policy PDFs with streaming citations. Wow moment: live grounding badges that update token-by-token."
          />
        </Field>
        <div className={styles.formGrid2}>
          <Field label="Target persona">
            <Input value={targetPersona} onChange={(_, d) => setTargetPersona(d.value)} />
          </Field>
          <Field label="Key features (comma-separated)">
            <Input value={keyFeaturesText} onChange={(_, d) => setKeyFeaturesText(d.value)} />
          </Field>
        </div>
        <Field label="Azure services (comma-separated)">
          <Textarea value={azureServicesText} onChange={(_, d) => setAzureServicesText(d.value)} rows={2} />
        </Field>
        <div className={styles.controls}>
          {isRunning ? (
            <Button appearance="secondary" icon={<StopRegular />} onClick={() => void stop()}>Stop</Button>
          ) : (
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={() => void handleRun()}
              disabled={!demoSlug || !demoTitle}
            >
              Run
            </Button>
          )}
          {isRunning && <Spinner size="tiny" />}
          <Tooltip
            content={
              githubTokenConfigured
                ? "Publish requires a GitHub PAT saved in Settings. The repo is created under your account, or under DEMO_FACTORY_GH_ORG when set."
                : "Save a GitHub PAT in Settings to enable publishing. Without a PAT this phase is skipped."
            }
            relationship="label"
          >
            <Switch
              checked={publish}
              onChange={(_, d) => {
                setPublishTouched(true);
                setPublish(d.checked);
              }}
              disabled={!githubTokenConfigured}
              label="Publish to GitHub"
            />
          </Tooltip>
          {result?.job_id && !isRunning && (
            <Button appearance="secondary" icon={<ArrowDownloadRegular />} onClick={() => void downloadZip()}>
              Download ZIP
            </Button>
          )}
          {result?.repo_url && (
            <Button appearance="subtle" icon={<RocketRegular />} as="a" {...{ href: result.repo_url, target: "_blank", rel: "noreferrer" }}>
              Open repo
            </Button>
          )}
          {(result || status !== "idle") && !isRunning && (
            <Button appearance="subtle" onClick={reset}>New build</Button>
          )}
        </div>
        {downloadError && (
          <MessageBar intent="error">
            <MessageBarBody>ZIP download failed: {downloadError}</MessageBarBody>
          </MessageBar>
        )}
      </div>

      <div className={styles.body}>
        <Card className={styles.card}>
          <Text weight="semibold">Phases</Text>
          <div className={styles.timeline}>
            {PHASE_ORDER.map((phase) => {
              const { status: pStatus, reason, error, degraded } = phaseStatus(phase);
              const rows = [
                <div key={phase} className={styles.phaseRow}>
                  <RocketRegular />
                  <Text weight="semibold" style={{ minWidth: "180px" }}>{PHASE_LABELS[phase]}</Text>
                  {statusBadge(pStatus, reason, error, degraded)}
                </div>,
              ];
              if (phase === "build") {
                for (const child of BUILD_LANES) {
                  const cs = phaseStatus(child);
                  rows.push(
                    <div key={child} className={`${styles.phaseRow} ${styles.phaseRowChild}`}>
                      <DocumentRegular />
                      <Text style={{ minWidth: "160px" }}>{PHASE_LABELS[child]}</Text>
                      {statusBadge(cs.status, cs.reason, cs.error, cs.degraded)}
                    </div>,
                  );
                }
              }
              return rows;
            })}
          </div>
        </Card>

        {serviceList.length > 0 && (
          <Card className={styles.card}>
            <div className={styles.serviceHead}>
              <CloudRegular />
              <Text weight="semibold">Behind the scenes — Azure services</Text>
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              What each Azure service is doing as the demo is designed, provisioned (Bicep) and verified.
            </Text>
            <div className={styles.servicesGrid}>
              {serviceList.map((svc) => {
                const role = roleFor(svc);
                return (
                  <div key={svc} className={styles.serviceCard}>
                    <div className={styles.serviceHead}>
                      {stage === "verified" || stage === "provisioned" ? (
                        <CheckmarkCircleFilled style={{ color: tokens.colorPaletteGreenForeground1 }} />
                      ) : (
                        <CloudRegular />
                      )}
                      <Text weight="semibold">{svc}</Text>
                    </div>
                    <Badge appearance="tint" color={STAGE_COLOR[stage]}>{STAGE_LABEL[stage]}</Badge>
                    {role && <Text className={styles.serviceRole}>{role}</Text>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {result && (
          <Card className={styles.card}>
            <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as typeof activeTab)}>
              <Tab value="talk">Talk track</Tab>
              <Tab value="readme">Readme</Tab>
              <Tab value="files">Files ({result.manifest.length})</Tab>
              <Tab value="diagrams">Diagrams ({result.diagrams.length})</Tab>
              <Tab value="verify">Verify</Tab>
            </TabList>

            {activeTab === "talk" && (
              <div className={styles.viewer}>
                {result.talk_track ? (
                  <pre className={styles.prose}>{result.talk_track}</pre>
                ) : (
                  <Text>
                    No talk track was produced. Open DEMO_SCRIPT.md in the Files tab for the presenter narrative.
                  </Text>
                )}
                {behindTheScenes.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text weight="semibold">How it works behind the scenes</Text>
                    <ul style={{ marginTop: 6 }}>
                      {behindTheScenes.map((b, i) => (
                        <li key={i}>
                          <Text weight="semibold">{b.service}</Text>: {b.role}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab === "readme" && (
              <div className={styles.viewer}>
                {result.readme_md ? (
                  <pre className={styles.prose}>{result.readme_md}</pre>
                ) : (
                  <Text>README.md was not produced. Check the docs lane in the timeline.</Text>
                )}
              </div>
            )}

            {activeTab === "files" && (
              <div className={styles.fileLayout}>
                <div className={styles.fileTree}>
                  {(["code", "infra", "docs", "config"] as const).map((kind) =>
                    filesByKind[kind].length === 0 ? null : (
                      <div key={kind}>
                        <div className={styles.fileGroup}>{kind}</div>
                        {filesByKind[kind].map((entry) => (
                          <div
                            key={entry.path}
                            className={`${styles.fileRow} ${selectedFile === entry.path ? styles.fileRowActive : ""}`}
                            onClick={() => setSelectedFile(entry.path)}
                          >
                            {entry.path}
                          </div>
                        ))}
                      </div>
                    ),
                  )}
                </div>
                <div className={styles.viewer}>
                  {selectedFile ? (
                    <>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{selectedFile}</Text>
                      <div style={{ marginTop: 8 }}>
                        Download the ZIP to view file contents.
                      </div>
                      {selectedIsDoc && (
                        <Text size={100} style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}>
                          Markdown — preview in your editor after extracting the ZIP.
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text>Select a file from the tree.</Text>
                  )}
                </div>
              </div>
            )}

            {activeTab === "diagrams" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {result.diagrams.length === 0 && <Text>No diagrams emitted.</Text>}
                {result.diagrams.map((d, i) => (
                  <div key={i}>
                    <Text weight="semibold">{d.name}</Text>
                    <div className={styles.diagramBlock}>{d.mermaid}</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "verify" && (
              <div className={styles.viewer}>
                {result.verify == null && <Text>No verify result.</Text>}
                {result.verify && "skipped" in result.verify && (
                  <Text>Verify skipped — {result.verify.reason}</Text>
                )}
                {result.verify && "ok" in result.verify && (
                  <>
                    <Text>
                      az bicep build: {result.verify.ok ? "PASS" : "FAIL"}{" "}
                      {result.verify.ok ? (
                        <CheckmarkCircleFilled style={{ color: tokens.colorPaletteGreenForeground1, verticalAlign: "middle" }} />
                      ) : (
                        <DismissCircleRegular style={{ color: tokens.colorPaletteRedForeground1, verticalAlign: "middle" }} />
                      )}
                    </Text>
                    <div style={{ marginTop: 8 }}>{result.verify.output}</div>
                  </>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
