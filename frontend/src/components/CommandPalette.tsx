import { useEffect, useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Input,
  Text,
  Badge,
} from "@fluentui/react-components";
import { SearchRegular, DismissRegular, StarFilled } from "@fluentui/react-icons";
import type { Mode } from "../types";

const MODE_LABELS: Record<Mode, string> = {
  ask: "Ask",
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
  "cost-optimize": "Cost Optimize",
  "demo-build": "Demo Builder",
  whatsnew: "What's New",
  servicehealth: "Service Health",
  modellifecycle: "Model Lifecycle",
  strategy: "Strategy Builder",
  admin: "Usage Metrics",
  datapipelineadvisor: "Pipeline Advisor",
  fabricplanner: "Fabric Capacity Planner",
  adfpipeline: "ADF Pipeline Generator",
  medalliondesigner: "Medallion Schema Designer",
  modelmigration: "Model IQ",
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
  architect: "Architect",
  operations: "Operations",
  engagement: "Engagement Hub",
};

const MODE_SECTION: Partial<Record<Mode, string>> = {
  qa: "Advise", situation: "Advise", certprep: "Advise", regional: "Advise",
  compare: "Advise", governance: "Advise", compliance: "Advise",
  identity: "Advise", security: "Advise", devsecops: "Advise",
  migration: "Advise", cost: "Advise", monitoring: "Advise", ops: "Advise",
  learningplan: "Advise", presentation: "Advise",
  architecture: "Design", network: "Design", aiarchitecture: "Design",
  dataplatform: "Design", apim: "Design", landingzone: "Design",
  namingstandards: "Design", "demo-build": "Design", refarch: "Design", showcase: "Design",
  intake: "Plan", intakechat: "Plan", analyze: "Plan", "cost-optimize": "Plan", strategy: "Plan",
  waf: "Assess", review: "Assess", threatmodel: "Assess", drbc: "Assess", reliability: "Assess",
  codegen: "Build & Run", pipelineforge: "Build & Run", runbookstudio: "Build & Run", troubleshoot: "Build & Run",
  whatsnew: "Updates", servicehealth: "Updates", modellifecycle: "Updates",
  modelmigration: "Reports",
  architect: "Agents", operations: "Agents", engagement: "Agents",
  netvnet: "Network Desk", netfirewall: "Network Desk", netsecurity: "Network Desk",
  nethybrid: "Network Desk", netprivatelink: "Network Desk", netvwan: "Network Desk",
  netdns: "Network Desk", netmonitor: "Network Desk", nettroubleshoot: "Network Desk",
  netiac: "Network Desk", netpricing: "Network Desk",
  compsku: "Compute Desk", compscale: "Compute Desk", compdisk: "Compute Desk",
  compha: "Compute Desk", compdr: "Compute Desk", compperf: "Compute Desk",
  compmonitor: "Compute Desk", comptroubleshoot: "Compute Desk",
  compsecurity: "Compute Desk", compcost: "Compute Desk",
  aifoundry: "AI Desk", aimodel: "AI Desk", airag: "AI Desk",
  aiagents: "AI Desk", aifinetune: "AI Desk", aimlops: "AI Desk",
  aieval: "AI Desk", aisafety: "AI Desk", aicost: "AI Desk", aiiac: "AI Desk",
  datalake: "Data Desk", datawarehouse: "Data Desk", datastream: "Data Desk",
  datalakehouse: "Data Desk", datagovernance: "Data Desk", datasecurity: "Data Desk",
  datamigration: "Data Desk", datacost: "Data Desk", dataquality: "Data Desk",
  dataiac: "Data Desk", datapipelineadvisor: "Data Desk",
  fabricplanner: "Data Desk", adfpipeline: "Data Desk", medalliondesigner: "Data Desk",
};

const ALL_MODES = Object.keys(MODE_LABELS) as Mode[];

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    justifyContent: "center",
    paddingTop: "15vh",
  },
  palette: {
    width: "520px",
    maxHeight: "460px",
    background: tokens.colorNeutralBackground1,
    borderRadius: "12px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    gap: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  results: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 16px",
    cursor: "pointer",
    "&:hover": {
      background: "rgba(0, 120, 212, 0.08)",
    },
  },
  itemActive: {
    background: "rgba(0, 120, 212, 0.12)",
  },
  itemLabel: {
    flex: 1,
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
  },
  itemSection: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  hint: {
    padding: "12px 16px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    justifyContent: "space-between",
  },
  pinIcon: {
    fontSize: "12px",
    color: "#FFB900",
    flexShrink: 0,
  },
  empty: {
    padding: "24px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: Mode) => void;
  currentMode: Mode;
  favorites: Mode[];
}

export default function CommandPalette({ open, onClose, onSelect, currentMode, favorites }: CommandPaletteProps) {
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? ALL_MODES.filter((m) => {
        const q = query.toLowerCase();
        const label = MODE_LABELS[m].toLowerCase();
        const section = (MODE_SECTION[m] ?? "").toLowerCase();
        return label.includes(q) || section.includes(q) || m.includes(q);
      })
    : [
        ...favorites.filter((m) => m !== currentMode),
        ...ALL_MODES.filter((m) => m !== currentMode && !favorites.includes(m)),
      ];

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      onSelect(filtered[activeIndex]);
      onClose();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.searchRow}>
          <SearchRegular />
          <Input
            ref={inputRef}
            placeholder="Search modes..."
            value={query}
            onChange={(_, d) => setQuery(d.value)}
            size="medium"
            style={{ flex: 1 }}
            contentAfter={
              query ? (
                <DismissRegular
                  style={{ cursor: "pointer", fontSize: "14px" }}
                  onClick={() => setQuery("")}
                />
              ) : undefined
            }
          />
        </div>
        <div className={styles.results} ref={listRef}>
          {filtered.length === 0 && (
            <div className={styles.empty}>
              <Text size={200}>No matching modes</Text>
            </div>
          )}
          {filtered.map((m, i) => (
            <div
              key={m}
              className={`${styles.item} ${i === activeIndex ? styles.itemActive : ""}`}
              onClick={() => { onSelect(m); onClose(); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {favorites.includes(m) && <StarFilled className={styles.pinIcon} />}
              <span className={styles.itemLabel}>{MODE_LABELS[m]}</span>
              {MODE_SECTION[m] && (
                <Badge appearance="tint" size="small" color="informative">
                  {MODE_SECTION[m]}
                </Badge>
              )}
            </div>
          ))}
        </div>
        <div className={styles.hint}>
          <span>&#8593;&#8595; Navigate &middot; Enter to select &middot; Esc to close</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
