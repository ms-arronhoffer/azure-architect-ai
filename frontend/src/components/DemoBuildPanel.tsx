import { useState, useRef, useEffect, useMemo } from "react";
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
} from "@fluentui/react-components";
import {
  PlayRegular,
  StopRegular,
  RocketRegular,
  ArrowDownloadRegular,
  DocumentRegular,
} from "@fluentui/react-icons";
import { apiFetch, apiPath } from "../config/api";
import type { DemoBuilt, DemoFileManifestEntry } from "../types";
import { useWorkloadSpec } from "../hooks/useWorkloadSpec";
import {
  hashDemoRequest,
  loadDemoState,
  saveDemoState,
  clearDemoState,
  newDemoState,
  type DemoPhase,
  type DemoPhaseEvent,
  type DemoPipelineRequestShape,
  type DemoPipelineState,
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
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  header: {
    padding: "20px 28px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  body: {
    flex: 1,
    overflow: "auto",
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

type PhaseStatus = "pending" | "started" | "complete" | "skipped" | "failed";

function statusBadge(status: PhaseStatus, reason?: string, error?: string) {
  switch (status) {
    case "complete":
      return <Badge appearance="filled" color="success">complete</Badge>;
    case "skipped":
      return <Badge appearance="tint" color="warning">skipped{reason ? ` · ${reason}` : ""}</Badge>;
    case "failed":
      return <Badge appearance="tint" color="danger">failed{error ? ` · ${error}` : ""}</Badge>;
    case "started":
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

interface FileMapState {
  // path -> content (only populated during a live run; final ZIP is server-side)
  [path: string]: string;
}

export default function DemoBuildPanel() {
  const styles = useStyles();
  const { spec } = useWorkloadSpec();
  const initialSlug = useMemo(() => slugify(spec.name || "my-azure-demo"), [spec.name]);

  const [demoSlug, setDemoSlug] = useState(initialSlug);
  const [demoTitle, setDemoTitle] = useState(spec.name || "My Azure Demo");
  const [audience, setAudience] = useState<"customer" | "internal" | "partner">("customer");
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [targetPersona, setTargetPersona] = useState("platform engineer");
  const [keyFeaturesText, setKeyFeaturesText] = useState("streaming, managed identity");
  const [azureServicesText, setAzureServicesText] = useState("Azure OpenAI, App Service");
  const [publish, setPublish] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<DemoPhaseEvent[]>([]);
  const [result, setResult] = useState<DemoBuilt | null>(null);
  const [files, setFiles] = useState<FileMapState>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"readme" | "files" | "diagrams" | "verify">("readme");
  const [resumable, setResumable] = useState<DemoPipelineState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const keyFeatures = useMemo(
    () => keyFeaturesText.split(",").map((s) => s.trim()).filter(Boolean),
    [keyFeaturesText],
  );
  const azureServices = useMemo(
    () => azureServicesText.split(",").map((s) => s.trim()).filter(Boolean),
    [azureServicesText],
  );

  const reqShape: DemoPipelineRequestShape = useMemo(
    () => ({
      demo_slug: demoSlug,
      demo_title: demoTitle,
      audience,
      duration_minutes: durationMinutes,
      target_persona: targetPersona,
      key_features: keyFeatures,
      azure_services: azureServices,
    }),
    [demoSlug, demoTitle, audience, durationMinutes, targetPersona, keyFeatures, azureServices],
  );

  useEffect(() => {
    const state = loadDemoState();
    if (!state) {
      setResumable(null);
      return;
    }
    if (state.request_hash === hashDemoRequest(reqShape)) {
      setResumable(state);
    } else {
      setResumable(null);
    }
  }, [reqShape]);

  function phaseStatus(phase: DemoPhase): { status: PhaseStatus; reason?: string; error?: string } {
    let current: PhaseStatus = "pending";
    let reason: string | undefined;
    let error: string | undefined;
    for (const ev of events) {
      if (ev.phase !== phase) continue;
      current = ev.type;
      reason = ev.reason;
      error = ev.error;
    }
    return { status: current, reason, error };
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }

  async function handleRun() {
    if (!demoSlug || !demoTitle) return;
    setIsRunning(true);
    setEvents([]);
    setResult(null);
    setFiles({});
    setSelectedFile(null);
    clearDemoState();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const hash = hashDemoRequest(reqShape);
    let state = newDemoState(hash);
    saveDemoState(state);

    const body = {
      spec,
      demo_slug: demoSlug,
      demo_title: demoTitle,
      audience,
      duration_minutes: durationMinutes,
      target_persona: targetPersona,
      key_features: keyFeatures,
      azure_services: azureServices,
      publish,
    };

    try {
      const res = await apiFetch("/api/demo/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
            const t = obj.type as string | undefined;
            if (typeof t === "string" && t.startsWith("phase_")) {
              const phase = obj.phase as DemoPhase | undefined;
              if (!phase) continue;
              const eventType = t.replace("phase_", "") as DemoPhaseEvent["type"];
              const ev: DemoPhaseEvent = {
                phase,
                type: eventType,
                reason: obj.reason,
                error: obj.error,
                extra: obj.extra,
              };
              setEvents((prev) => {
                const next = [...prev, ev];
                state = { ...state, events: next };
                saveDemoState(state);
                return next;
              });
            } else if (t === "demo_built") {
              const payload = obj as DemoBuilt;
              setResult(payload);
              state = { ...state, result: payload };
              saveDemoState(state);
              // Build a placeholder filemap from the manifest (paths only).
              // Content is fetched lazily via the ZIP endpoint — for inline
              // preview we just show the path until the user downloads.
              setFiles(
                Object.fromEntries(
                  payload.manifest.map((m) => [m.path, `(${m.size} bytes · ${m.kind})`]),
                ),
              );
              if (payload.manifest.length > 0) setSelectedFile(payload.manifest[0].path);
            } else if (t === "done") {
              setIsRunning(false);
            }
          } catch {
            // ignore parse errors on partial lines
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("demo pipeline error", err);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }

  function handleResume() {
    if (!resumable) return;
    setEvents(resumable.events);
    setResult(resumable.result);
    if (resumable.result) {
      setFiles(
        Object.fromEntries(
          resumable.result.manifest.map((m) => [m.path, `(${m.size} bytes · ${m.kind})`]),
        ),
      );
      if (resumable.result.manifest.length > 0) {
        setSelectedFile(resumable.result.manifest[0].path);
      }
    }
    setResumable(null);
  }

  function handleDiscardResume() {
    clearDemoState();
    setResumable(null);
  }

  function handleDownloadZip() {
    if (!result?.job_id) return;
    const url = apiPath(`/api/demo/${result.job_id}/zip`);
    // Trigger a download via anchor — apiFetch isn't needed, the browser
    // attaches the auth cookie/header automatically only for fetch. For SPA
    // bearer auth, open in a new tab where the user is already authenticated;
    // for cookie-based auth, this works directly.
    window.open(url, "_blank");
  }

  const filesByKind = useMemo(() => {
    const groups: Record<string, DemoFileManifestEntry[]> = { code: [], infra: [], docs: [], config: [] };
    if (result) {
      for (const entry of result.manifest) {
        (groups[entry.kind] ?? groups.code).push(entry);
      }
    }
    return groups;
  }, [result]);

  const selectedContent = selectedFile ? files[selectedFile] : null;
  const selectedIsDoc = selectedFile?.endsWith(".md");

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">Demo Builder</Text>
        <Text size={200}>
          6-phase pipeline: intake → recommendations → architecture design → parallel build (code / infra / docs) → verify → publish. Produces a clone-and-run Azure demo.
        </Text>
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
            <Button appearance="secondary" icon={<StopRegular />} onClick={handleStop}>Stop</Button>
          ) : (
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={handleRun}
              disabled={!demoSlug || !demoTitle}
            >
              Run
            </Button>
          )}
          {isRunning && <Spinner size="tiny" />}
          <Tooltip
            content="Requires DEMO_FACTORY_PUBLISH=true and GITHUB_TOKEN on the backend. Publishes to the configured org (default ms-arronhoffer)."
            relationship="label"
          >
            <Switch
              checked={publish}
              onChange={(_, d) => setPublish(d.checked)}
              label="Publish to GitHub"
            />
          </Tooltip>
          {result?.job_id && !isRunning && (
            <Button appearance="secondary" icon={<ArrowDownloadRegular />} onClick={handleDownloadZip}>
              Download ZIP
            </Button>
          )}
          {result?.repo_url && (
            <Button appearance="subtle" icon={<RocketRegular />} as="a" {...{ href: result.repo_url, target: "_blank", rel: "noreferrer" }}>
              Open repo
            </Button>
          )}
        </div>
        {resumable && !isRunning && (
          <div className={styles.controls}>
            <Text size={200}>Previous run available.</Text>
            <Button size="small" onClick={handleResume}>Resume</Button>
            <Button size="small" appearance="subtle" onClick={handleDiscardResume}>Discard</Button>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <Card className={styles.card}>
          <Text weight="semibold">Phases</Text>
          <div className={styles.timeline}>
            {PHASE_ORDER.map((phase) => {
              const { status, reason, error } = phaseStatus(phase);
              const rows = [
                <div key={phase} className={styles.phaseRow}>
                  <RocketRegular />
                  <Text weight="semibold" style={{ minWidth: "180px" }}>{PHASE_LABELS[phase]}</Text>
                  {statusBadge(status, reason, error)}
                </div>,
              ];
              if (phase === "build") {
                for (const child of BUILD_LANES) {
                  const cs = phaseStatus(child);
                  rows.push(
                    <div key={child} className={`${styles.phaseRow} ${styles.phaseRowChild}`}>
                      <DocumentRegular />
                      <Text style={{ minWidth: "160px" }}>{PHASE_LABELS[child]}</Text>
                      {statusBadge(cs.status, cs.reason, cs.error)}
                    </div>,
                  );
                }
              }
              return rows;
            })}
          </div>
        </Card>

        {result && (
          <Card className={styles.card}>
            <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as typeof activeTab)}>
              <Tab value="readme">Readme</Tab>
              <Tab value="files">Files ({result.manifest.length})</Tab>
              <Tab value="diagrams">Diagrams ({result.diagrams.length})</Tab>
              <Tab value="verify">Verify</Tab>
            </TabList>

            {activeTab === "readme" && (
              <div className={styles.viewer}>
                {result.readme_md ? (
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
                    {result.readme_md}
                  </pre>
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
                        {selectedContent ?? "Download the ZIP to view file contents."}
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
                    <Text>az bicep build: {result.verify.ok ? "PASS" : "FAIL"}</Text>
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
