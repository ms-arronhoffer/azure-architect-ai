import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Field,
  Input,
  Textarea,
  Select,
  Badge,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  ProgressBar,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
} from "@fluentui/react-components";
import {
  ArrowRightRegular,
  ArrowLeftRegular,
  ArrowDownloadRegular,
  RocketRegular,
  ChatRegular,
} from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import { useWorkloadSpec } from "../hooks/useWorkloadSpec";
import { specToBootstrapState } from "../utils/specMappers";
import { downloadBootstrapZip } from "../utils/zipExport";
import type { SseEvent, BootstrapOutputs, ChatMessage } from "../types";

const AZURE_REGIONS = [
  "East US", "East US 2", "West US", "West US 2", "West US 3",
  "Central US", "North Central US", "South Central US",
  "North Europe", "West Europe", "UK South",
  "Southeast Asia", "East Asia", "Japan East",
  "Australia East", "Canada Central", "Brazil South",
];

const WORKLOAD_TYPES = [
  "Web App", "Microservices", "Data Pipeline", "Event-Driven", "Machine Learning", "Other",
];

const COMPLIANCE_OPTIONS = ["None", "HIPAA", "PCI-DSS", "SOC 2", "FedRAMP", "GDPR", "ISO 27001"];
const SLA_OPTIONS = ["99.9%", "99.95%", "99.99%"];
const BUDGET_OPTIONS = ["< $1k/mo", "$1k–5k/mo", "$5k–20k/mo", "$20k–100k/mo", "> $100k/mo"];
const IDENTITY_OPTIONS = ["Entra ID (workforce)", "Entra External ID (B2C)", "Both", "None"];

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
  },
  stepContainer: {
    maxWidth: "640px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  stepHeader: {
    marginBottom: "4px",
  },
  progressSection: {
    marginBottom: "8px",
  },
  stepLabels: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "6px",
  },
  actions: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    marginTop: "8px",
  },
  resultsHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "16px",
  },
  prose: {
    "& p": { margin: "6px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": {
      background: tokens.colorNeutralBackground3,
      padding: "10px",
      borderRadius: "4px",
      overflowX: "auto",
      fontSize: "13px",
    },
    "& code": { fontFamily: "monospace" },
    "& ul, & ol": { paddingLeft: "20px" },
  },
});

const STEP_LABELS = ["Workload", "Scale & Region", "Security", "Budget"];

export default function BootstrapPanel({ onRefine }: { onRefine?: (context: ChatMessage[]) => void }) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();
  const { spec } = useWorkloadSpec();

  const [step, setStep] = useState(0);

  // Step 0
  const [workloadName, setWorkloadName] = useState("");
  const [workloadType, setWorkloadType] = useState("Web App");
  const [workloadDescription, setWorkloadDescription] = useState("");

  // Step 1
  const [usersPerDay, setUsersPerDay] = useState("");
  const [dataVolume, setDataVolume] = useState("");
  const [primaryRegion, setPrimaryRegion] = useState("East US");
  const [drRegion, setDrRegion] = useState("");

  // Step 2
  const [compliance, setCompliance] = useState("None");
  const [identity, setIdentity] = useState("Entra ID (workforce)");
  const [networkIsolation, setNetworkIsolation] = useState(false);

  // Step 3
  const [budget, setBudget] = useState("$5k–20k/mo");
  const [sla, setSla] = useState("99.9%");
  const [includeDr, setIncludeDr] = useState(false);

  const [loadedFromSpec, setLoadedFromSpec] = useState(false);
  const autofillAppliedRef = useRef(false);

  useEffect(() => {
    if (autofillAppliedRef.current) return;
    if (!spec.name) return;
    const pristine = !workloadName && !workloadDescription && !usersPerDay && !dataVolume;
    if (!pristine) return;
    autofillAppliedRef.current = true;
    const mapped = specToBootstrapState(spec);
    if (mapped.workloadName !== undefined) setWorkloadName(mapped.workloadName);
    if (mapped.workloadType !== undefined) setWorkloadType(mapped.workloadType);
    if (mapped.workloadDescription !== undefined) setWorkloadDescription(mapped.workloadDescription);
    if (mapped.usersPerDay !== undefined) setUsersPerDay(mapped.usersPerDay);
    if (mapped.dataVolume !== undefined) setDataVolume(mapped.dataVolume);
    if (mapped.primaryRegion !== undefined) setPrimaryRegion(mapped.primaryRegion);
    if (mapped.drRegion !== undefined) setDrRegion(mapped.drRegion);
    if (mapped.compliance !== undefined) setCompliance(mapped.compliance);
    if (mapped.identity !== undefined) setIdentity(mapped.identity);
    if (mapped.networkIsolation !== undefined) setNetworkIsolation(mapped.networkIsolation);
    if (mapped.budget !== undefined) setBudget(mapped.budget);
    if (mapped.sla !== undefined) setSla(mapped.sla);
    if (mapped.includeDr !== undefined) setIncludeDr(mapped.includeDr);
    setLoadedFromSpec(true);
  }, [spec.name]);

  function handleClearAutofill() {
    setWorkloadName("");
    setWorkloadType("Web App");
    setWorkloadDescription("");
    setUsersPerDay("");
    setDataVolume("");
    setPrimaryRegion("East US");
    setDrRegion("");
    setCompliance("None");
    setIdentity("Entra ID (workforce)");
    setNetworkIsolation(false);
    setBudget("$5k–20k/mo");
    setSla("99.9%");
    setIncludeDr(false);
    setLoadedFromSpec(false);
    autofillAppliedRef.current = true;
  }

  // Results
  const [outputs, setOutputs] = useState<BootstrapOutputs>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  function buildRequirements(): string {
    const lines: string[] = [
      `Workload Name: ${workloadName || "My Workload"}`,
      `Type: ${workloadType}`,
      `Description: ${workloadDescription}`,
      `Expected Scale: ${usersPerDay ? `${usersPerDay} users/day` : "unknown"}, Data: ${dataVolume || "unknown"}`,
      `Primary Region: ${primaryRegion}`,
      drRegion ? `DR Region: ${drRegion}` : "",
      `Compliance: ${compliance}`,
      `Identity: ${identity}`,
      `Network Isolation: ${networkIsolation ? "Yes (private endpoints, VNet integration)" : "No"}`,
      `Monthly Budget: ${budget}`,
      `Target SLA: ${sla}`,
      includeDr ? "Include disaster recovery configuration" : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  async function handleGenerate() {
    setOutputs({});
    setIsComplete(false);
    setStatusMsg("");

    const requirements = buildRequirements();
    const collected: BootstrapOutputs = {};

    await stream(
      "/api/architecture",
      {
        requirements,
        mode: "architecture",
        include_components: ["diagram", "runbook", "bicep", "cost"],
      },
      (event: SseEvent) => {
        if (event.type === "token") setOutputs((o) => ({ ...o, explanation: (o.explanation ?? "") + event.content }));
        if (event.type === "status") setStatusMsg(event.message);
        if (event.type === "diagram") { collected.diagramXml = event.xml; setOutputs((o) => ({ ...o, diagramXml: event.xml })); }
        if (event.type === "runbook") { collected.runbookMarkdown = event.markdown; setOutputs((o) => ({ ...o, runbookMarkdown: event.markdown })); }
        if (event.type === "bicep") {
          collected.bicepCode = event.code;
          collected.paramFile = event.param_file;
          setOutputs((o) => ({ ...o, bicepCode: event.code, paramFile: event.param_file }));
        }
        if (event.type === "cost_estimate") {
          const summary = `## Cost Estimate\n\nTotal: $${event.estimate.total_monthly_estimate.toLocaleString()}/mo\n\n${event.estimate.line_items.map((i) => `- ${i.service}: $${i.monthly_estimate ?? 0}/mo`).join("\n")}`;
          collected.costSummary = summary;
          setOutputs((o) => ({ ...o, costSummary: summary }));
        }
      }
    );
    setStatusMsg("");
    setIsComplete(true);
  }

  async function handleDownload() {
    await downloadBootstrapZip(workloadName || "bootstrap", outputs);
  }

  function handleRefine() {
    if (!onRefine) return;
    const parts: string[] = [];
    if (outputs.explanation) parts.push(`## Architecture Overview\n\n${outputs.explanation}`);
    if (outputs.costSummary) parts.push(outputs.costSummary);
    if (outputs.runbookMarkdown) parts.push(`## Runbook\n\n${outputs.runbookMarkdown}`);
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: parts.join("\n\n") }]);
  }

  const canDownload = isComplete && (outputs.bicepCode || outputs.explanation);

  return (
    <div className={styles.panel}>
      <div className={styles.scrollArea}>
        <div className={styles.stepContainer}>
          <div className={styles.stepHeader}>
            <Text weight="semibold" size={500} block style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <RocketRegular /> Greenfield Bootstrapper
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Answer 4 quick questions and get a full Azure architecture with Bicep IaC, runbook, and cost estimate.
            </Text>
          </div>

          {/* Progress */}
          {!isStreaming && !isComplete && (
            <div className={styles.progressSection}>
              <div className={styles.stepLabels}>
                {STEP_LABELS.map((label, i) => (
                  <Text key={label} size={200} weight={i === step ? "semibold" : "regular"} style={{ color: i === step ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3 }}>
                    {i + 1}. {label}
                  </Text>
                ))}
              </div>
              <ProgressBar value={(step) / (STEP_LABELS.length)} />
            </div>
          )}

          {/* Step 0: Workload */}
          {step === 0 && !isStreaming && !isComplete && (
            <>
              {loadedFromSpec && (
                <MessageBar intent="info">
                  <MessageBarBody>Loaded from Requirements Studio.</MessageBarBody>
                  <MessageBarActions>
                    <Button size="small" appearance="transparent" onClick={handleClearAutofill}>Clear</Button>
                  </MessageBarActions>
                </MessageBar>
              )}
              <Field label="Workload Name" required>
                <Input value={workloadName} onChange={(_, d) => setWorkloadName(d.value)} placeholder="e.g. Customer Portal" />
              </Field>
              <Field label="Workload Type">
                <Select value={workloadType} onChange={(_, d) => setWorkloadType(d.value)}>
                  {WORKLOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Description" required hint="Describe what this system does, who uses it, and key integrations">
                <Textarea rows={5} value={workloadDescription} onChange={(_, d) => setWorkloadDescription(d.value)} placeholder="e.g. Multi-tenant SaaS customer portal for healthcare clients. Users upload lab results, view reports, and communicate with care teams…" />
              </Field>
              <div className={styles.actions}>
                <Button appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep(1)} disabled={!workloadDescription.trim()}>
                  Next
                </Button>
              </div>
            </>
          )}

          {/* Step 1: Scale & Region */}
          {step === 1 && !isStreaming && !isComplete && (
            <>
              <Field label="Expected Users / Requests per Day" hint='e.g. "10,000 users" or "1M requests"'>
                <Input value={usersPerDay} onChange={(_, d) => setUsersPerDay(d.value)} placeholder="e.g. 50,000 users/day" />
              </Field>
              <Field label="Data Volume" hint='e.g. "500 GB", "10 TB/month"'>
                <Input value={dataVolume} onChange={(_, d) => setDataVolume(d.value)} placeholder="e.g. 1 TB stored, 50 GB/day ingest" />
              </Field>
              <Field label="Primary Azure Region">
                <Select value={primaryRegion} onChange={(_, d) => setPrimaryRegion(d.value)}>
                  {AZURE_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Disaster Recovery Region (optional)">
                <Select value={drRegion} onChange={(_, d) => setDrRegion(d.value)}>
                  <option value="">— None —</option>
                  {AZURE_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <div className={styles.actions}>
                <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setStep(0)}>Back</Button>
                <Button appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep(2)}>Next</Button>
              </div>
            </>
          )}

          {/* Step 2: Compliance & Security */}
          {step === 2 && !isStreaming && !isComplete && (
            <>
              <Field label="Compliance Framework">
                <Select value={compliance} onChange={(_, d) => setCompliance(d.value)}>
                  {COMPLIANCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Identity Provider">
                <Select value={identity} onChange={(_, d) => setIdentity(d.value)}>
                  {IDENTITY_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </Select>
              </Field>
              <Field label="Network Isolation">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                  <input type="checkbox" id="netiso" checked={networkIsolation} onChange={(e) => setNetworkIsolation(e.target.checked)} />
                  <label htmlFor="netiso" style={{ fontSize: "14px", cursor: "pointer" }}>
                    Enable private endpoints and VNet integration
                  </label>
                </div>
              </Field>
              <div className={styles.actions}>
                <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setStep(1)}>Back</Button>
                <Button appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep(3)}>Next</Button>
              </div>
            </>
          )}

          {/* Step 3: Budget & Resilience */}
          {step === 3 && !isStreaming && !isComplete && (
            <>
              <Field label="Monthly Budget Range">
                <Select value={budget} onChange={(_, d) => setBudget(d.value)}>
                  {BUDGET_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Uptime SLA Target">
                <Select value={sla} onChange={(_, d) => setSla(d.value)}>
                  {SLA_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Disaster Recovery">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                  <input type="checkbox" id="includedr" checked={includeDr} onChange={(e) => setIncludeDr(e.target.checked)} />
                  <label htmlFor="includedr" style={{ fontSize: "14px", cursor: "pointer" }}>Include full DR configuration</label>
                </div>
              </Field>
              <div className={styles.actions}>
                <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setStep(2)}>Back</Button>
                <Button appearance="primary" icon={<RocketRegular />} onClick={handleGenerate}>
                  Generate Architecture
                </Button>
              </div>
            </>
          )}

          {/* Streaming progress */}
          {isStreaming && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", padding: "32px 0" }}>
              <Spinner size="large" />
              {statusMsg && <Text style={{ color: tokens.colorBrandForeground1 }}>{statusMsg}</Text>}
              <Button appearance="outline" onClick={cancel}>Stop</Button>
            </div>
          )}

          {/* Results */}
          {isComplete && (
            <div>
              <div className={styles.resultsHeader}>
                <Badge appearance="filled" color="success" size="large">
                  {workloadName || "Bootstrap"} Ready
                </Badge>
                {canDownload && (
                  <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={handleDownload}>
                    Download ZIP
                  </Button>
                )}
                {onRefine && outputs.explanation && (
                  <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
                    Refine in Chat
                  </Button>
                )}
                <Button appearance="subtle" onClick={() => { setIsComplete(false); setStep(0); setOutputs({}); }}>
                  Start Over
                </Button>
              </div>

              <Accordion multiple defaultOpenItems={["explanation"]}>
                {outputs.explanation && (
                  <AccordionItem value="explanation">
                    <AccordionHeader>Architecture Overview</AccordionHeader>
                    <AccordionPanel>
                      <div className={styles.prose}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{outputs.explanation}</ReactMarkdown>
                      </div>
                    </AccordionPanel>
                  </AccordionItem>
                )}
                {outputs.bicepCode && (
                  <AccordionItem value="bicep">
                    <AccordionHeader>IaC / Bicep</AccordionHeader>
                    <AccordionPanel>
                      <div className={styles.prose}>
                        <pre><code>{outputs.bicepCode}</code></pre>
                        {outputs.paramFile && (
                          <>
                            <Text weight="semibold" size={300} block style={{ margin: "12px 0 4px" }}>main.bicepparam</Text>
                            <pre><code>{outputs.paramFile}</code></pre>
                          </>
                        )}
                      </div>
                    </AccordionPanel>
                  </AccordionItem>
                )}
                {outputs.runbookMarkdown && (
                  <AccordionItem value="runbook">
                    <AccordionHeader>Runbook</AccordionHeader>
                    <AccordionPanel>
                      <div className={styles.prose}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{outputs.runbookMarkdown}</ReactMarkdown>
                      </div>
                    </AccordionPanel>
                  </AccordionItem>
                )}
                {outputs.costSummary && (
                  <AccordionItem value="cost">
                    <AccordionHeader>Cost Estimate</AccordionHeader>
                    <AccordionPanel>
                      <div className={styles.prose}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{outputs.costSummary}</ReactMarkdown>
                      </div>
                    </AccordionPanel>
                  </AccordionItem>
                )}
              </Accordion>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
