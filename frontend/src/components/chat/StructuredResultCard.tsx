import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components";
import { CopyRegular, CheckmarkRegular, ArrowDownloadRegular, ArrowForwardRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { copyComparisonAsMarkdown, exportComparisonSvg, exportComparisonPng } from "../../utils/comparisonExport";
import { downloadTextFile, downloadFilesAsZip, languageFromFilename } from "../../utils/fileBundleExport";
import type {
  StructuredResult, ServiceComparison, RegionComparison, PracticeExamPack,
  StakeholderPlan, DecisionCard, Mode,
  TerraformFilesResult, ArmFilesResult, CicdFilesResult,
  CostAlertsResult, SecurityPostureResult, MulticloudComparisonResult,
} from "../../types";

const useCardStyles = makeStyles({
  card: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "10px",
    padding: "14px 16px",
    overflow: "hidden",
    width: "100%",
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  cardTitleBadges: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    flex: 1,
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
  },
  cardTable: { fontSize: "12px", width: "100%" },
  tableRowEven: { background: tokens.colorNeutralBackground2 },
  tableRowOdd: { background: tokens.colorNeutralBackground1 },
  totalRow: { fontWeight: 700, background: tokens.colorNeutralBackground3 },
  gapRow: {
    padding: "8px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    "&:last-child": { borderBottom: "none" },
  },
  dangerText: { color: tokens.colorPaletteRedForeground1 },
  tip: { fontSize: "12px", color: tokens.colorNeutralForeground3, marginTop: "8px", display: "block" },
});

export default function StructuredResultCard({ result, onContinueIn }: { result: StructuredResult; onContinueIn?: (mode: Mode, seed: string) => void }) {
  const styles = useCardStyles();

  if (result.kind === "cost_estimate") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="tint" color="success">Cost Estimate</Badge>
          <Text size={300} weight="semibold">${data.total_monthly_estimate.toLocaleString()}/mo</Text>
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Service</TableHeaderCell><TableHeaderCell>SKU</TableHeaderCell>
              <TableHeaderCell>Qty</TableHeaderCell><TableHeaderCell>$/mo</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.line_items.map((item, i) => (
              <TableRow key={i}>
                <TableCell>{item.service}</TableCell><TableCell>{item.sku || "—"}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.monthly_estimate != null ? `$${item.monthly_estimate.toLocaleString()}` : "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow className={styles.totalRow}>
              <TableCell>Total</TableCell><TableCell /><TableCell />
              <TableCell>${data.total_monthly_estimate.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {(data.optimization_tips?.length ?? 0) > 0 && (
          <div style={{ marginTop: "10px" }}>
            <Text size={200} weight="semibold">Optimization Tips</Text>
            <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>
              {(data.optimization_tips ?? []).map((t, i) => <li key={i}><Text size={200}>{t}</Text></li>)}
            </ul>
          </div>
        )}
        <Text className={styles.tip}>{data.disclaimer}</Text>
      </div>
    );
  }

  if (result.kind === "compliance_result") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="tint" color="brand">{data.framework}</Badge>
          <Text size={300}>{data.controls_met.length} controls met · {data.gaps.length} gaps</Text>
        </div>
        {data.gaps.map((gap, i) => (
          <div key={i} className={styles.gapRow}>
            <Text size={200} weight="semibold" className={styles.dangerText}>{gap.control}</Text>
            <Text size={200}>{gap.gap}</Text>
            <Text size={200} style={{ color: "#0078D4" }}>Fix: {gap.remediation}</Text>
            {gap.azure_service && <Badge appearance="tint" size="small">{gap.azure_service}</Badge>}
          </div>
        ))}
        {data.azure_policy_recommendations.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <Text size={200} weight="semibold">Recommended Policies</Text>
            <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>
              {data.azure_policy_recommendations.map((p, i) => <li key={i}><Text size={200}>{p}</Text></li>)}
            </ul>
          </div>
        )}
        {onContinueIn && (
          <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke3}`, display: "flex", gap: "6px" }}>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("security", `Compliance framework: ${data.framework}. Gaps: ${data.gaps.map(g => g.control).join(", ")}`)}>Open in Security & Identity</Button>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("governance", `Compliance: ${data.framework}. Recommended policies: ${data.azure_policy_recommendations.join("; ")}`)}>Open in Governance</Button>
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "migration_assessment") {
    const { data } = result;
    const riskColor: Record<string, "danger" | "warning" | "success" | "informative"> = {
      Critical: "danger", High: "danger", Medium: "warning", Low: "success",
    };
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">{data.strategy}</Badge>
          <Badge appearance="tint" color={riskColor[data.risk_level] ?? "informative"}>{data.risk_level} Risk</Badge>
          {data.effort_weeks && <Badge appearance="tint" color="informative">{data.effort_weeks}w effort</Badge>}
          <Text size={300} weight="semibold">{data.workload_name}</Text>
        </div>
        <Text size={200} block style={{ marginBottom: "8px" }}>{data.rationale}</Text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
          {data.target_azure_services.map((s, i) => <Badge key={i} appearance="tint" size="small">{s}</Badge>)}
        </div>
        {data.blockers.length > 0 && (
          <div>
            <Text size={200} weight="semibold" className={styles.dangerText}>Blockers</Text>
            <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>
              {data.blockers.map((b, i) => <li key={i}><Text size={200}>{b}</Text></li>)}
            </ul>
          </div>
        )}
        {onContinueIn && (
          <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke3}`, display: "flex", gap: "6px" }}>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("drbc", `Workload: ${data.workload_name}. Strategy: ${data.strategy}. Target services: ${data.target_azure_services.join(", ")}`)}>Design DR/BC Strategy</Button>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("architecture", `Migrate ${data.workload_name} to Azure using ${data.strategy} strategy. Target services: ${data.target_azure_services.join(", ")}`)}>Design Architecture</Button>
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "service_comparison") {
    return <ServiceComparisonCard data={result.data} />;
  }

  if (result.kind === "monitoring_config") {
    const { data } = result;
    const sevColor: Record<number, "danger" | "warning" | "success" | "informative"> = {
      0: "danger", 1: "danger", 2: "warning", 3: "informative", 4: "informative",
    };
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="tint" color="brand">Monitoring Config</Badge>
          <Text size={300}>{data.alert_rules.length} alerts · {data.kql_queries.length} KQL queries</Text>
        </div>
        {data.alert_rules.map((rule, i) => (
          <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "2px" }}>
              <Badge appearance="tint" color={sevColor[rule.severity] ?? "informative"} size="small">Sev {rule.severity}</Badge>
              <Text size={200} weight="semibold">{rule.name}</Text>
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {rule.metric_or_kql.slice(0, 80)}{rule.metric_or_kql.length > 80 ? "…" : ""} · {rule.threshold}
            </Text>
          </div>
        ))}
        {data.kql_queries.length > 0 && (
          <Accordion collapsible style={{ marginTop: "8px" }}>
            <AccordionItem value="kql">
              <AccordionHeader size="small">KQL Queries ({data.kql_queries.length})</AccordionHeader>
              <AccordionPanel>
                {data.kql_queries.map((q, i) => (
                  <div key={i} style={{ marginBottom: "10px" }}>
                    <Text size={200} weight="semibold">{q.name}</Text>
                    <pre style={{ background: tokens.colorNeutralBackground3, padding: "8px 10px", borderRadius: "6px", overflowX: "auto", fontSize: "12px", margin: "4px 0" }}>
                      <code>{q.query}</code>
                    </pre>
                  </div>
                ))}
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    );
  }

  if (result.kind === "dr_strategy") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">{data.dr_pattern}</Badge>
          <Text size={300}>{data.primary_region} → {data.secondary_region}</Text>
          {data.estimated_monthly_dr_cost && (
            <Badge appearance="tint" color="success">{data.estimated_monthly_dr_cost}/mo</Badge>
          )}
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Service</TableHeaderCell><TableHeaderCell>DR Approach</TableHeaderCell>
              <TableHeaderCell>RPO</TableHeaderCell><TableHeaderCell>Azure Feature</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.service_configs.map((sc, i) => (
              <TableRow key={i}>
                <TableCell>{sc.service}</TableCell><TableCell>{sc.dr_approach}</TableCell>
                <TableCell>{sc.rpo_achieved ?? "—"}</TableCell><TableCell>{sc.azure_feature ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.failover_steps.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <Text size={200} weight="semibold">Failover Steps</Text>
            <ol style={{ margin: "4px 0", paddingLeft: "18px" }}>
              {data.failover_steps.map((s, i) => <li key={i}><Text size={200}>{s}</Text></li>)}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "network_topology") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">{data.topology_type}</Badge>
          <Text size={300}>{data.vnets.length} VNet{data.vnets.length !== 1 ? "s" : ""} · {data.nsg_rules.length} NSG rules · {data.private_endpoints.length} Private Endpoints</Text>
        </div>
        {data.vnets.map((vnet, i) => (
          <Accordion collapsible key={i} style={{ marginBottom: "4px" }}>
            <AccordionItem value={`vnet-${i}`}>
              <AccordionHeader size="small">{vnet.name} ({vnet.cidr}){vnet.region ? ` — ${vnet.region}` : ""}</AccordionHeader>
              <AccordionPanel>
                <Table size="extra-small" className={styles.cardTable}>
                  <TableHeader><TableRow><TableHeaderCell>Subnet</TableHeaderCell><TableHeaderCell>CIDR</TableHeaderCell><TableHeaderCell>Purpose</TableHeaderCell></TableRow></TableHeader>
                  <TableBody>
                    {vnet.subnets.map((s, j) => (
                      <TableRow key={j}><TableCell>{s.name}</TableCell><TableCell>{s.cidr}</TableCell><TableCell>{s.purpose ?? "—"}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        ))}
        {data.nsg_rules.length > 0 && (
          <Accordion collapsible style={{ marginTop: "4px" }}>
            <AccordionItem value="nsg">
              <AccordionHeader size="small">NSG Rules ({data.nsg_rules.length})</AccordionHeader>
              <AccordionPanel>
                <Table size="extra-small" className={styles.cardTable}>
                  <TableHeader><TableRow>
                    <TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Dir</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>
                    <TableHeaderCell>Dest</TableHeaderCell><TableHeaderCell>Port</TableHeaderCell>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.nsg_rules.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell><Badge appearance="tint" color={r.direction === "Inbound" ? "brand" : "informative"} size="small">{r.direction}</Badge></TableCell>
                        <TableCell><Badge appearance="tint" color={r.action === "Allow" ? "success" : "danger"} size="small">{r.action}</Badge></TableCell>
                        <TableCell>{r.source}</TableCell><TableCell>{r.destination}</TableCell><TableCell>{r.port}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
        {data.private_endpoints.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <Text size={200} weight="semibold">Private Endpoints</Text>
            {data.private_endpoints.map((pe, i) => (
              <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
                <Text size={200}>{pe.resource} → {pe.subnet} · DNS: {pe.private_dns_zone}</Text>
              </div>
            ))}
          </div>
        )}
        {data.dns_design && <div style={{ marginTop: "8px" }}><Text size={200} weight="semibold">DNS: </Text><Text size={200}>{data.dns_design}</Text></div>}
        {data.firewall && <div style={{ marginTop: "4px" }}><Text size={200} weight="semibold">Firewall: </Text><Text size={200}>{data.firewall}</Text></div>}
      </div>
    );
  }

  if (result.kind === "landing_zone_design") {
    const { data } = result;
    function renderMg(mg: { name: string; level: number; children?: typeof mg[] }, depth: number): React.ReactNode {
      return (
        <div key={mg.name} style={{ paddingLeft: `${depth * 16}px`, margin: "2px 0" }}>
          <Text size={200}>{depth === 0 ? "🏢" : depth === 1 ? "📁" : "📂"} {mg.name}</Text>
          {mg.children?.map(c => renderMg(c, depth + 1))}
        </div>
      );
    }
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">Landing Zone Design</Badge>
          <Text size={300}>{data.management_groups.length} top-level MGs · {data.policy_initiatives.length} policy initiatives</Text>
        </div>
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold">Management Group Hierarchy</Text>
          {data.management_groups.map(mg => renderMg(mg, 0))}
        </div>
        {data.policy_initiatives.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <Text size={200} weight="semibold">Policy Initiatives</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {data.policy_initiatives.map((p, i) => <Badge key={i} appearance="tint" color="informative" size="small">{p}</Badge>)}
            </div>
          </div>
        )}
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold">Naming Convention: </Text><Text size={200}>{data.naming_convention}</Text>
        </div>
        {Object.keys(data.mandatory_tags ?? {}).length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <Text size={200} weight="semibold">Mandatory Tags</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {Object.entries(data.mandatory_tags).map(([k, v], i) => <Badge key={i} appearance="outline" size="small">{k}: {v}</Badge>)}
            </div>
          </div>
        )}
        {data.rbac_assignments?.length > 0 && (
          <Accordion collapsible>
            <AccordionItem value="rbac">
              <AccordionHeader size="small">RBAC Assignments ({data.rbac_assignments.length})</AccordionHeader>
              <AccordionPanel>
                <Table size="extra-small" className={styles.cardTable}>
                  <TableHeader><TableRow><TableHeaderCell>Principal</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell><TableHeaderCell>Scope</TableHeaderCell></TableRow></TableHeader>
                  <TableBody>
                    {data.rbac_assignments.map((a, i) => (
                      <TableRow key={i}><TableCell>{a.principal}</TableCell><TableCell>{a.role}</TableCell><TableCell>{a.scope}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    );
  }

  if (result.kind === "rbac_model") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">RBAC Model</Badge>
          <Text size={300}>{data.role_assignments.length} assignments · {data.custom_roles.length} custom roles</Text>
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow><TableHeaderCell>Principal</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell><TableHeaderCell>Scope</TableHeaderCell><TableHeaderCell>Type</TableHeaderCell></TableRow>
          </TableHeader>
          <TableBody>
            {data.role_assignments.map((ra, i) => (
              <TableRow key={i}>
                <TableCell>{ra.principal}</TableCell><TableCell>{ra.role}</TableCell><TableCell>{ra.scope}</TableCell>
                <TableCell><Badge appearance="tint" color={ra.type === "PIM-Eligible" ? "warning" : "success"} size="small">{ra.type}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.conditional_access_policies?.length > 0 && (
          <Accordion collapsible style={{ marginTop: "8px" }}>
            <AccordionItem value="ca">
              <AccordionHeader size="small">Conditional Access Policies ({data.conditional_access_policies.length})</AccordionHeader>
              <AccordionPanel>
                {data.conditional_access_policies.map((p, i) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
                    <Text size={200} weight="semibold">{p.name}</Text>
                    <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>{p.conditions} → {p.grant_controls}</Text>
                  </div>
                ))}
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
        {data.pim_settings && <div style={{ marginTop: "8px" }}><Text size={200} weight="semibold">PIM: </Text><Text size={200}>{data.pim_settings}</Text></div>}
        {data.workload_federation && <div style={{ marginTop: "4px" }}><Text size={200} weight="semibold">Workload Federation: </Text><Text size={200}>{data.workload_federation}</Text></div>}
      </div>
    );
  }

  if (result.kind === "threat_register") {
    const { data } = result;
    const riskColor = (score: number): "danger" | "warning" | "success" => score >= 16 ? "danger" : score >= 9 ? "warning" : "success";
    const riskLabel = (score: number) => score >= 16 ? "Critical" : score >= 9 ? "High" : score >= 4 ? "Medium" : "Low";
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="danger">Threat Register</Badge>
          <Text size={300}>{data.threats.length} threats · {data.trust_boundaries.length} trust boundaries</Text>
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow><TableHeaderCell>Threat</TableHeaderCell><TableHeaderCell>STRIDE</TableHeaderCell><TableHeaderCell>Risk</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow>
          </TableHeader>
          <TableBody>
            {data.threats.map((t, i) => (
              <TableRow key={i}>
                <TableCell>{t.title}</TableCell>
                <TableCell><Badge appearance="outline" size="small">{t.stride_category}</Badge></TableCell>
                <TableCell><Badge appearance="tint" color={riskColor(t.risk_score)} size="small">{riskLabel(t.risk_score)} ({t.risk_score})</Badge></TableCell>
                <TableCell><Badge appearance="tint" color={t.status === "Mitigated" ? "success" : t.status === "Accepted" ? "warning" : "danger"} size="small">{t.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.security_controls_recommended?.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <Text size={200} weight="semibold">Recommended Security Controls</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {data.security_controls_recommended.map((c, i) => <Badge key={i} appearance="tint" color="informative" size="small">{c}</Badge>)}
            </div>
          </div>
        )}
        {onContinueIn && (
          <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke3}`, display: "flex", gap: "6px" }}>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("security", `Threat register: ${data.threats.length} threats. Top risks: ${data.threats.filter(t => t.risk_score >= 9).map(t => t.title).join(", ")}`)}>Open in Security & Identity</Button>
            <Button size="small" appearance="subtle" icon={<ArrowForwardRegular />} onClick={() => onContinueIn("devsecops", `Security controls needed: ${data.security_controls_recommended?.join(", ")}`)}>Open in DevSecOps</Button>
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "pipeline_design") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">{data.platform}</Badge>
          <Badge appearance="tint" color="informative" size="small">{data.branch_strategy}</Badge>
          <Text size={300}>{data.stages.length} stages · {data.security_scans.length} security scans</Text>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
          {data.stages.map((stage, i) => (
            <div key={i} style={{ background: tokens.colorNeutralBackground3, borderRadius: "8px", padding: "8px 12px", minWidth: "120px" }}>
              <Text size={200} weight="semibold" style={{ display: "block", marginBottom: "4px" }}>{stage.name}</Text>
              {stage.jobs.map((job, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {job.is_security_gate && <span title="Security gate">🔒</span>}
                  <Text size={100}>{job.name}</Text>
                </div>
              ))}
            </div>
          ))}
        </div>
        {data.security_scans.length > 0 && (
          <div style={{ marginBottom: "8px" }}>
            <Text size={200} weight="semibold">Security Scans</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {data.security_scans.map((s, i) => (
                <Badge key={i} appearance="tint" color={s.blocking ? "danger" : "warning"} size="small">{s.type}: {s.tool}{s.blocking ? " (blocking)" : ""}</Badge>
              ))}
            </div>
          </div>
        )}
        <div><Text size={200} weight="semibold">Workload Identity: </Text><Text size={200}>{data.workload_identity}</Text></div>
        <div><Text size={200} weight="semibold">Secrets: </Text><Text size={200}>{data.secrets_management}</Text></div>
      </div>
    );
  }

  if (result.kind === "slo_framework") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">SLO Framework</Badge>
          <Badge appearance="tint" color="success" size="small">Composite SLA: {data.composite_sla}</Badge>
          <Text size={300}>{data.services.length} services</Text>
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow><TableHeaderCell>Service</TableHeaderCell><TableHeaderCell>Azure SLA</TableHeaderCell><TableHeaderCell>Customer SLO</TableHeaderCell><TableHeaderCell>Error Budget (min/mo)</TableHeaderCell></TableRow>
          </TableHeader>
          <TableBody>
            {data.services.map((s, i) => (
              <TableRow key={i}>
                <TableCell>{s.name}</TableCell><TableCell>{s.azure_sla}</TableCell><TableCell>{s.customer_slo}</TableCell>
                <TableCell>{s.error_budget_minutes.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.error_budget_alerts?.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <Text size={200} weight="semibold">Burn Rate Alerts</Text>
            {data.error_budget_alerts.map((a, i) => (
              <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
                <Text size={200}>{a.window} window · <strong>{a.burn_rate}×</strong> burn rate · {a.description}</Text>
              </div>
            ))}
          </div>
        )}
        {data.chaos_experiments?.length > 0 && (
          <Accordion collapsible style={{ marginTop: "8px" }}>
            <AccordionItem value="chaos">
              <AccordionHeader size="small">Chaos Experiments ({data.chaos_experiments.length})</AccordionHeader>
              <AccordionPanel>
                {data.chaos_experiments.map((e, i) => <div key={i}><Text size={200}>• {e}</Text></div>)}
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    );
  }

  if (result.kind === "sku_recommendation") {
    const { data } = result;
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <Badge appearance="filled" color="brand">SKU Recommendations</Badge>
          <Text size={300}>{data.recommendations.length} component{data.recommendations.length !== 1 ? "s" : ""}</Text>
        </div>
        {data.warnings?.length > 0 && (
          <div style={{ marginBottom: "10px", padding: "8px", background: "rgba(220, 130, 0, 0.1)", borderRadius: "6px", border: "1px solid rgba(220, 130, 0, 0.3)" }}>
            {data.warnings.map((w, i) => <Text key={i} size={200} style={{ display: "block" }}>⚠️ {w}</Text>)}
          </div>
        )}
        {data.recommendations.map((rec, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
              <Text size={300} weight="semibold">{rec.component}</Text>
              <Badge appearance="filled" color="brand">{rec.recommended_sku}</Badge>
              {rec.vcpu && <Badge appearance="tint" color="informative" size="small">{rec.vcpu} vCPU</Badge>}
              {rec.memory_gb && <Badge appearance="tint" color="informative" size="small">{rec.memory_gb}GB RAM</Badge>}
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>{rec.reasoning}</Text>
            {rec.autoscale && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
                Autoscale: {rec.autoscale.min}–{rec.autoscale.max} instances · trigger: {rec.autoscale.scale_trigger}
              </Text>
            )}
            {rec.alternatives?.length > 0 && (
              <Accordion collapsible style={{ marginTop: "4px" }}>
                <AccordionItem value={`alt-${i}`}>
                  <AccordionHeader size="small">Alternatives ({rec.alternatives.length})</AccordionHeader>
                  <AccordionPanel>
                    {rec.alternatives.map((alt, j) => (
                      <div key={j} style={{ padding: "4px 0" }}>
                        <Badge appearance="outline" size="small">{alt.sku}</Badge>
                        <Text size={200}> · {alt.trade_off} · {alt.monthly_delta >= 0 ? "+" : ""}${alt.monthly_delta}/mo</Text>
                      </div>
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        ))}
        {data.sizing_assumptions?.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <Text size={200} weight="semibold">Assumptions</Text>
            {data.sizing_assumptions.map((a, i) => <div key={i}><Text size={200}>• {a}</Text></div>)}
          </div>
        )}
      </div>
    );
  }

  if (result.kind === "region_comparison") return <RegionComparisonCard data={result.data} />;
  if (result.kind === "practice_exam_pack") return <PracticeExamPackCard data={result.data} />;
  if (result.kind === "stakeholder_plan") return <StakeholderPlanCard data={result.data} />;
  if (result.kind === "decision_card") return <DecisionCardCard data={result.data} />;
  if (result.kind === "terraform_files") return <IacFilesCard data={result.data} label="Terraform" color="brand" zipBase="terraform" />;
  if (result.kind === "arm_files") return <IacFilesCard data={result.data} label="ARM Template" color="informative" zipBase="arm" />;
  if (result.kind === "cicd_files") return <CicdFilesCard data={result.data} />;
  if (result.kind === "cost_alerts") return <CostAlertsCard data={result.data} />;
  if (result.kind === "security_posture") return <SecurityPostureCard data={result.data} />;
  if (result.kind === "multicloud_comparison") return <MulticloudComparisonCard data={result.data} />;

  return null;
}

function ServiceComparisonCard({ data }: { data: ServiceComparison }) {
  const styles = useCardStyles();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyComparisonAsMarkdown(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resolveValue(values: Record<string, string> | undefined, key: string): string {
    if (!values) return "—";
    if (key in values) return values[key];
    const lower = key.toLowerCase();
    for (const k of Object.keys(values)) {
      if (k.toLowerCase() === lower) return values[k];
    }
    for (const k of Object.keys(values)) {
      if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return values[k];
    }
    const vals = Object.values(values);
    return vals.length === 1 ? vals[0] : "—";
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="tint" color="informative">Comparison</Badge>
          {data.services.map((s, i) => <Badge key={i} appearance="tint" size="small">{s}</Badge>)}
        </div>
        <div className={styles.cardActions}>
          <Button
            appearance="subtle"
            size="small"
            icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
            onClick={handleCopy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Menu>
            <MenuTrigger>
              <Button appearance="subtle" size="small" icon={<ArrowDownloadRegular />}>Export</Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={() => exportComparisonSvg(data)}>Download SVG</MenuItem>
                <MenuItem onClick={() => exportComparisonPng(data)}>Download PNG</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>
      <Table size="small" className={styles.cardTable}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Dimension</TableHeaderCell>
            {data.services.map((s) => <TableHeaderCell key={s}>{s}</TableHeaderCell>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.comparison_rows.map((row, i) => (
            <TableRow key={i} className={i % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd}>
              <TableCell><Text size={200} weight="semibold">{row.dimension}</Text></TableCell>
              {data.services.map((s) => <TableCell key={s}><Text size={200}>{resolveValue(row.values, s)}</Text></TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div style={{ marginTop: "10px" }}>
        <Text size={200} weight="semibold">Recommendation</Text>
        <Text size={200} block style={{ marginTop: "4px" }}>{data.recommendation}</Text>
      </div>
    </div>
  );
}

function RegionComparisonCard({ data }: { data: RegionComparison }) {
  const styles = useCardStyles();
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <Badge appearance="filled" color="brand">Region Comparison</Badge>
        <Text size={300}>{data.regions.length} region{data.regions.length !== 1 ? "s" : ""}</Text>
      </div>
      <div style={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell><Text size={200} weight="semibold">Region</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">AZs</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">Data Residency</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">Paired Region</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">Latency</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">Cost Delta</Text></TableHeaderCell>
              <TableHeaderCell><Text size={200} weight="semibold">Compliance</Text></TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.regions.map((r, i) => (
              <TableRow key={i}>
                <TableCell><Text size={200} weight="semibold">{r.region_name}</Text><br /><Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{r.geography}</Text></TableCell>
                <TableCell><Text size={200}>{r.az_count}</Text></TableCell>
                <TableCell><Text size={200}>{r.data_residency}</Text></TableCell>
                <TableCell><Text size={200}>{r.paired_region}</Text></TableCell>
                <TableCell><Badge appearance="tint" color={r.latency_tier === "Low" ? "success" : r.latency_tier === "High" ? "danger" : "warning"} size="small">{r.latency_tier}</Badge></TableCell>
                <TableCell><Text size={200}>{r.cost_delta}</Text></TableCell>
                <TableCell>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
                    {r.compliance_certs.map((c, j) => <Badge key={j} appearance="outline" size="small">{c}</Badge>)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div style={{ marginTop: "10px", padding: "8px", background: "rgba(0,120,212,0.07)", borderRadius: "6px" }}>
        <Text size={200} weight="semibold">Recommendation: </Text>
        <Text size={200}>{data.recommendation}</Text>
      </div>
      {data.notes?.map((n, i) => <Text key={i} size={200} block style={{ marginTop: "4px", color: tokens.colorNeutralForeground3 }}>• {n}</Text>)}
    </div>
  );
}

function PracticeExamPackCard({ data }: { data: PracticeExamPack }) {
  const styles = useCardStyles();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Record<number, string>>({});
  const correct = Object.entries(selected).filter(([i, ans]) => ans === data.questions[+i]?.correct).length;

  function toggle(i: number) {
    setRevealed(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <Badge appearance="filled" color="brand">Practice Exam</Badge>
        <Text size={300}>{data.exam} · {data.questions.length} questions</Text>
        {Object.keys(selected).length > 0 && (
          <Badge appearance="tint" color={correct / Object.keys(selected).length >= 0.7 ? "success" : "warning"}>
            {correct}/{Object.keys(selected).length} correct
          </Badge>
        )}
      </div>
      {data.questions.map((q, i) => {
        const isRevealed = revealed.has(i);
        const userAns = selected[i];
        return (
          <div key={i} style={{ marginBottom: "14px", padding: "10px", background: tokens.colorNeutralBackground3, borderRadius: "8px" }}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
              <Badge appearance="tint" color="informative" size="small">Q{i + 1}</Badge>
              <Badge appearance="outline" size="small">{q.domain}</Badge>
            </div>
            <Text size={300} weight="semibold" block style={{ marginBottom: "8px" }}>{q.question}</Text>
            {(["A", "B", "C", "D"] as const).map(letter => {
              const isCorrect = letter === q.correct;
              const isSelected = userAns === letter;
              let bg = "transparent";
              if (isRevealed && isCorrect) bg = "rgba(0,180,0,0.12)";
              else if (isRevealed && isSelected && !isCorrect) bg = "rgba(220,0,0,0.10)";
              return (
                <div
                  key={letter}
                  onClick={() => { if (!isRevealed) setSelected(prev => ({ ...prev, [i]: letter })); }}
                  style={{ padding: "6px 10px", marginBottom: "4px", borderRadius: "6px", cursor: isRevealed ? "default" : "pointer", background: isSelected && !isRevealed ? "rgba(0,120,212,0.12)" : bg, border: `1px solid ${isSelected && !isRevealed ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}` }}
                >
                  <Text size={200}><strong>{letter}.</strong> {q.choices[letter]}</Text>
                  {isRevealed && isCorrect && <Badge appearance="filled" color="success" size="small" style={{ marginLeft: "6px" }}>✓</Badge>}
                </div>
              );
            })}
            <Button size="small" appearance="subtle" onClick={() => toggle(i)} style={{ marginTop: "4px" }}>
              {isRevealed ? "Hide Answer" : "Reveal Answer"}
            </Button>
            {isRevealed && (
              <div style={{ marginTop: "6px", padding: "8px", background: "rgba(0,120,212,0.07)", borderRadius: "6px" }}>
                <Text size={200} weight="semibold">Correct: {q.correct}. </Text>
                <Text size={200}>{q.explanation}</Text>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StakeholderPlanCard({ data }: { data: StakeholderPlan }) {
  const styles = useCardStyles();
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <Badge appearance="filled" color="brand">Stakeholder Communication Plan</Badge>
        <Text size={300}>{data.audiences.length} audience{data.audiences.length !== 1 ? "s" : ""}</Text>
      </div>
      <div style={{ marginBottom: "10px", padding: "8px", background: tokens.colorNeutralBackground3, borderRadius: "6px" }}>
        <Text size={200} weight="semibold">Situation Summary</Text>
        <Text size={200} block style={{ marginTop: "4px" }}>{data.situation_summary}</Text>
      </div>
      <Accordion collapsible multiple>
        {data.audiences.map((aud, i) => (
          <AccordionItem key={i} value={`aud-${i}`}>
            <AccordionHeader>{aud.name}</AccordionHeader>
            <AccordionPanel>
              <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Talking Points</Text>
              {aud.talking_points.map((tp, j) => <div key={j}><Text size={200}>• {tp}</Text></div>)}
              {aud.objections_and_responses.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Objections & Responses</Text>
                  {aud.objections_and_responses.map((or_, j) => (
                    <div key={j} style={{ marginBottom: "6px", padding: "6px", background: tokens.colorNeutralBackground4, borderRadius: "4px" }}>
                      <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }} block>Q: {or_.objection}</Text>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground1 }} block>A: {or_.response}</Text>
                    </div>
                  ))}
                </div>
              )}
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
      {data.recommended_actions.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <Text size={200} weight="semibold" block>Recommended Actions</Text>
          <ol style={{ margin: "4px 0", paddingLeft: "18px" }}>
            {data.recommended_actions.map((a, i) => <li key={i}><Text size={200}>{a}</Text></li>)}
          </ol>
        </div>
      )}
      {data.timeline && <Text size={200} block style={{ marginTop: "6px", color: tokens.colorNeutralForeground3 }}>Timeline: {data.timeline}</Text>}
    </div>
  );
}

function DecisionCardCard({ data }: { data: DecisionCard }) {
  const styles = useCardStyles();
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <Badge appearance="filled" color="success">Recommendation</Badge>
      </div>
      <div style={{ marginBottom: "10px", padding: "10px", background: "rgba(0,180,0,0.08)", borderRadius: "6px", border: "1px solid rgba(0,180,0,0.2)" }}>
        <Text size={400} weight="semibold">{data.recommendation}</Text>
      </div>
      <Text size={200} block style={{ marginBottom: "10px" }}>{data.rationale}</Text>
      {data.tradeoffs.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Trade-offs</Text>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell><Text size={200} weight="semibold">Aspect</Text></TableHeaderCell>
                <TableHeaderCell><Text size={200} weight="semibold">Detail</Text></TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tradeoffs.map((t, i) => (
                <TableRow key={i}>
                  <TableCell><Text size={200} weight="semibold">{t.aspect}</Text></TableCell>
                  <TableCell><Text size={200}>{t.detail}</Text></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.when_to_reconsider.length > 0 && (
        <div>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>When to Reconsider</Text>
          {data.when_to_reconsider.map((w, i) => <div key={i}><Text size={200}>⚠️ {w}</Text></div>)}
        </div>
      )}
    </div>
  );
}

// ── IaC / CI/CD multi-file cards ────────────────────────────────────────────

function MultiFileBlock({ files }: { files: Record<string, string> }) {
  const names = Object.keys(files);
  const [active, setActive] = useState<string>(names[0] ?? "");
  const [copied, setCopied] = useState(false);
  if (names.length === 0) return null;
  const current = files[active] ?? "";

  function copyActive() {
    navigator.clipboard.writeText(current).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px", alignItems: "center" }}>
        {names.map((name) => (
          <Button
            key={name}
            size="small"
            appearance={name === active ? "primary" : "subtle"}
            onClick={() => setActive(name)}
          >
            {name}
          </Button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          <Button
            size="small"
            appearance="subtle"
            icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
            onClick={copyActive}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowDownloadRegular />}
            onClick={() => downloadTextFile(active, current)}
          >
            Download
          </Button>
        </div>
      </div>
      <pre
        style={{
          background: tokens.colorNeutralBackground3,
          padding: "10px 12px",
          borderRadius: "6px",
          overflowX: "auto",
          fontSize: "12px",
          margin: 0,
          maxHeight: "420px",
        }}
      >
        <code data-lang={languageFromFilename(active)}>{current}</code>
      </pre>
    </div>
  );
}

function IacFilesCard({
  data, label, color, zipBase,
}: {
  data: TerraformFilesResult | ArmFilesResult;
  label: string;
  color: "brand" | "informative";
  zipBase: string;
}) {
  const styles = useCardStyles();
  const fileCount = Object.keys(data.files ?? {}).length;
  const slug = (data.pattern_name || zipBase).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="filled" color={color}>{label}</Badge>
          {data.pattern_name && <Badge appearance="tint" size="small">{data.pattern_name}</Badge>}
          <Text size={300}>{fileCount} file{fileCount !== 1 ? "s" : ""}</Text>
        </div>
        <div className={styles.cardActions}>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowDownloadRegular />}
            onClick={() => downloadFilesAsZip(`${slug || zipBase}-${zipBase}`, data.files)}
          >
            Download .zip
          </Button>
        </div>
      </div>
      <MultiFileBlock files={data.files} />
      {(data.notes?.length ?? 0) > 0 && (
        <div style={{ marginTop: "10px" }}>
          <Text size={200} weight="semibold">Notes</Text>
          <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>
            {data.notes!.map((n, i) => <li key={i}><Text size={200}>{n}</Text></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function CicdFilesCard({ data }: { data: CicdFilesResult }) {
  const styles = useCardStyles();
  const fileCount = Object.keys(data.files ?? {}).length;
  const platformLabel = data.platform === "azure_devops" ? "Azure DevOps" : "GitHub Actions";
  const slug = (data.pattern_name || data.platform || "pipeline").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="filled" color="brand">{platformLabel}</Badge>
          {data.environment && <Badge appearance="tint" color="informative" size="small">{data.environment}</Badge>}
          {data.deploy_method && <Badge appearance="outline" size="small">{data.deploy_method}</Badge>}
          {data.pattern_name && <Badge appearance="tint" size="small">{data.pattern_name}</Badge>}
          <Text size={300}>{fileCount} pipeline file{fileCount !== 1 ? "s" : ""}</Text>
        </div>
        <div className={styles.cardActions}>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowDownloadRegular />}
            onClick={() => downloadFilesAsZip(`${slug}-pipelines`, data.files)}
          >
            Download .zip
          </Button>
        </div>
      </div>
      <MultiFileBlock files={data.files} />
    </div>
  );
}

// ── Cost alerts (budgets + bicep) ───────────────────────────────────────────

function CostAlertsCard({ data }: { data: CostAlertsResult }) {
  const styles = useCardStyles();
  const [copied, setCopied] = useState(false);
  if (data.error) {
    return (
      <div className={styles.card}>
        <Badge appearance="filled" color="danger">Cost Alerts</Badge>
        <Text size={200} block style={{ marginTop: "8px", color: tokens.colorPaletteRedForeground1 }}>{data.error}</Text>
      </div>
    );
  }
  function copyBicep() {
    if (!data.bicep) return;
    navigator.clipboard.writeText(data.bicep).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="filled" color="success">Budget &amp; Alerts</Badge>
          {data.monthly_budget_usd != null && (
            <Badge appearance="tint" color="success">${Math.round(data.monthly_budget_usd).toLocaleString()}/mo</Badge>
          )}
          {data.subscription_id && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>sub: {data.subscription_id}</Text>
          )}
        </div>
      </div>

      {(data.thresholds?.length ?? 0) > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Alert Thresholds</Text>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {data.thresholds!.map((t, i) => (
              <Badge
                key={i}
                appearance="tint"
                size="small"
                color={t >= 100 ? "danger" : t >= 80 ? "warning" : "informative"}
              >
                {t}%
              </Badge>
            ))}
          </div>
        </div>
      )}

      {(data.resources?.length ?? 0) > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Azure Resources</Text>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {data.resources!.map((r, i) => <Badge key={i} appearance="outline" size="small">{r}</Badge>)}
          </div>
        </div>
      )}

      {data.bicep && (
        <Accordion collapsible defaultOpenItems={["bicep"]} style={{ marginTop: "8px" }}>
          <AccordionItem value="bicep">
            <AccordionHeader size="small">budget.bicep</AccordionHeader>
            <AccordionPanel>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "4px", marginBottom: "4px" }}>
                <Button size="small" appearance="subtle" icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={copyBicep}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button size="small" appearance="subtle" icon={<ArrowDownloadRegular />} onClick={() => downloadTextFile("budget.bicep", data.bicep!)}>
                  Download
                </Button>
              </div>
              <pre style={{ background: tokens.colorNeutralBackground3, padding: "10px 12px", borderRadius: "6px", overflowX: "auto", fontSize: "12px", margin: 0, maxHeight: "320px" }}>
                <code>{data.bicep}</code>
              </pre>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {data.deploy_command && (
        <div style={{ marginTop: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Deploy</Text>
          <pre style={{ background: tokens.colorNeutralBackground3, padding: "8px 10px", borderRadius: "6px", overflowX: "auto", fontSize: "12px", margin: 0 }}>
            <code>{data.deploy_command}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Security posture ────────────────────────────────────────────────────────

function SecurityPostureCard({ data }: { data: SecurityPostureResult }) {
  const styles = useCardStyles();
  if (data.error) {
    return (
      <div className={styles.card}>
        <Badge appearance="filled" color="danger">Security Posture</Badge>
        <Text size={200} block style={{ marginTop: "8px", color: tokens.colorPaletteRedForeground1 }}>{data.error}</Text>
      </div>
    );
  }
  const score = data.score ?? 0;
  const scoreColor: "success" | "warning" | "danger" =
    score >= 80 ? "success" : score >= 60 ? "warning" : "danger";
  const sevColor = (sev: string): "danger" | "warning" | "success" | "informative" => {
    const s = (sev || "").toLowerCase();
    if (s === "critical" || s === "high") return "danger";
    if (s === "medium") return "warning";
    if (s === "low") return "success";
    return "informative";
  };
  const findings = data.top_findings ?? [];
  const recs = data.recommendations ?? [];
  const incidents = data.incidents ?? [];
  const breakdown = Object.entries(data.severity_breakdown ?? {});

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="filled" color={scoreColor}>Security Posture</Badge>
          <Badge appearance="tint" color={scoreColor}>{score.toFixed(1)}/100</Badge>
          {data.subscription_id && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>sub: {data.subscription_id}</Text>
          )}
        </div>
      </div>

      {data.summary && (
        <Text size={200} block style={{ marginBottom: "10px" }}>{data.summary}</Text>
      )}

      {breakdown.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Severity Breakdown</Text>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {breakdown.map(([sev, count]) => (
              <Badge key={sev} appearance="tint" color={sevColor(sev)} size="small">{sev}: {count}</Badge>
            ))}
          </div>
        </div>
      )}

      {findings.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Text size={200} weight="semibold" block style={{ marginBottom: "4px" }}>Top Findings ({findings.length})</Text>
          <Table size="small" className={styles.cardTable}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Severity</TableHeaderCell>
                <TableHeaderCell>Resource</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((f, i) => (
                <TableRow key={i}>
                  <TableCell><Text size={200}>{(f.title as string) || (f.display_name as string) || (f.id as string) || "—"}</Text></TableCell>
                  <TableCell><Badge appearance="tint" color={sevColor(f.severity ?? "")} size="small">{f.severity ?? "—"}</Badge></TableCell>
                  <TableCell><Text size={200}>{(f.resource as string) || "—"}</Text></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {recs.length > 0 && (
        <Accordion collapsible style={{ marginTop: "4px" }}>
          <AccordionItem value="recs">
            <AccordionHeader size="small">Defender Recommendations ({recs.length})</AccordionHeader>
            <AccordionPanel>
              <Table size="extra-small" className={styles.cardTable}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Recommendation</TableHeaderCell>
                    <TableHeaderCell>Severity</TableHeaderCell>
                    <TableHeaderCell>Resource</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recs.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell><Text size={200}>{r.display_name || r.id || "—"}</Text></TableCell>
                      <TableCell><Badge appearance="tint" color={sevColor(r.severity ?? "")} size="small">{r.severity ?? "—"}</Badge></TableCell>
                      <TableCell><Text size={200}>{r.resource || r.category || "—"}</Text></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {incidents.length > 0 && (
        <Accordion collapsible style={{ marginTop: "4px" }}>
          <AccordionItem value="incidents">
            <AccordionHeader size="small">Sentinel Incidents ({incidents.length})</AccordionHeader>
            <AccordionPanel>
              {incidents.map((inc, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <Badge appearance="tint" color={sevColor(inc.severity ?? "")} size="small">{inc.severity ?? "—"}</Badge>
                    <Text size={200} weight="semibold">{inc.title || inc.id || "—"}</Text>
                  </div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {inc.status ?? ""}{inc.created_time ? ` · ${inc.created_time}` : ""}
                  </Text>
                </div>
              ))}
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

// ── Multicloud comparison (two shapes: service map OR decision matrix) ──────

function MulticloudComparisonCard({ data }: { data: MulticloudComparisonResult }) {
  const styles = useCardStyles();
  if (data.error) {
    return (
      <div className={styles.card}>
        <Badge appearance="filled" color="danger">Multicloud Comparison</Badge>
        <Text size={200} block style={{ marginTop: "8px", color: tokens.colorPaletteRedForeground1 }}>{data.error}</Text>
      </div>
    );
  }

  const isMatrix = !!data.workload_type;

  if (isMatrix) {
    const criteria = data.criteria ?? Array.from(new Set([
      ...Object.keys(data.azure ?? {}),
      ...Object.keys(data.aws ?? {}),
      ...Object.keys(data.gcp ?? {}),
    ]));
    const clouds: Array<{ key: "azure" | "aws" | "gcp"; label: string; color: "brand" | "informative" | "warning" }> = [
      { key: "azure", label: "Azure", color: "brand" },
      { key: "aws", label: "AWS", color: "warning" },
      { key: "gcp", label: "GCP", color: "informative" },
    ];
    return (
      <div className={styles.card}>
        <div className={styles.cardTitle}>
          <div className={styles.cardTitleBadges}>
            <Badge appearance="filled" color="brand">Multicloud Decision Matrix</Badge>
            <Badge appearance="tint" size="small">{data.workload_type}</Badge>
          </div>
        </div>
        <Table size="small" className={styles.cardTable}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Criterion</TableHeaderCell>
              {clouds.map(c => <TableHeaderCell key={c.key}>{c.label}</TableHeaderCell>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {criteria.map((crit, i) => {
              const scores = clouds.map(c => (data[c.key] as Record<string, number> | undefined)?.[crit] ?? 0);
              const max = Math.max(...scores);
              return (
                <TableRow key={i} className={i % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd}>
                  <TableCell><Text size={200} weight="semibold">{crit}</Text></TableCell>
                  {clouds.map((c, j) => {
                    const v = scores[j];
                    const isMax = v > 0 && v === max;
                    return (
                      <TableCell key={c.key}>
                        <Badge appearance={isMax ? "filled" : "tint"} color={isMax ? c.color : "informative"} size="small">
                          {v || "—"}
                        </Badge>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {data.notes && (
          <div style={{ marginTop: "10px", padding: "8px", background: "rgba(0,120,212,0.07)", borderRadius: "6px" }}>
            <Text size={200}>{data.notes}</Text>
          </div>
        )}
      </div>
    );
  }

  // Service-map shape
  const matches = data.matches ?? {};
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <div className={styles.cardTitleBadges}>
          <Badge appearance="filled" color="brand">Service Equivalents</Badge>
          {data.azure_service && <Badge appearance="tint" size="small">{data.azure_service}</Badge>}
          {data.category && <Badge appearance="outline" size="small">{data.category}</Badge>}
        </div>
      </div>
      <Table size="small" className={styles.cardTable}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Cloud</TableHeaderCell>
            <TableHeaderCell>Equivalent Service</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell><Badge appearance="filled" color="brand" size="small">Azure</Badge></TableCell>
            <TableCell><Text size={200} weight="semibold">{data.azure_service ?? "—"}</Text></TableCell>
          </TableRow>
          {Object.entries(matches).map(([cloud, svc]) => (
            <TableRow key={cloud}>
              <TableCell><Badge appearance="tint" size="small">{cloud.toUpperCase()}</Badge></TableCell>
              <TableCell><Text size={200}>{svc || "—"}</Text></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.why_azure && (
        <div style={{ marginTop: "10px", padding: "8px", background: "rgba(0,120,212,0.07)", borderRadius: "6px" }}>
          <Text size={200} weight="semibold">Why Azure: </Text>
          <Text size={200}>{data.why_azure}</Text>
        </div>
      )}
      {data.note && (
        <Text size={200} block style={{ marginTop: "6px", color: tokens.colorNeutralForeground3 }}>{data.note}</Text>
      )}
    </div>
  );
}
