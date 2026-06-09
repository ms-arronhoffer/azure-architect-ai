import { useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Textarea,
  Text,
  Badge,
  Select,
  Switch,
  Spinner,
  Field,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from "@fluentui/react-components";
import {
  ClipboardTaskRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  ArrowUploadRegular,
  ArrowForwardRegular,
  SparkleRegular,
  AddRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import type { WorkloadSpec, Mode } from "../types";
import { apiPath } from "../config/api";

const COMPLIANCE_OPTIONS = [
  "HIPAA", "SOC 2", "PCI DSS", "ISO 27001", "FedRAMP", "GDPR", "NIST 800-53",
  "CIS Benchmarks", "Azure CIS", "HITRUST",
];

const REGION_OPTIONS = [
  "East US", "East US 2", "West US", "West US 2", "West US 3", "Central US",
  "North Central US", "South Central US", "West Central US",
  "North Europe", "West Europe", "UK South", "UK West", "France Central",
  "Germany West Central", "Switzerland North", "Norway East",
  "Southeast Asia", "East Asia", "Japan East", "Japan West",
  "Australia East", "Australia Southeast", "Korea Central",
  "Brazil South", "Canada Central", "Canada East",
  "UAE North", "South Africa North", "India Central",
];

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
  headerIcon: {
    color: "#0078D4",
    fontSize: "22px",
    display: "flex",
    alignItems: "center",
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
  completionBar: {
    marginTop: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  barTrack: {
    flex: 1,
    height: "6px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "3px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: "linear-gradient(90deg, #0078D4, #50E6FF)",
    borderRadius: "3px",
    transition: "width 0.3s ease",
  },
  completionLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#0078D4",
    minWidth: "32px",
    textAlign: "right",
  },
  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 28px",
  },
  accordion: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  section: {
    background: tokens.colorNeutralBackground1,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
  },
  sectionHeader: {
    padding: "0 16px",
    fontWeight: 600,
    fontSize: "13px",
  },
  sectionBody: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  row: {
    display: "flex",
    gap: "12px",
    "& > *": {
      flex: 1,
    },
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "6px",
  },
  chip: {
    cursor: "pointer",
    userSelect: "none",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "20px",
    padding: "3px 12px",
    fontSize: "12px",
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    transition: "all 0.12s",
    "&:hover": {
      background: "rgba(0,120,212,0.08)",
      border: "1px solid #0078D4",
    },
  },
  chipActive: {
    background: "rgba(0,120,212,0.12)",
    border: "1px solid #0078D4",
    color: "#0078D4",
    fontWeight: 600,
  },
  tagPill: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    background: "rgba(0,120,212,0.12)",
    border: `1px solid rgba(0,120,212,0.3)`,
    borderRadius: "20px",
    padding: "2px 8px 2px 10px",
    fontSize: "12px",
    color: "#0078D4",
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
  validationBox: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
});

function completion(spec: WorkloadSpec): number {
  const fields = [
    spec.name, spec.type, spec.criticality, spec.primaryRegion,
    spec.peakUsers > 0, spec.avgRps > 0, spec.latencyP99Ms > 0,
    spec.availabilitySla, spec.rtoHours > 0, spec.rpoHours > 0,
    spec.complianceFrameworks.length > 0 || spec.dataClassification,
    spec.identityModel, spec.monthlyBudgetUsd > 0, spec.teamSize,
    spec.cloudMaturity,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

function exportMarkdown(spec: WorkloadSpec): string {
  return `# Workload Requirements: ${spec.name || "Untitled"}

## Identity
- **Type:** ${spec.type}
- **Criticality:** ${spec.criticality}
- **Business Owner:** ${spec.businessOwner || "—"}

## Scale & Performance
- **Peak Users:** ${spec.peakUsers.toLocaleString()}
- **Average RPS:** ${spec.avgRps}
- **Data Volume:** ${spec.dataVolumeGb} GB
- **Latency Target (P99):** ${spec.latencyP99Ms} ms

## Reliability
- **Availability SLA:** ${spec.availabilitySla}%
- **RTO:** ${spec.rtoHours} hours
- **RPO:** ${spec.rpoHours} hours
- **Multi-Region:** ${spec.multiRegion ? "Yes" : "No"}
- **Primary Region:** ${spec.primaryRegion || "—"}
- **DR Region:** ${spec.drRegion || "—"}

## Security & Compliance
- **Compliance Frameworks:** ${spec.complianceFrameworks.join(", ") || "None"}
- **Data Classification:** ${spec.dataClassification}
- **Identity Model:** ${spec.identityModel}
- **Network Isolation:** ${spec.networkIsolation ? "Required" : "Not required"}

## Budget & Team
- **Monthly Budget:** $${spec.monthlyBudgetUsd.toLocaleString()}
- **Team Size:** ${spec.teamSize || "—"}
- **Cloud Maturity:** ${spec.cloudMaturity}

## Current State
- **Current Infrastructure:** ${spec.currentInfrastructure || "—"}
- **Existing Services:** ${spec.existingServices.join(", ") || "—"}
- **Integrations:** ${spec.integrations || "—"}

## Constraints
- **Migration Timeline:** ${spec.migrationTimeline || "—"}
- **Regulatory Notes:** ${spec.regulatoryNotes || "—"}
- **Additional Notes:** ${spec.additionalNotes || "—"}
`;
}

interface IntakePanelProps {
  onContinueIn?: (mode: Mode, seed: string) => void;
}

export default function IntakePanel({ onContinueIn }: IntakePanelProps) {
  const styles = useStyles();
  const { spec, setSpec, reset } = useWorkloadSpec();
  const [isValidating, setIsValidating] = useState(false);
  const [validationNotes, setValidationNotes] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [importFeedback, setImportFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const pct = completion(spec);

  async function handleValidate() {
    setIsValidating(true);
    setValidationNotes([]);
    try {
      const res = await fetch(apiPath("/api/intake/validate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      if (res.ok) {
        const data = await res.json();
        setValidationNotes(data.notes ?? []);
      }
    } catch {
      setValidationNotes(["Could not reach validation service."]);
    } finally {
      setIsValidating(false);
    }
  }

  function handleExportMd() {
    const md = exportMarkdown(spec);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name || "workload"}-requirements.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadTemplate() {
    const template = { "$schema": "azure-architect-ai/workload-spec/v1", ...spec };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name || "workload"}-requirements.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    importFileRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        // Strip schema metadata field before merging
        const { $schema: _schema, ...parsed } = raw as Record<string, unknown>;
        void _schema;
        setSpec(parsed as Partial<WorkloadSpec>);
        setImportFeedback({ ok: true, msg: "Requirements imported." });
        setTimeout(() => setImportFeedback(null), 3000);
      } catch {
        setImportFeedback({ ok: false, msg: "Invalid JSON — file not imported." });
        setTimeout(() => setImportFeedback(null), 4000);
      }
    };
    reader.readAsText(file);
  }

  function toggleCompliance(fw: string) {
    const next = spec.complianceFrameworks.includes(fw)
      ? spec.complianceFrameworks.filter((f) => f !== fw)
      : [...spec.complianceFrameworks, fw];
    setSpec({ complianceFrameworks: next });
  }

  function addService() {
    const s = newService.trim();
    if (!s || spec.existingServices.includes(s)) return;
    setSpec({ existingServices: [...spec.existingServices, s] });
    setNewService("");
  }

  function removeService(s: string) {
    setSpec({ existingServices: spec.existingServices.filter((x) => x !== s) });
  }

  function handleAnalyze() {
    if (!onContinueIn) return;
    const seed = toSpecPromptPrefix(spec) + "\nPlease analyze this workload comprehensively: architecture design, WAF assessment, sizing recommendations, and security posture.";
    onContinueIn("architecture", seed);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <span className={styles.headerIcon}><ClipboardTaskRegular /></span>
          <Text className={styles.title}>Requirements Studio</Text>
          {pct === 100 && <Badge appearance="filled" color="success" size="small">Complete</Badge>}
        </div>
        <Text className={styles.subtitle}>Capture workload requirements once — inject them into every mode automatically.</Text>
        <div className={styles.completionBar}>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
          <Text className={styles.completionLabel}>{pct}%</Text>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <Accordion multiple collapsible className={styles.accordion} defaultOpenItems={["identity"]}>

          {/* 1. Workload Identity */}
          <AccordionItem value="identity" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>1. Workload Identity</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <div className={styles.row}>
                <Field label="Workload Name">
                  <Input value={spec.name} onChange={(_, d) => setSpec({ name: d.value })} placeholder="e.g. Patient Portal" />
                </Field>
                <Field label="Business Owner">
                  <Input value={spec.businessOwner} onChange={(_, d) => setSpec({ businessOwner: d.value })} placeholder="e.g. Dr. Smith" />
                </Field>
              </div>
              <div className={styles.row}>
                <Field label="Workload Type">
                  <Select value={spec.type} onChange={(_, d) => setSpec({ type: d.value as WorkloadSpec["type"] })}>
                    <option value="web-app">Web Application</option>
                    <option value="microservices">Microservices</option>
                    <option value="data-pipeline">Data Pipeline</option>
                    <option value="ml">Machine Learning / AI</option>
                    <option value="event-driven">Event-Driven</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Criticality">
                  <Select value={spec.criticality} onChange={(_, d) => setSpec({ criticality: d.value as WorkloadSpec["criticality"] })}>
                    <option value="mission-critical">Mission Critical</option>
                    <option value="high">High</option>
                    <option value="standard">Standard</option>
                    <option value="dev-test">Dev / Test</option>
                  </Select>
                </Field>
              </div>
            </AccordionPanel>
          </AccordionItem>

          {/* 2. Scale & Performance */}
          <AccordionItem value="scale" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>2. Scale & Performance</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <div className={styles.row}>
                <Field label="Peak Concurrent Users">
                  <Input type="number" value={String(spec.peakUsers)} onChange={(_, d) => setSpec({ peakUsers: Number(d.value) })} />
                </Field>
                <Field label="Average RPS">
                  <Input type="number" value={String(spec.avgRps)} onChange={(_, d) => setSpec({ avgRps: Number(d.value) })} />
                </Field>
              </div>
              <div className={styles.row}>
                <Field label="Data Volume (GB)">
                  <Input type="number" value={String(spec.dataVolumeGb)} onChange={(_, d) => setSpec({ dataVolumeGb: Number(d.value) })} />
                </Field>
                <Field label="Latency Target P99 (ms)">
                  <Input type="number" value={String(spec.latencyP99Ms)} onChange={(_, d) => setSpec({ latencyP99Ms: Number(d.value) })} />
                </Field>
              </div>
            </AccordionPanel>
          </AccordionItem>

          {/* 3. Reliability */}
          <AccordionItem value="reliability" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>3. Reliability</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <div className={styles.row}>
                <Field label="Availability SLA">
                  <Select value={spec.availabilitySla} onChange={(_, d) => setSpec({ availabilitySla: d.value as WorkloadSpec["availabilitySla"] })}>
                    <option value="99.9">99.9% (8.7 hrs/yr downtime)</option>
                    <option value="99.95">99.95% (4.4 hrs/yr)</option>
                    <option value="99.99">99.99% (52 min/yr)</option>
                  </Select>
                </Field>
                <Field label="RTO (hours)">
                  <Input type="number" value={String(spec.rtoHours)} onChange={(_, d) => setSpec({ rtoHours: Number(d.value) })} />
                </Field>
                <Field label="RPO (hours)">
                  <Input type="number" value={String(spec.rpoHours)} onChange={(_, d) => setSpec({ rpoHours: Number(d.value) })} />
                </Field>
              </div>
              <div className={styles.row}>
                <Field label="Primary Region">
                  <Select value={spec.primaryRegion} onChange={(_, d) => setSpec({ primaryRegion: d.value })}>
                    <option value="">Select region…</option>
                    {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
                <Field label="DR Region (optional)">
                  <Select value={spec.drRegion} onChange={(_, d) => setSpec({ drRegion: d.value })}>
                    <option value="">None</option>
                    {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Multi-Region Active-Active">
                <Switch checked={spec.multiRegion} onChange={(_, d) => setSpec({ multiRegion: d.checked })} label={spec.multiRegion ? "Enabled" : "Disabled"} />
              </Field>
            </AccordionPanel>
          </AccordionItem>

          {/* 4. Security & Compliance */}
          <AccordionItem value="security" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>4. Security & Compliance</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <Field label="Compliance Frameworks">
                <div className={styles.chipRow}>
                  {COMPLIANCE_OPTIONS.map((fw) => (
                    <span
                      key={fw}
                      className={`${styles.chip} ${spec.complianceFrameworks.includes(fw) ? styles.chipActive : ""}`}
                      onClick={() => toggleCompliance(fw)}
                    >
                      {fw}
                    </span>
                  ))}
                </div>
              </Field>
              <div className={styles.row}>
                <Field label="Data Classification">
                  <Select value={spec.dataClassification} onChange={(_, d) => setSpec({ dataClassification: d.value as WorkloadSpec["dataClassification"] })}>
                    <option value="public">Public</option>
                    <option value="internal">Internal</option>
                    <option value="confidential">Confidential</option>
                    <option value="restricted">Restricted / PHI / PII</option>
                  </Select>
                </Field>
                <Field label="Identity Model">
                  <Select value={spec.identityModel} onChange={(_, d) => setSpec({ identityModel: d.value as WorkloadSpec["identityModel"] })}>
                    <option value="workforce">Workforce (Entra ID)</option>
                    <option value="b2c">Customer (B2C)</option>
                    <option value="both">Both</option>
                    <option value="service-to-service">Service-to-Service only</option>
                  </Select>
                </Field>
              </div>
              <Field label="Network Isolation Required (Private Endpoints / VNet)">
                <Switch checked={spec.networkIsolation} onChange={(_, d) => setSpec({ networkIsolation: d.checked })} label={spec.networkIsolation ? "Yes" : "No"} />
              </Field>
            </AccordionPanel>
          </AccordionItem>

          {/* 5. Budget & Team */}
          <AccordionItem value="budget" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>5. Budget & Team</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <div className={styles.row}>
                <Field label="Monthly Budget (USD)">
                  <Input type="number" value={String(spec.monthlyBudgetUsd)} onChange={(_, d) => setSpec({ monthlyBudgetUsd: Number(d.value) })} contentBefore={<span>$</span>} />
                </Field>
                <Field label="Team Size">
                  <Input value={spec.teamSize} onChange={(_, d) => setSpec({ teamSize: d.value })} placeholder="e.g. 8 engineers, 2 DevOps" />
                </Field>
              </div>
              <Field label="Cloud Maturity">
                <Select value={spec.cloudMaturity} onChange={(_, d) => setSpec({ cloudMaturity: d.value as WorkloadSpec["cloudMaturity"] })}>
                  <option value="greenfield">Greenfield — new workload, no migration</option>
                  <option value="migrating">Migrating — lift & shift from on-prem</option>
                  <option value="modernizing">Modernizing — re-architect existing app</option>
                  <option value="optimizing">Optimizing — already on Azure, improving</option>
                </Select>
              </Field>
            </AccordionPanel>
          </AccordionItem>

          {/* 6. Current State */}
          <AccordionItem value="current" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>6. Current State</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <Field label="Current Infrastructure">
                <Input value={spec.currentInfrastructure} onChange={(_, d) => setSpec({ currentInfrastructure: d.value })} placeholder="e.g. On-prem VMware, AWS, existing Azure subscription" />
              </Field>
              <Field label="Existing Azure Services">
                <div style={{ display: "flex", gap: "6px" }}>
                  <Input
                    value={newService}
                    onChange={(_, d) => setNewService(d.value)}
                    onKeyDown={(e) => e.key === "Enter" && addService()}
                    placeholder="Type service name and press Enter…"
                    style={{ flex: 1 }}
                  />
                  <Button icon={<AddRegular />} onClick={addService} appearance="subtle" />
                </div>
                {spec.existingServices.length > 0 && (
                  <div className={styles.chipRow}>
                    {spec.existingServices.map((s) => (
                      <span key={s} className={styles.tagPill}>
                        {s}
                        <Button size="small" appearance="transparent" icon={<DismissRegular />} onClick={() => removeService(s)} style={{ minWidth: 0, padding: "0 2px", height: "16px" }} />
                      </span>
                    ))}
                  </div>
                )}
              </Field>
              <Field label="External Integrations">
                <Textarea value={spec.integrations} onChange={(_, d) => setSpec({ integrations: d.value })} placeholder="e.g. Salesforce CRM, SAP ERP, third-party payment API" rows={2} />
              </Field>
            </AccordionPanel>
          </AccordionItem>

          {/* 7. Constraints */}
          <AccordionItem value="constraints" className={styles.section}>
            <AccordionHeader className={styles.sectionHeader}>7. Constraints & Notes</AccordionHeader>
            <AccordionPanel className={styles.sectionBody}>
              <Field label="Migration Timeline">
                <Input value={spec.migrationTimeline} onChange={(_, d) => setSpec({ migrationTimeline: d.value })} placeholder="e.g. Go-live by Q3 2025" />
              </Field>
              <Field label="Regulatory Notes">
                <Textarea value={spec.regulatoryNotes} onChange={(_, d) => setSpec({ regulatoryNotes: d.value })} placeholder="Any specific regulatory or legal constraints…" rows={2} />
              </Field>
              <Field label="Additional Notes">
                <Textarea value={spec.additionalNotes} onChange={(_, d) => setSpec({ additionalNotes: d.value })} placeholder="Anything else the architect should know…" rows={3} />
              </Field>
            </AccordionPanel>
          </AccordionItem>

        </Accordion>
      </div>

      <div className={styles.footer}>
        <div className={styles.validationBox}>
          {validationNotes.length > 0 && validationNotes.map((n, i) => (
            <Text key={i} size={200} style={{ color: tokens.colorStatusWarningForeground1 }}>⚠ {n}</Text>
          ))}
        </div>
        <Button
          appearance="subtle"
          icon={isValidating ? <Spinner size="tiny" /> : <SparkleRegular />}
          onClick={handleValidate}
          disabled={isValidating || !spec.name}
          title="AI checks for contradictions and gaps"
        >
          Validate
        </Button>
        <Button appearance="subtle" icon={<DocumentRegular />} onClick={handleExportMd} disabled={!spec.name}>
          Export .md
        </Button>
        <Button appearance="subtle" icon={<ArrowDownloadRegular />} onClick={handleDownloadTemplate}>
          Download Template
        </Button>
        <Button appearance="subtle" icon={<ArrowUploadRegular />} onClick={handleImportClick}>
          Import JSON
        </Button>
        {importFeedback && (
          <Text size={200} style={{ color: importFeedback.ok ? tokens.colorStatusSuccessForeground1 : tokens.colorStatusDangerForeground1 }}>
            {importFeedback.msg}
          </Text>
        )}
        <input ref={importFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
        <Button
          appearance="primary"
          icon={<ArrowForwardRegular />}
          onClick={handleAnalyze}
          disabled={pct < 40 || !onContinueIn}
          title="Sends this workload spec to Architecture Design for full analysis"
        >
          Analyze Workload
        </Button>
        <Button
          appearance="outline"
          icon={<ArrowForwardRegular />}
          onClick={() => onContinueIn && onContinueIn("strategy", "")}
          disabled={!spec.name || !onContinueIn}
          title="Open Strategy Builder pre-populated from this spec"
        >
          Continue in Strategy
        </Button>
        <Button
          appearance="outline"
          icon={<ArrowForwardRegular />}
          onClick={() => onContinueIn && onContinueIn("bootstrap", "")}
          disabled={!spec.name || !onContinueIn}
          title="Open Bootstrap Wizard pre-populated from this spec"
        >
          Continue in Bootstrap
        </Button>
        <Button appearance="subtle" onClick={reset} style={{ marginLeft: "auto" }}>Reset</Button>
      </div>
    </div>
  );
}
