import {
  makeStyles,
  tokens,
  Button,
  Text,
  Badge,
} from "@fluentui/react-components";
import {
  WeatherMoonRegular,
  WeatherSunnyRegular,
  HistoryRegular,
  AppsRegular,
  SettingsRegular,
  GlobeRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";
import type { WorkloadContext } from "../types";
import type { SaveStatus } from "../hooks/useConversationHistory";
import { hasContext } from "../hooks/useWorkloadContext";
import { useAuth } from "../auth/AuthProvider";

const MODE_LABELS: Record<Mode, string> = {
  qa: "Expert Q&A",
  architecture: "Architecture Design",
  reference: "Reference Library",
  compare: "Service Comparison",
  waf: "WAF Assessment",
  review: "Architecture Review",
  compliance: "Compliance Mapping",
  migration: "Migration Assessment",
  regional: "Regional Advisor",
  cost: "Cost Optimization",
  drbc: "DR/BC Design",
  monitoring: "Monitoring Config",
  situation: "Situation Advisor",
  presentation: "Presentation Coach",
  certprep: "Cert Prep",
  learningplan: "Learning Plan",
  codegen: "Code Generator",
  pipelineforge: "Pipeline Forge",
  runbookstudio: "Runbook Studio",
  namingstandards: "Naming Standards",
  rfpproposal: "RFP / Proposal Writer",
  bootstrap: "Bootstrapper",
  aiarchitecture: "AI Architecture",
  dataplatform: "Data Platform",
  apim: "API Management",
  network: "Network Design",
  landingzone: "Landing Zone",
  identity: "Identity & Access",
  threatmodel: "Threat Modeling",
  devsecops: "DevSecOps",
  reliability: "Reliability & SLO",
  troubleshoot: "Troubleshoot",
  security: "Security & Identity",
  governance: "Governance",
  ops: "Observability & SRE",
  intake: "Requirements Studio",
  intakechat: "Guided Discovery",
  analyze: "Workload Analysis",
  whatsnew: "What's New",
  servicehealth: "Service Health",
  modellifecycle: "Model Lifecycle",
  strategy: "Strategy Builder",
  admin: "Usage Metrics",
  datapipelineadvisor: "Pipeline Advisor",
  fabricplanner: "Fabric Capacity Planner",
  adfpipeline: "ADF Pipeline Generator",
  medalliondesigner: "Medallion Schema Designer",
  modelmigration: "Migration Advisor",
  showcase: "Demo Showcase",
  refarch: "Reference Architectures",
  netvnet: "VNet & Subnet Architect",
  netfirewall: "Firewall Engineer",
  netsecurity: "Network Security",
  nethybrid: "Hybrid Connectivity",
  netprivatelink: "Private Link & Endpoints",
  netvwan: "Virtual WAN",
  netdns: "DNS Specialist",
  netmonitor: "Network Monitor",
  nettroubleshoot: "Network Troubleshooter",
  netiac: "Network IaC",
  netpricing: "Network Pricing",
  compsku: "VM SKU Selector",
  compscale: "Scale-Set & Autoscale",
  compdisk: "Managed Disk & Storage",
  compha: "High Availability",
  compdr: "VM Disaster Recovery",
  compperf: "Performance Tuning",
  compmonitor: "Compute Monitoring",
  comptroubleshoot: "VM Troubleshooter",
  compsecurity: "VM Security",
  compcost: "Compute Cost Analyst",
  aifoundry: "AI Foundry Architect",
  aimodel: "Model Selection Advisor",
  airag: "RAG Architect",
  aiagents: "AI Agents Specialist",
  aifinetune: "Fine-Tuning Specialist",
  aimlops: "MLOps Engineer",
  aieval: "AI Evaluation",
  aisafety: "Responsible AI & Safety",
  aicost: "AI Cost Analyst",
  aiiac: "AI Workload IaC",
  datalake: "Data Lake Architect",
  datawarehouse: "Data Warehouse",
  datastream: "Streaming Specialist",
  datalakehouse: "Lakehouse Specialist",
  datagovernance: "Data Governance (Purview)",
  datasecurity: "Data Security",
  datamigration: "Database Migration",
  datacost: "Data Cost Analyst",
  dataquality: "Data Quality",
  dataiac: "Data Platform IaC",
};

const MODE_SECTION: Partial<Record<Mode, string>> = {
  intake: "Advisory",
  analyze: "Advisory",
  qa: "Advisory",
  situation: "Advisory",
  presentation: "Advisory",
  certprep: "Advisory",
  learningplan: "Advisory",
  regional: "Advisory",
  rfpproposal: "Advisory",
  architecture: "Design & Build",
  reference: "Design & Build",
  compare: "Design & Build",
  bootstrap: "Design & Build",
  network: "Design & Build",
  pipelineforge: "Design & Build",
  namingstandards: "Design & Build",
  aiarchitecture: "Design & Build",
  landingzone: "Platform & Governance",
  identity: "Platform & Governance",
  devsecops: "Platform & Governance",
  apim: "Platform & Governance",
  waf: "Assessment",
  review: "Assessment",
  compliance: "Assessment",
  migration: "Assessment",
  threatmodel: "Assessment",
  reliability: "Assessment",
  cost: "Operations",
  monitoring: "Operations",
  drbc: "Operations",
  codegen: "Operations",
  runbookstudio: "Operations",
  dataplatform: "Operations",
  whatsnew: "Communications",
  servicehealth: "Communications",
  modellifecycle: "Communications",
  modelmigration: "Communications",
  showcase: "Communications",
  strategy: "Design & Build",
  datapipelineadvisor: "Data Engineering",
  fabricplanner: "Data Engineering",
  adfpipeline: "Data Engineering",
  medalliondesigner: "Data Engineering",
  netvnet: "Networking",
  netfirewall: "Networking",
  netsecurity: "Networking",
  nethybrid: "Networking",
  netprivatelink: "Networking",
  netvwan: "Networking",
  netdns: "Networking",
  netmonitor: "Networking",
  nettroubleshoot: "Networking",
  netiac: "Networking",
  netpricing: "Networking",
  compsku: "Compute",
  compscale: "Compute",
  compdisk: "Compute",
  compha: "Compute",
  compdr: "Compute",
  compperf: "Compute",
  compmonitor: "Compute",
  comptroubleshoot: "Compute",
  compsecurity: "Compute",
  compcost: "Compute",
  aifoundry: "AI",
  aimodel: "AI",
  airag: "AI",
  aiagents: "AI",
  aifinetune: "AI",
  aimlops: "AI",
  aieval: "AI",
  aisafety: "AI",
  aicost: "AI",
  aiiac: "AI",
  datalake: "Data",
  datawarehouse: "Data",
  datastream: "Data",
  datalakehouse: "Data",
  datagovernance: "Data",
  datasecurity: "Data",
  datamigration: "Data",
  datacost: "Data",
  dataquality: "Data",
  dataiac: "Data",
};

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    height: "56px",
    flexShrink: 0,
    background: "var(--gradient-header)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    boxShadow: "0 1px 0 rgba(0,120,212,0.35)",
    gap: "14px",
    position: "relative",
    zIndex: 10,
  },
  accentLine: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "2px",
    background: "var(--gradient-accent)",
    opacity: 0.9,
    pointerEvents: "none",
  },
  brandIcon: {
    color: "#0078D4",
    fontSize: "20px",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    filter: "drop-shadow(0 0 6px rgba(0,120,212,0.5))",
  },
  brand: {
    fontWeight: 700,
    fontSize: "15px",
    letterSpacing: "-0.2px",
    background: "var(--gradient-azure)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    whiteSpace: "nowrap",
    userSelect: "none",
    flexShrink: 0,
  },
  divider: {
    width: "1px",
    height: "18px",
    background: "rgba(255,255,255,0.1)",
    flexShrink: 0,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
  },
  section: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  chevron: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    flexShrink: 0,
  },
  modeLabel: {
    fontSize: "13px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  contextBadge: {
    fontSize: "11px",
    cursor: "pointer",
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    gap: "2px",
    alignItems: "center",
    flexShrink: 0,
  },
  userName: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    paddingRight: "4px",
    whiteSpace: "nowrap",
  },
  saveIndicator: {
    fontSize: "11px",
    whiteSpace: "nowrap",
    paddingRight: "6px",
    transition: "opacity 0.3s",
  },
});

interface HeaderProps {
  mode: Mode;
  darkMode: boolean;
  onToggleDark: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenContext: () => void;
  workloadContext?: WorkloadContext;
  saveStatus?: SaveStatus;
}

export default function Header({ mode, darkMode, onToggleDark, onOpenHistory, onOpenSettings, onOpenContext, workloadContext, saveStatus }: HeaderProps) {
  const styles = useStyles();
  const section = MODE_SECTION[mode];
  const { account, logout, enabled: authEnabled } = useAuth();
  const firstName = account?.name?.split(" ")[0] ?? account?.username?.split("@")[0] ?? null;
  const contextActive = workloadContext ? hasContext(workloadContext) : false;
  const contextLabel = contextActive && workloadContext
    ? [workloadContext.region, workloadContext.complianceFramework, workloadContext.budgetRange]
        .filter(Boolean).join(" · ")
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.accentLine} />
      <span className={styles.brandIcon}><AppsRegular /></span>
      <span className={styles.brand}>Azure Architect AI</span>
      <div className={styles.divider} />
      <div className={styles.breadcrumb}>
        {section && <Text className={styles.section}>{section}</Text>}
        {section && <span className={styles.chevron}>›</span>}
        <Text className={styles.modeLabel}>{MODE_LABELS[mode]}</Text>
      </div>
      <div className={styles.actions}>
        {saveStatus === "saving" && (
          <Text className={styles.saveIndicator} style={{ color: tokens.colorNeutralForeground3 }}>Saving…</Text>
        )}
        {saveStatus === "saved" && (
          <Text className={styles.saveIndicator} style={{ color: tokens.colorStatusSuccessForeground1 }}>Saved ✓</Text>
        )}
        {contextActive && contextLabel && (
          <Badge
            appearance="tint"
            color="brand"
            className={styles.contextBadge}
            onClick={onOpenContext}
            title="Active workload context — click to edit"
          >
            {contextLabel}
          </Badge>
        )}
        {authEnabled && firstName && (
          <>
            <Text className={styles.userName}>{firstName}</Text>
            <Button
              appearance="subtle"
              size="small"
              icon={<SignOutRegular />}
              onClick={logout}
              title="Sign out"
            />
          </>
        )}
        <Button
          appearance="subtle"
          size="small"
          icon={<GlobeRegular />}
          onClick={onOpenContext}
          title="Workload context"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<HistoryRegular />}
          onClick={onOpenHistory}
          title="Conversation history"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<SettingsRegular />}
          onClick={onOpenSettings}
          title="Settings"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={darkMode ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
          onClick={onToggleDark}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        />
      </div>
    </header>
  );
}
