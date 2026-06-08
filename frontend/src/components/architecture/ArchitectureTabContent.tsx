import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Badge,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogTrigger,
  Link,
  Checkbox,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  OpenRegular,
  EditRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import { lookupService } from "../../utils/serviceMetadata";
import type { BicepResult, CostEstimate, AdrRecord, NetworkTopology, WafPillarResult, ProjectTimeline } from "../../types";
import type { DiagramNode } from "../../utils/diagramParser";

export type ResultTab = "explanation" | "diagram" | "runbook" | "iac" | "cost" | "adr" | "waf" | "network" | "gantt";

export type IacKind = "bicep" | "terraform" | "arm";

export interface IacFilesResult {
  files: Record<string, string>;
  pattern_name?: string;
  notes?: string[];
}

const useStyles = makeStyles({
  tabContent: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  prose: {
    "& p": { margin: "6px 0" },
    "& h2, & h3": { fontWeight: 600, margin: "12px 0 4px" },
    "& pre": { background: tokens.colorNeutralBackground3, padding: "10px", borderRadius: "4px", overflowX: "auto", fontSize: "13px" },
    "& code": { fontFamily: "monospace" },
    "& ul, & ol": { paddingLeft: "20px" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "4px 8px" },
  },
  diagramFrame: { width: "100%", height: "500px", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "4px" },
  diagramActions: { display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" },
  bicepActions: { display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" },
  costHeader: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" },
  totalRow: { fontWeight: 700, background: tokens.colorNeutralBackground3 },
  tipsSection: { marginTop: "12px", padding: "10px 12px", background: tokens.colorNeutralBackground3, borderRadius: "6px" },
  adrCard: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "10px", overflow: "hidden" },
  adrHeader: { padding: "14px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground3, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  adrSection: { padding: "14px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` },
  adrSectionLabel: { fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: tokens.colorNeutralForeground4, marginBottom: "6px", display: "block" },
  adrAlts: { padding: "14px 16px" },
  serviceChips: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" },
  serviceChipBtn: {
    cursor: "pointer",
    padding: "3px 8px",
    borderRadius: "12px",
    fontSize: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    "&:hover": { background: "rgba(0, 120, 212, 0.1)", border: "1px solid rgba(0, 120, 212, 0.4)", color: tokens.colorNeutralForeground1 },
  },
  emptyTabHint: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    flex: 1,
    padding: "40px 20px",
    textAlign: "center",
  },
});

const adrStatusColor: Record<string, "success" | "warning" | "danger"> = { Accepted: "success", Proposed: "warning", Deprecated: "danger" };

export interface ArchitectureTabContentProps {
  activeTab: ResultTab;
  explanation: string;
  diagramXml: string | null;
  diagramHtml: string | null;
  diagramNodes: DiagramNode[];
  runbook: string | null;
  bicepResult: BicepResult | null;
  terraformResult: IacFilesResult | null;
  armResult: IacFilesResult | null;
  costEstimate: CostEstimate | null;
  adrRecord: AdrRecord | null;
  wafResults: Record<string, WafPillarResult>;
  networkTopology: NetworkTopology | null;
  networkHtml: string | null;
  projectTimeline: ProjectTimeline | null;
  ganttHtml: string | null;
  popoverServiceLabel: string | null;
  popoverStreamText: string;
  popoverLoading: boolean;
  generatingTab: string | null;
  isAnyStreaming: boolean;
  deliverableStreaming: boolean;
  requirements: string;
  generateDeliverable: (component: string, tabKey: ResultTab) => void;
  generateIac: (kinds: IacKind[]) => void;
  selectedIac: Set<IacKind>;
  toggleIac: (kind: IacKind) => void;
  downloadDiagram: () => void;
  openInDrawio: () => void;
  setShowEditor: (v: boolean) => void;
  setPopoverServiceLabel: (v: string | null) => void;
  cancelService: () => void;
  downloadGantt: () => void;
  downloadNetworkDiagram: () => void;
  openNetworkInDrawio: () => void;
  downloadBicep: () => void;
  downloadParamFile: () => void;
  downloadIacFiles: (kind: "terraform" | "arm") => void;
}

export default function ArchitectureTabContent(props: ArchitectureTabContentProps) {
  const styles = useStyles();
  const {
    activeTab, explanation, diagramXml, diagramHtml, diagramNodes, runbook,
    bicepResult, costEstimate, adrRecord, wafResults, networkTopology, networkHtml,
    projectTimeline, ganttHtml, popoverServiceLabel, popoverStreamText, popoverLoading,
    generatingTab, isAnyStreaming, deliverableStreaming, requirements,
    generateDeliverable, downloadDiagram, openInDrawio, setShowEditor,
    setPopoverServiceLabel, cancelService, downloadGantt, downloadNetworkDiagram,
    openNetworkInDrawio, downloadBicep, downloadParamFile,
    downloadIacFiles, generateIac, selectedIac, toggleIac,
  } = props;
  const terraformResult = props.terraformResult;
  const armResult = props.armResult;

  function renderEmptyTab(tabKey: ResultTab, label: string, hint: string, component: string) {
    const isGenerating = generatingTab === tabKey;
    return (
      <div className={styles.emptyTabHint}>
        <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>{hint}</Text>
        {isGenerating
          ? <Spinner size="small" />
          : (
            <Button appearance="primary" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable(component, tabKey)} disabled={!requirements.trim() || deliverableStreaming}>
              Generate {label}
            </Button>
          )}
      </div>
    );
  }

  return (
    <div className={styles.tabContent}>

      {/* Explanation */}
      {activeTab === "explanation" && (
        <div className={styles.prose}>
          {explanation
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{explanation}</ReactMarkdown>
            : <Text style={{ color: tokens.colorNeutralForeground3 }}>Fill in the requirements and click Generate. Diagrams, IaC, cost estimates, ADRs, and WAF assessments can be generated on-demand from their tabs.</Text>}
        </div>
      )}

      {/* Diagram */}
      {activeTab === "diagram" && (
        diagramXml ? (
          <div>
            <div className={styles.diagramActions}>
              <Button size="small" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("diagram", "diagram")} disabled={isAnyStreaming}>Regenerate</Button>
              <Button size="small" icon={<ArrowDownloadRegular />} onClick={downloadDiagram}>Download .drawio</Button>
              <Button size="small" icon={<OpenRegular />} onClick={openInDrawio}>Open in draw.io</Button>
              <Button size="small" icon={<EditRegular />} onClick={() => setShowEditor(true)}>Edit in draw.io</Button>
            </div>
            <iframe className={styles.diagramFrame} srcDoc={diagramHtml ?? undefined} title="Architecture Diagram" />
            {diagramNodes.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <Text size={200} weight="semibold" block style={{ marginBottom: "8px", color: tokens.colorNeutralForeground2 }}>Services in Architecture</Text>
                <div className={styles.serviceChips}>
                  {diagramNodes.map((node) => (
                    <button key={node.id} className={styles.serviceChipBtn} onClick={() => setPopoverServiceLabel(node.label)}>{node.label}</button>
                  ))}
                </div>
              </div>
            )}
            <Dialog open={!!popoverServiceLabel} onOpenChange={(_, d) => { if (!d.open) { setPopoverServiceLabel(null); cancelService(); } }}>
              <DialogSurface style={{ maxWidth: "400px" }}>
                <DialogTitle>{popoverServiceLabel}</DialogTitle>
                <DialogBody>
                  {popoverServiceLabel && (() => {
                    const meta = lookupService(popoverServiceLabel);
                    return (
                      <>
                        {meta && (
                          <div style={{ marginBottom: "10px" }}>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                              <Badge appearance="tint" color="brand">{meta.category}</Badge>
                              <Badge appearance="tint" color="success">SLA: {meta.sla}</Badge>
                            </div>
                            <div style={{ display: "flex", gap: "16px" }}>
                              <Link href={meta.pricingUrl} target="_blank" rel="noopener noreferrer">Pricing</Link>
                              <Link href={meta.docsUrl} target="_blank" rel="noopener noreferrer">Docs</Link>
                            </div>
                          </div>
                        )}
                        <div style={{ borderTop: `1px solid ${tokens.colorNeutralStroke3}`, paddingTop: "10px", fontSize: "13px", lineHeight: "1.6" }}>
                          {popoverLoading && !popoverStreamText && <Spinner size="tiny" label="Loading..." />}
                          {popoverStreamText && <ReactMarkdown remarkPlugins={[remarkGfm]}>{popoverStreamText}</ReactMarkdown>}
                        </div>
                      </>
                    );
                  })()}
                </DialogBody>
                <DialogActions>
                  <DialogTrigger disableButtonEnhancement>
                    <Button appearance="secondary">Close</Button>
                  </DialogTrigger>
                </DialogActions>
              </DialogSurface>
            </Dialog>
          </div>
        ) : renderEmptyTab("diagram", "Diagram", "Generate a draw.io architecture diagram based on your requirements.", "diagram")
      )}

      {/* Runbook */}
      {activeTab === "runbook" && (
        runbook ? (
          <>
            <div><Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("runbook", "runbook")} disabled={isAnyStreaming}>Regenerate</Button></div>
            <div className={styles.prose}><ReactMarkdown remarkPlugins={[remarkGfm]}>{runbook}</ReactMarkdown></div>
          </>
        ) : renderEmptyTab("runbook", "Runbook", "Generate an operational runbook with deployment steps, health checks, and rollback procedures.", "runbook")
      )}

      {/* IaC — Bicep / Terraform / ARM */}
      {activeTab === "iac" && (() => {
        const hasAny = !!bicepResult || (!!terraformResult && Object.keys(terraformResult.files).length > 0) || (!!armResult && Object.keys(armResult.files).length > 0);
        const generating = generatingTab === "iac";
        const selectedList = Array.from(selectedIac);
        return (
          <div>
            <div style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 8, padding: "12px 14px", marginBottom: 16, background: tokens.colorNeutralBackground2 }}>
              <Text size={300} weight="semibold" block style={{ marginBottom: 8 }}>Choose IaC formats to generate</Text>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
                <Checkbox label="Bicep" checked={selectedIac.has("bicep")} onChange={() => toggleIac("bicep")} disabled={isAnyStreaming} />
                <Checkbox label="Terraform" checked={selectedIac.has("terraform")} onChange={() => toggleIac("terraform")} disabled={isAnyStreaming} />
                <Checkbox label="ARM" checked={selectedIac.has("arm")} onChange={() => toggleIac("arm")} disabled={isAnyStreaming} />
              </div>
              {generating
                ? <Spinner size="small" label="Generating IaC..." />
                : <Button appearance="primary" icon={<ArrowSyncRegular />} onClick={() => generateIac(selectedList)} disabled={selectedList.length === 0 || !requirements.trim() || deliverableStreaming}>
                    {hasAny ? "Regenerate selected" : "Generate selected"}
                  </Button>}
            </div>

            {bicepResult && (
              <div style={{ marginBottom: 24 }}>
                <Text size={400} weight="semibold" block style={{ marginBottom: 8 }}>Bicep</Text>
                <div className={styles.bicepActions}>
                  <Button size="small" icon={<ArrowDownloadRegular />} onClick={downloadBicep}>Download main.bicep</Button>
                  {bicepResult.param_file && <Button size="small" icon={<ArrowDownloadRegular />} onClick={downloadParamFile}>Download .bicepparam</Button>}
                </div>
                <Text weight="semibold" size={300} block style={{ marginBottom: 6 }}>main.bicep</Text>
                <div className={styles.prose}><pre><code>{bicepResult.bicep_code}</code></pre></div>
                {bicepResult.param_file && (
                  <>
                    <Text weight="semibold" size={300} block style={{ margin: "16px 0 6px" }}>main.bicepparam</Text>
                    <div className={styles.prose}><pre><code>{bicepResult.param_file}</code></pre></div>
                  </>
                )}
                {bicepResult.deploy_commands.length > 0 && (
                  <>
                    <Text weight="semibold" size={300} block style={{ margin: "16px 0 6px" }}>Deploy Commands</Text>
                    <div className={styles.prose}><pre><code>{bicepResult.deploy_commands.join("\n")}</code></pre></div>
                  </>
                )}
                {bicepResult.notes.length > 0 && (
                  <div className={styles.tipsSection}>
                    <Text size={200} weight="semibold" block style={{ marginBottom: 4 }}>Notes</Text>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {bicepResult.notes.map((n, i) => <li key={i}><Text size={200}>{n}</Text></li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {terraformResult && Object.keys(terraformResult.files).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <Text size={400} weight="semibold" block style={{ marginBottom: 8 }}>Terraform</Text>
                <div className={styles.bicepActions}>
                  <Button size="small" icon={<ArrowDownloadRegular />} onClick={() => downloadIacFiles("terraform")}>Download all files</Button>
                </div>
                {terraformResult.pattern_name && (
                  <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 8 }}>Pattern: {terraformResult.pattern_name}</Text>
                )}
                {Object.entries(terraformResult.files).map(([fname, content]) => (
                  <div key={fname}>
                    <Text weight="semibold" size={300} block style={{ margin: "12px 0 6px" }}>{fname}</Text>
                    <div className={styles.prose}><pre><code>{content}</code></pre></div>
                  </div>
                ))}
                {terraformResult.notes && terraformResult.notes.length > 0 && (
                  <div className={styles.tipsSection}>
                    <Text size={200} weight="semibold" block style={{ marginBottom: 4 }}>Notes</Text>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {terraformResult.notes.map((n, i) => <li key={i}><Text size={200}>{n}</Text></li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {armResult && Object.keys(armResult.files).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <Text size={400} weight="semibold" block style={{ marginBottom: 8 }}>ARM</Text>
                <div className={styles.bicepActions}>
                  <Button size="small" icon={<ArrowDownloadRegular />} onClick={() => downloadIacFiles("arm")}>Download all files</Button>
                </div>
                {armResult.pattern_name && (
                  <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: 8 }}>Pattern: {armResult.pattern_name}</Text>
                )}
                {Object.entries(armResult.files).map(([fname, content]) => (
                  <div key={fname}>
                    <Text weight="semibold" size={300} block style={{ margin: "12px 0 6px" }}>{fname}</Text>
                    <div className={styles.prose}><pre><code>{content}</code></pre></div>
                  </div>
                ))}
                {armResult.notes && armResult.notes.length > 0 && (
                  <div className={styles.tipsSection}>
                    <Text size={200} weight="semibold" block style={{ marginBottom: 4 }}>Notes</Text>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {armResult.notes.map((n, i) => <li key={i}><Text size={200}>{n}</Text></li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!hasAny && !generating && (
              <Text style={{ color: tokens.colorNeutralForeground3 }}>Pick one or more formats above and click Generate.</Text>
            )}
          </div>
        );
      })()}

      {/* Cost */}
      {activeTab === "cost" && (
        costEstimate ? (
          <div>
            <div style={{ marginBottom: "8px" }}>
              <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("cost", "cost")} disabled={isAnyStreaming}>Regenerate</Button>
            </div>
            <div className={styles.costHeader}>
              <Badge appearance="filled" color="success" size="large">${costEstimate.total_monthly_estimate.toLocaleString()}/mo</Badge>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{costEstimate.currency} · estimated</Text>
            </div>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>SKU</TableHeaderCell>
                  <TableHeaderCell>Region</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell>$/mo</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costEstimate.line_items.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell><Text size={200}>{item.service}</Text></TableCell>
                    <TableCell><Text size={200}>{item.sku || "—"}</Text></TableCell>
                    <TableCell><Text size={200}>{item.region || "—"}</Text></TableCell>
                    <TableCell><Text size={200}>{item.quantity}</Text></TableCell>
                    <TableCell><Text size={200}>{item.monthly_estimate != null ? `$${item.monthly_estimate.toLocaleString()}` : "—"}</Text></TableCell>
                  </TableRow>
                ))}
                <TableRow className={styles.totalRow}>
                  <TableCell>Total</TableCell><TableCell /><TableCell /><TableCell />
                  <TableCell>${costEstimate.total_monthly_estimate.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {costEstimate.optimization_tips && costEstimate.optimization_tips.length > 0 && (
              <div className={styles.tipsSection}>
                <Text size={200} weight="semibold" block style={{ marginBottom: 4 }}>Optimization Tips</Text>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {costEstimate.optimization_tips.map((t, i) => <li key={i}><Text size={200}>{t}</Text></li>)}
                </ul>
              </div>
            )}
            <Text size={100} style={{ color: tokens.colorNeutralForeground3, marginTop: 8, display: "block" }}>{costEstimate.disclaimer}</Text>
          </div>
        ) : renderEmptyTab("cost", "Cost Estimate", "Generate a monthly cost estimate with per-service line items and optimization tips.", "cost")
      )}

      {/* ADR */}
      {activeTab === "adr" && (
        adrRecord ? (
          <>
            <div><Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("adr", "adr")} disabled={isAnyStreaming}>Regenerate</Button></div>
            <div className={styles.adrCard}>
              <div className={styles.adrHeader}>
                <Badge appearance="tint" color={adrStatusColor[adrRecord.status] ?? "informative"} size="medium">{adrRecord.status}</Badge>
                <Text weight="semibold" size={400}>{adrRecord.title}</Text>
              </div>
              <div className={styles.adrSection}><span className={styles.adrSectionLabel}>Context</span><Text size={300}>{adrRecord.context}</Text></div>
              <div className={styles.adrSection}><span className={styles.adrSectionLabel}>Decision</span><Text size={300}>{adrRecord.decision}</Text></div>
              <div className={styles.adrSection}><span className={styles.adrSectionLabel}>Consequences</span><Text size={300}>{adrRecord.consequences}</Text></div>
              {adrRecord.alternatives && adrRecord.alternatives.length > 0 && (
                <div className={styles.adrAlts}>
                  <span className={styles.adrSectionLabel}>Alternatives Considered</span>
                  <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>
                    {adrRecord.alternatives.map((alt, i) => <li key={i}><Text size={300}>{alt}</Text></li>)}
                  </ul>
                </div>
              )}
            </div>
          </>
        ) : renderEmptyTab("adr", "ADR", "Generate an Architecture Decision Record documenting the key design choices and alternatives considered.", "adr")
      )}

      {/* WAF */}
      {activeTab === "waf" && (
        Object.keys(wafResults).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div><Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("waf", "waf")} disabled={isAnyStreaming}>Regenerate</Button></div>
            {Object.values(wafResults).map((pillar) => (
              <div key={pillar.pillar} style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", background: tokens.colorNeutralBackground3, display: "flex", alignItems: "center", gap: "10px" }}>
                  <Badge appearance="filled" color={pillar.score >= 4 ? "success" : pillar.score >= 3 ? "warning" : "danger"} size="medium">{pillar.score}/5</Badge>
                  <Text weight="semibold" size={300} style={{ textTransform: "capitalize" }}>{pillar.pillar}</Text>
                </div>
                {pillar.findings.length > 0 && (
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
                    <Text size={200} weight="semibold" block style={{ marginBottom: "4px", color: tokens.colorNeutralForeground3 }}>FINDINGS</Text>
                    <ul style={{ margin: 0, paddingLeft: "16px" }}>
                      {pillar.findings.map((f, i) => <li key={i}><Text size={200}>{f}</Text></li>)}
                    </ul>
                  </div>
                )}
                {pillar.recommendations.length > 0 && (
                  <div style={{ padding: "10px 14px" }}>
                    <Text size={200} weight="semibold" block style={{ marginBottom: "4px", color: tokens.colorNeutralForeground3 }}>RECOMMENDATIONS</Text>
                    <ul style={{ margin: 0, paddingLeft: "16px" }}>
                      {pillar.recommendations.map((r, i) => <li key={i}><Text size={200}>{r}</Text></li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : renderEmptyTab("waf", "WAF Assessment", "Generate a Well-Architected Framework assessment across all 5 pillars with findings and recommendations.", "waf")
      )}

      {/* Network */}
      {activeTab === "network" && (
        networkTopology ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <Badge appearance="tint" color="brand">{networkTopology.topology_type}</Badge>
              <Button size="small" appearance="outline" icon={<ArrowSyncRegular />} onClick={() => generateDeliverable("network", "network")} disabled={isAnyStreaming}>Regenerate</Button>
              {networkTopology.diagramXml && (
                <>
                  <Button size="small" icon={<ArrowDownloadRegular />} onClick={downloadNetworkDiagram}>Download .drawio</Button>
                  <Button size="small" icon={<OpenRegular />} onClick={openNetworkInDrawio}>Open in draw.io</Button>
                </>
              )}
            </div>
            {networkTopology.diagramXml && (
              <iframe className={styles.diagramFrame} srcDoc={networkHtml ?? undefined} title="Network Topology" />
            )}
            {networkTopology.vnets.map((vnet, i) => (
              <div key={i} style={{ border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "8px", overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: tokens.colorNeutralBackground3, display: "flex", gap: "10px", alignItems: "center" }}>
                  <Text weight="semibold" size={300}>{vnet.name}</Text>
                  <Badge appearance="outline" size="small">{vnet.cidr}</Badge>
                  {vnet.region && <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{vnet.region}</Text>}
                </div>
                {vnet.subnets.length > 0 && (
                  <Table size="small">
                    <TableHeader><TableRow><TableHeaderCell>Subnet</TableHeaderCell><TableHeaderCell>CIDR</TableHeaderCell><TableHeaderCell>Purpose</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>
                      {vnet.subnets.map((s, j) => (
                        <TableRow key={j}>
                          <TableCell><Text size={200}>{s.name}</Text></TableCell>
                          <TableCell><Text size={200}>{s.cidr}</Text></TableCell>
                          <TableCell><Text size={200}>{s.purpose ?? "—"}</Text></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
            {networkTopology.nsg_rules.length > 0 && (
              <div>
                <Text weight="semibold" size={300} block style={{ marginBottom: "8px" }}>NSG Rules</Text>
                <Table size="small">
                  <TableHeader><TableRow><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Dir</TableHeaderCell><TableHeaderCell>Action</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell><TableHeaderCell>Dest</TableHeaderCell><TableHeaderCell>Port</TableHeaderCell></TableRow></TableHeader>
                  <TableBody>
                    {networkTopology.nsg_rules.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell><Text size={200}>{r.name}</Text></TableCell>
                        <TableCell><Text size={200}>{r.direction}</Text></TableCell>
                        <TableCell><Badge appearance="tint" color={r.action === "Allow" ? "success" : "danger"} size="small">{r.action}</Badge></TableCell>
                        <TableCell><Text size={200}>{r.source}</Text></TableCell>
                        <TableCell><Text size={200}>{r.destination}</Text></TableCell>
                        <TableCell><Text size={200}>{r.port}</Text></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {networkTopology.private_endpoints.length > 0 && (
              <div>
                <Text weight="semibold" size={300} block style={{ marginBottom: "8px" }}>Private Endpoints</Text>
                <Table size="small">
                  <TableHeader><TableRow><TableHeaderCell>Resource</TableHeaderCell><TableHeaderCell>Subnet</TableHeaderCell><TableHeaderCell>DNS Zone</TableHeaderCell></TableRow></TableHeader>
                  <TableBody>
                    {networkTopology.private_endpoints.map((pe, i) => (
                      <TableRow key={i}>
                        <TableCell><Text size={200}>{pe.resource}</Text></TableCell>
                        <TableCell><Text size={200}>{pe.subnet}</Text></TableCell>
                        <TableCell><Text size={200}>{pe.private_dns_zone}</Text></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {networkTopology.dns_design && (
              <div style={{ padding: "10px 14px", background: tokens.colorNeutralBackground3, borderRadius: "8px" }}>
                <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>DNS Design</Text>
                <Text size={200}>{networkTopology.dns_design}</Text>
              </div>
            )}
            {networkTopology.firewall && (
              <div style={{ padding: "10px 14px", background: tokens.colorNeutralBackground3, borderRadius: "8px" }}>
                <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Firewall</Text>
                <Text size={200}>{networkTopology.firewall}</Text>
              </div>
            )}
          </div>
        ) : renderEmptyTab("network", "Network Topology", "Generate a network topology with VNets, subnets, NSG rules, and private endpoints.", "network")
      )}

      {/* Gantt */}
      {activeTab === "gantt" && (
        projectTimeline ? (
          <div>
            <div className={styles.diagramActions}>
              <Button size="small" icon={<ArrowDownloadRegular />} onClick={downloadGantt}>Download .drawio</Button>
              <Button size="small" icon={<OpenRegular />} onClick={() => window.open(`https://viewer.diagrams.net/?xml=${encodeURIComponent(projectTimeline.diagramXml)}`, "_blank")}>Open in draw.io</Button>
            </div>
            {projectTimeline.notes && (
              <div className={styles.tipsSection} style={{ marginBottom: "12px" }}>
                <Text size={200}>{projectTimeline.notes}</Text>
              </div>
            )}
            <iframe className={styles.diagramFrame} srcDoc={ganttHtml ?? undefined} title="Project Timeline" />
          </div>
        ) : (
          <div className={styles.emptyTabHint}>
            <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>Generate an architecture design to produce a project Gantt chart with phases, milestones, and critical path.</Text>
          </div>
        )
      )}

    </div>
  );
}
